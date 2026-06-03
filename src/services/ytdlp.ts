import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { config, musicDir, thumbnailDir } from "../config.js";
import type { SearchResult } from "../types.js";
import { safeRelativePath, sanitizeFilename } from "../utils/files.js";
import { getToolStatus } from "../utils/tools.js";

type YTDlpWrapInstance = {
  execPromise(args?: string[]): Promise<string>;
  exec(args?: string[]): {
    on(event: "progress", listener: (progress: { percent?: number }) => void): unknown;
    on(event: "error", listener: (error: Error) => void): unknown;
    on(event: "close", listener: (code: number | null) => void): unknown;
  };
};

const require = createRequire(import.meta.url);
const YTDlpWrap = require("yt-dlp-wrap").default as new (binaryPath?: string) => YTDlpWrapInstance;

function createYtDlp() {
  const resolved = getToolStatus().find((tool) => tool.name === "yt-dlp")?.resolvedPath;
  return new YTDlpWrap(resolved ?? config.ytdlpPath);
}

type RawSearchEntry = {
  id?: string;
  title?: string;
  channel?: string;
  uploader?: string;
  duration?: number;
  thumbnail?: string;
  webpage_url?: string;
};

export async function getVideoInfo(sourceUrl: string): Promise<SearchResult> {
  const raw = await createYtDlp().execPromise([
    sourceUrl,
    "--dump-single-json",
    "--skip-download",
    "--no-warnings",
    "--no-playlist"
  ]);
  const entry = JSON.parse(raw) as RawSearchEntry;
  if (!entry.id || !entry.title || !entry.webpage_url) {
    throw new Error("Unable to read YouTube video metadata");
  }
  return {
    youtube_id: entry.id,
    title: entry.title,
    artist: entry.channel || entry.uploader || "Unknown artist",
    duration: entry.duration ?? null,
    thumbnail: entry.thumbnail ?? null,
    webpage_url: entry.webpage_url
  };
}

export async function downloadThumbnail(sourceUrl: string, youtubeId: string) {
  const template = path.join(thumbnailDir, `${youtubeId}.%(ext)s`);
  await createYtDlp().execPromise([
    sourceUrl,
    "--skip-download",
    "--write-thumbnail",
    "--convert-thumbnails",
    "jpg",
    "--no-playlist",
    "-o",
    template
  ]);

  const jpg = path.join(thumbnailDir, `${youtubeId}.jpg`);
  try {
    await fs.access(jpg);
    return safeRelativePath(jpg);
  } catch {
    return null;
  }
}

export function downloadAudio(params: {
  sourceUrl: string;
  youtubeId: string;
  title: string;
  onProgress: (progress: number) => void;
}) {
  const basename = `${params.youtubeId}-${sanitizeFilename(params.title)}`;
  const outputTemplate = path.join(musicDir, `${basename}.%(ext)s`);
  const finalPath = path.join(musicDir, `${basename}.mp3`);

  const ffmpegPath = getToolStatus().find((tool) => tool.name === "ffmpeg")?.resolvedPath ?? config.ffmpegPath;
  const emitter = createYtDlp().exec([
    params.sourceUrl,
    "-x",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "0",
    "--ffmpeg-location",
    ffmpegPath,
    "--no-playlist",
    "-o",
    outputTemplate
  ]);

  emitter.on("progress", (progress: { percent?: number }) => {
    params.onProgress(Math.max(0, Math.min(100, Number(progress.percent ?? 0))));
  });

  return { emitter, finalPath, relativePath: safeRelativePath(finalPath) };
}
