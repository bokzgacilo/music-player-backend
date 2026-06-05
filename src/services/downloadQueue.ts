import fs from "node:fs";
import { db } from "../db.js";
import type { DownloadJobRow, DownloadStatus, SongRow } from "../types.js";
import { broadcastDownloads } from "./downloadEvents.js";
import type { AuthenticatedClient } from "./sessions.js";
import { downloadAudio, downloadThumbnail, getVideoInfo } from "./ytdlp.js";
import { sqliteNow } from "../utils/time.js";

const MAX_ACTIVE_DOWNLOADS = 3;
let activeDownloads = 0;

function log(message: string, meta?: unknown) {
  console.log(`[download-queue] ${message}`, meta ?? "");
}

function setJob(id: number, status: DownloadStatus, progress?: number, error?: string) {
  db.prepare(`
    UPDATE download_jobs
    SET status = ?, progress = COALESCE(?, progress), error_message = ?, updated_at = ${sqliteNow}
    WHERE id = ?
  `).run(status, progress ?? null, error ?? null, id);
  broadcastDownloads();
}

export function createDownloadJob(input: { youtube_id: string; title: string; requestedBy: AuthenticatedClient }) {
  const existingSong = db.prepare("SELECT * FROM songs WHERE youtube_id = ?").get(input.youtube_id) as SongRow | undefined;
  if (existingSong) {
    if (existingSong.deleted) {
      db.prepare("UPDATE songs SET deleted = 0, deleted_at = NULL WHERE id = ?").run(existingSong.id);
      const restoredSong = db.prepare("SELECT * FROM songs WHERE id = ?").get(existingSong.id) as SongRow;
      return { duplicate: true, restored: true, song: restoredSong };
    }
    return { duplicate: true, song: existingSong };
  }

  const existingJob = db.prepare(`
    SELECT * FROM download_jobs
    WHERE youtube_id = ?
    ORDER BY id DESC LIMIT 1
  `).get(input.youtube_id) as DownloadJobRow | undefined;
  if (existingJob) {
    return { duplicate: true, job: existingJob };
  }

  const result = db.prepare(`
    INSERT INTO download_jobs (youtube_id, title, status, progress, requested_by_client_id, requested_by_username, created_at, updated_at)
    VALUES (?, ?, 'queued', 0, ?, ?, ${sqliteNow}, ${sqliteNow})
  `).run(input.youtube_id, input.title, input.requestedBy.id, input.requestedBy.username);

  broadcastDownloads();
  processQueue();
  return { duplicate: false, jobId: Number(result.lastInsertRowid) };
}

export function processQueue() {
  while (activeDownloads < MAX_ACTIVE_DOWNLOADS) {
    const job = db.prepare("SELECT * FROM download_jobs WHERE status = 'queued' ORDER BY id ASC LIMIT 1").get() as DownloadJobRow | undefined;
    if (!job) return;
    runJob(job).catch((error) => log("Unhandled job failure", error));
  }
}

export function retryDownloadJob(id: number) {
  const job = db.prepare("SELECT * FROM download_jobs WHERE id = ?").get(id) as DownloadJobRow | undefined;
  if (!job) {
    return { status: "not_found" as const };
  }

  if (job.status !== "failed") {
    return { status: "not_failed" as const, job };
  }

  const activeJob = db.prepare(`
    SELECT * FROM download_jobs
    WHERE youtube_id = ? AND status IN ('queued', 'downloading', 'processing') AND id != ?
    ORDER BY id DESC LIMIT 1
  `).get(job.youtube_id, job.id) as DownloadJobRow | undefined;
  if (activeJob) {
    return { status: "already_active" as const, job: activeJob };
  }

  db.prepare(`
    UPDATE download_jobs
    SET status = 'queued', progress = 0, error_message = NULL, updated_at = ${sqliteNow}
    WHERE id = ?
  `).run(id);

  const queuedJob = db.prepare("SELECT * FROM download_jobs WHERE id = ?").get(id) as DownloadJobRow;
  broadcastDownloads();
  processQueue();
  return { status: "queued" as const, job: queuedJob };
}

async function runJob(job: DownloadJobRow) {
  activeDownloads += 1;
  setJob(job.id, "downloading", 0);
  log(`Starting ${job.youtube_id}: ${job.title}`);

  try {
    const sourceUrl = `https://www.youtube.com/watch?v=${job.youtube_id}`;
    const info = await getVideoInfo(sourceUrl).catch(() => ({
      youtube_id: job.youtube_id,
      title: job.title,
      artist: "YouTube",
      duration: null,
      thumbnail: null,
      webpage_url: sourceUrl
    }));

    const download = downloadAudio({
      sourceUrl,
      youtubeId: job.youtube_id,
      title: info.title,
      onProgress: (progress) => setJob(job.id, "downloading", progress)
    });

    await new Promise<void>((resolve, reject) => {
      download.emitter.on("error", reject);
      download.emitter.on("close", (code) => {
        if (code && code !== 0) {
          reject(new Error(`yt-dlp exited with code ${code}`));
          return;
        }
        resolve();
      });
    });

    setJob(job.id, "processing", 99);
    if (!fs.existsSync(download.finalPath)) {
      throw new Error("MP3 output file was not found after download");
    }

    const thumbnailPath = await downloadThumbnail(sourceUrl, job.youtube_id).catch((error) => {
      log("Thumbnail download failed", error);
      return null;
    });

    const existing = db.prepare("SELECT id FROM songs WHERE youtube_id = ?").get(job.youtube_id) as { id: number } | undefined;
    if (!existing) {
      db.prepare(`
        INSERT INTO songs (youtube_id, title, artist, duration, file_path, thumbnail_path, source_url, deleted, deleted_at, downloaded_by_client_id, downloaded_by_username, downloaded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ${sqliteNow})
      `).run(job.youtube_id, info.title, info.artist, info.duration, download.relativePath, thumbnailPath, info.webpage_url, job.requested_by_client_id, job.requested_by_username);
    } else {
      db.prepare(`
        UPDATE songs
        SET title = ?, artist = ?, duration = ?, file_path = ?, thumbnail_path = ?, source_url = ?, deleted = 0, deleted_at = NULL, downloaded_by_client_id = ?, downloaded_by_username = ?
        WHERE id = ?
      `).run(info.title, info.artist, info.duration, download.relativePath, thumbnailPath, info.webpage_url, job.requested_by_client_id, job.requested_by_username, existing.id);
    }

    setJob(job.id, "completed", 100);
    log(`Completed ${job.youtube_id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Download failed";
    setJob(job.id, "failed", undefined, message);
    log(`Failed ${job.youtube_id}`, message);
  } finally {
    activeDownloads -= 1;
    processQueue();
  }
}
