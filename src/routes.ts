import fs from "node:fs";
import express from "express";
import { z } from "zod";
import { db } from "./db.js";
import { createDownloadJob } from "./services/downloadQueue.js";
import type { DownloadJobRow, SongRow } from "./types.js";
import { isValidYoutubeUrl, resolveStoredPath } from "./utils/files.js";
import { getToolStatus, requireTools } from "./utils/tools.js";
import { searchYoutube } from "./services/search.js";

export const router = express.Router();

const idSchema = z.coerce.number().int().positive();
const downloadSchema = z.object({
  youtube_id: z.string().regex(/^[A-Za-z0-9_-]{11}$/, "Invalid YouTube video ID"),
  title: z.string().min(1),
  webpage_url: z.string().url().optional()
});
const playlistSchema = z.object({ name: z.string().min(1).max(120) });
const playlistSongSchema = z.object({ songId: z.number().int().positive(), position: z.number().int().nonnegative().optional() });

router.get("/health", (_req, res) => {
  const tools = getToolStatus();
  res.json({ ok: tools.every((tool) => tool.available), tools });
});

router.get("/tools", (_req, res) => {
  const tools = getToolStatus();
  res.json({ tools });
});

router.get("/search", async (req, res, next) => {
  try {
    const q = z.string().min(1).parse(req.query.q);
    requireTools(["yt-dlp"]);
    const results = await searchYoutube(q);
    res.json({ results });
  } catch (error) {
    next(error);
  }
});

router.post("/download", (req, res, next) => {
  try {
    const body = downloadSchema.parse(req.body);
    if (body.webpage_url && !isValidYoutubeUrl(body.webpage_url)) {
      return res.status(400).json({ error: "Invalid YouTube URL" });
    }
    requireTools(["yt-dlp", "ffmpeg"]);
    const result = createDownloadJob({ youtube_id: body.youtube_id, title: body.title });
    res.status(result.duplicate ? 200 : 202).json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/downloads", (_req, res) => {
  const jobs = db.prepare("SELECT * FROM download_jobs ORDER BY id DESC LIMIT 100").all() as DownloadJobRow[];
  res.json({ jobs });
});

router.get("/library", (_req, res) => {
  const songs = db.prepare("SELECT * FROM songs WHERE deleted = 0 ORDER BY downloaded_at DESC").all() as SongRow[];
  res.json({ songs });
});

router.get("/library/:id", (req, res) => {
  const id = idSchema.parse(req.params.id);
  const song = db.prepare("SELECT * FROM songs WHERE id = ? AND deleted = 0").get(id) as SongRow | undefined;
  if (!song) return res.status(404).json({ error: "Song not found" });
  res.json({ song });
});

router.delete("/library/:id", (req, res) => {
  const id = idSchema.parse(req.params.id);
  const song = db.prepare("SELECT * FROM songs WHERE id = ? AND deleted = 0").get(id) as SongRow | undefined;
  if (!song) return res.status(404).json({ error: "Song not found" });

  db.prepare("UPDATE songs SET deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
  res.json({ ok: true });
});

router.get("/recycle-bin", (_req, res) => {
  const songs = db.prepare("SELECT * FROM songs WHERE deleted = 1 ORDER BY deleted_at DESC, downloaded_at DESC").all() as SongRow[];
  res.json({ songs });
});

router.post("/recycle-bin/:id/restore", (req, res) => {
  const id = idSchema.parse(req.params.id);
  const song = db.prepare("SELECT * FROM songs WHERE id = ? AND deleted = 1").get(id) as SongRow | undefined;
  if (!song) return res.status(404).json({ error: "Deleted song not found" });

  db.prepare("UPDATE songs SET deleted = 0, deleted_at = NULL WHERE id = ?").run(id);
  const restored = db.prepare("SELECT * FROM songs WHERE id = ?").get(id) as SongRow;
  res.json({ song: restored });
});

router.get("/stream/:songId", (req, res) => {
  const id = idSchema.parse(req.params.songId);
  const song = db.prepare("SELECT * FROM songs WHERE id = ? AND deleted = 0").get(id) as SongRow | undefined;
  if (!song) return res.status(404).json({ error: "Song not found" });

  let absolute: string;
  try {
    absolute = resolveStoredPath(song.file_path);
  } catch {
    return res.status(400).json({ error: "Invalid stored file path" });
  }
  if (!fs.existsSync(absolute)) return res.status(404).json({ error: "Audio file missing" });

  res.setHeader("Content-Type", "audio/mpeg");
  res.sendFile(absolute);
});

router.get("/thumbnails/:songId", (req, res) => {
  const id = idSchema.parse(req.params.songId);
  const song = db.prepare("SELECT thumbnail_path FROM songs WHERE id = ?").get(id) as Pick<SongRow, "thumbnail_path"> | undefined;
  if (!song?.thumbnail_path) return res.status(404).json({ error: "Thumbnail not found" });
  const absolute = resolveStoredPath(song.thumbnail_path);
  if (!fs.existsSync(absolute)) return res.status(404).json({ error: "Thumbnail file missing" });
  res.sendFile(absolute);
});

router.post("/library/:id/play", (req, res) => {
  const id = idSchema.parse(req.params.id);
  db.prepare("UPDATE songs SET play_count = play_count + 1 WHERE id = ? AND deleted = 0").run(id);
  const song = db.prepare("SELECT * FROM songs WHERE id = ? AND deleted = 0").get(id) as SongRow | undefined;
  if (!song) return res.status(404).json({ error: "Song not found" });
  res.json({ song });
});

router.post("/library/:id/favorite", (req, res) => {
  const id = idSchema.parse(req.params.id);
  const song = db.prepare("SELECT * FROM songs WHERE id = ? AND deleted = 0").get(id) as SongRow | undefined;
  if (!song) return res.status(404).json({ error: "Song not found" });
  db.prepare("UPDATE songs SET favorite = ? WHERE id = ?").run(song.favorite ? 0 : 1, id);
  const updated = db.prepare("SELECT * FROM songs WHERE id = ? AND deleted = 0").get(id);
  res.json({ song: updated });
});

router.get("/playlists", (_req, res) => {
  const playlists = db.prepare("SELECT * FROM playlists ORDER BY updated_at DESC").all();
  res.json({ playlists });
});

router.post("/playlists", (req, res) => {
  const body = playlistSchema.parse(req.body);
  const result = db.prepare("INSERT INTO playlists (name) VALUES (?)").run(body.name);
  const playlist = db.prepare("SELECT * FROM playlists WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json({ playlist });
});

router.put("/playlists/:id", (req, res) => {
  const id = idSchema.parse(req.params.id);
  const body = playlistSchema.parse(req.body);
  db.prepare("UPDATE playlists SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(body.name, id);
  const playlist = db.prepare("SELECT * FROM playlists WHERE id = ?").get(id);
  if (!playlist) return res.status(404).json({ error: "Playlist not found" });
  res.json({ playlist });
});

router.delete("/playlists/:id", (req, res) => {
  const id = idSchema.parse(req.params.id);
  db.prepare("DELETE FROM playlists WHERE id = ?").run(id);
  res.status(204).end();
});

router.get("/playlists/:id", (req, res) => {
  const id = idSchema.parse(req.params.id);
  const playlist = db.prepare("SELECT * FROM playlists WHERE id = ?").get(id);
  if (!playlist) return res.status(404).json({ error: "Playlist not found" });
  const songs = db.prepare(`
    SELECT songs.* FROM playlist_songs
    JOIN songs ON songs.id = playlist_songs.song_id
    WHERE playlist_songs.playlist_id = ? AND songs.deleted = 0
    ORDER BY playlist_songs.position ASC, playlist_songs.id ASC
  `).all(id);
  res.json({ playlist, songs });
});

router.post("/playlists/:id/songs", (req, res) => {
  const playlistId = idSchema.parse(req.params.id);
  const body = playlistSongSchema.parse(req.body);
  const song = db.prepare("SELECT id FROM songs WHERE id = ? AND deleted = 0").get(body.songId);
  if (!song) return res.status(404).json({ error: "Song not found" });
  const maxPosition = db.prepare("SELECT COALESCE(MAX(position), -1) as value FROM playlist_songs WHERE playlist_id = ?").get(playlistId) as { value: number };
  db.prepare(`
    INSERT OR IGNORE INTO playlist_songs (playlist_id, song_id, position)
    VALUES (?, ?, ?)
  `).run(playlistId, body.songId, body.position ?? maxPosition.value + 1);
  db.prepare("UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(playlistId);
  res.status(201).json({ ok: true });
});

router.delete("/playlists/:id/songs/:songId", (req, res) => {
  const playlistId = idSchema.parse(req.params.id);
  const songId = idSchema.parse(req.params.songId);
  db.prepare("DELETE FROM playlist_songs WHERE playlist_id = ? AND song_id = ?").run(playlistId, songId);
  db.prepare("UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(playlistId);
  res.status(204).end();
});
