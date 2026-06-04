import fs from "node:fs";
import express from "express";
import { z } from "zod";
import { db } from "./db.js";
import { createDownloadJob, retryDownloadJob } from "./services/downloadQueue.js";
import type { DownloadJobRow, PlaylistRow, SongRow } from "./types.js";
import { isValidYoutubeUrl, resolveStoredPath } from "./utils/files.js";
import { getToolStatus, requireTools } from "./utils/tools.js";
import { searchYoutube } from "./services/search.js";
import { listClientUsers, loginAdmin, registerClientFromRequest, requireAdmin, requireClient } from "./services/sessions.js";

export const router = express.Router();

const idSchema = z.coerce.number().int().positive();
const downloadSchema = z.object({
  youtube_id: z.string().regex(/^[A-Za-z0-9_-]{11}$/, "Invalid YouTube video ID"),
  title: z.string().min(1),
  webpage_url: z.string().url().optional()
});
const playlistSchema = z.object({ name: z.string().min(1).max(120) });
const playlistShareSchema = z.object({ is_shared: z.boolean() });
const playlistSongSchema = z.object({ songId: z.number().int().positive(), position: z.number().int().nonnegative().optional() });
const avatarPaths = ["/avatars/lion.png", "/avatars/bunny.png", "/avatars/panda.png"] as const;
const clientSessionSchema = z.object({
  username: z.string().trim().min(1).max(80),
  avatarPath: z.enum(avatarPaths)
});
const adminLoginSchema = z.object({ username: z.string().min(1), password: z.string().min(1) });

router.get("/health", (_req, res) => {
  const tools = getToolStatus();
  res.json({ ok: tools.every((tool) => tool.available), tools });
});

router.get("/tools", (req, res) => {
  requireAdmin(req);
  const tools = getToolStatus();
  res.json({ tools });
});

router.post("/clients/session", (req, res) => {
  const body = clientSessionSchema.parse(req.body);
  const session = registerClientFromRequest(req, body.username, body.avatarPath);
  res.status(201).json({
    token: session.token,
    user: {
      id: session.user.id,
      username: session.user.username,
      avatarPath: session.user.avatar_path,
      userAgent: session.user.user_agent,
      createdAt: session.user.created_at,
      lastSeenAt: session.user.last_seen_at
    }
  });
});

router.get("/clients/me", (req, res) => {
  const client = requireClient(req);
  res.json({ user: client });
});

router.post("/admin/login", (req, res) => {
  const body = adminLoginSchema.parse(req.body);
  const session = loginAdmin(body);
  if (!session) return res.status(401).json({ error: "Invalid admin credentials" });
  res.json(session);
});

router.get("/admin/me", (req, res) => {
  requireAdmin(req);
  res.json({ ok: true, username: "bokzgacilo" });
});

router.get("/admin/clients", (req, res) => {
  requireAdmin(req);
  res.json({ users: listClientUsers() });
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
    const client = requireClient(req);
    const body = downloadSchema.parse(req.body);
    if (body.webpage_url && !isValidYoutubeUrl(body.webpage_url)) {
      return res.status(400).json({ error: "Invalid YouTube URL" });
    }
    requireTools(["yt-dlp", "ffmpeg"]);
    const result = createDownloadJob({ youtube_id: body.youtube_id, title: body.title, requestedBy: client });
    res.status(result.duplicate ? 200 : 202).json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/downloads", (_req, res) => {
  const jobs = db.prepare("SELECT * FROM download_jobs ORDER BY id DESC LIMIT 100").all() as DownloadJobRow[];
  res.json({ jobs });
});

router.post("/downloads/:id/retry", (req, res) => {
  const id = idSchema.parse(req.params.id);
  const result = retryDownloadJob(id);

  if (result.status === "not_found") {
    return res.status(404).json({ error: "Download job not found" });
  }

  if (result.status === "not_failed") {
    return res.status(409).json({ error: "Only failed download jobs can be retried", job: result.job });
  }

  if (result.status === "already_active") {
    return res.status(409).json({ error: "A download job for this song is already active", job: result.job });
  }

  res.json({ job: result.job });
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
  const client = requireClient(req);
  const id = idSchema.parse(req.params.id);
  const song = db.prepare("SELECT * FROM songs WHERE id = ? AND deleted = 0").get(id) as SongRow | undefined;
  if (!song) return res.status(404).json({ error: "Song not found" });
  if (song.downloaded_by_client_id !== client.id) {
    return res.status(403).json({ error: "Only the user who added this song can remove it" });
  }

  db.prepare("UPDATE songs SET deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
  res.json({ ok: true });
});

router.get("/recycle-bin", (req, res) => {
  requireAdmin(req);
  const songs = db.prepare("SELECT * FROM songs WHERE deleted = 1 ORDER BY deleted_at DESC, downloaded_at DESC").all() as SongRow[];
  res.json({ songs });
});

router.post("/recycle-bin/:id/restore", (req, res) => {
  requireAdmin(req);
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

router.get("/playlists", (req, res) => {
  const client = requireClient(req);
  const mine = db.prepare("SELECT * FROM playlists WHERE created_by_client_id = ? ORDER BY updated_at DESC").all(client.id) as PlaylistRow[];
  const publicPlaylists = db.prepare("SELECT * FROM playlists WHERE is_shared = 1 ORDER BY updated_at DESC").all() as PlaylistRow[];
  res.json({ playlists: mine, mine, public: publicPlaylists });
});

router.post("/playlists", (req, res) => {
  const client = requireClient(req);
  const body = playlistSchema.parse(req.body);
  const result = db.prepare(`
    INSERT INTO playlists (name, created_by_client_id, created_by_username)
    VALUES (?, ?, ?)
  `).run(body.name, client.id, client.username);
  const playlist = db.prepare("SELECT * FROM playlists WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json({ playlist });
});

router.put("/playlists/:id", (req, res) => {
  const client = requireClient(req);
  const id = idSchema.parse(req.params.id);
  const body = playlistSchema.parse(req.body);
  db.prepare("UPDATE playlists SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND created_by_client_id = ?").run(body.name, id, client.id);
  const playlist = db.prepare("SELECT * FROM playlists WHERE id = ? AND created_by_client_id = ?").get(id, client.id);
  if (!playlist) return res.status(404).json({ error: "Playlist not found" });
  res.json({ playlist });
});

router.put("/playlists/:id/share", (req, res) => {
  const client = requireClient(req);
  const id = idSchema.parse(req.params.id);
  const body = playlistShareSchema.parse(req.body);
  db.prepare("UPDATE playlists SET is_shared = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND created_by_client_id = ?").run(body.is_shared ? 1 : 0, id, client.id);
  const playlist = db.prepare("SELECT * FROM playlists WHERE id = ? AND created_by_client_id = ?").get(id, client.id);
  if (!playlist) return res.status(404).json({ error: "Playlist not found" });
  res.json({ playlist });
});

router.delete("/playlists/:id", (req, res) => {
  const client = requireClient(req);
  const id = idSchema.parse(req.params.id);
  db.prepare("DELETE FROM playlists WHERE id = ? AND created_by_client_id = ?").run(id, client.id);
  res.status(204).end();
});

router.get("/playlists/:id", (req, res) => {
  const client = requireClient(req);
  const id = idSchema.parse(req.params.id);
  const playlist = db.prepare("SELECT * FROM playlists WHERE id = ? AND (created_by_client_id = ? OR is_shared = 1)").get(id, client.id) as PlaylistRow | undefined;
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
  const client = requireClient(req);
  const playlistId = idSchema.parse(req.params.id);
  const body = playlistSongSchema.parse(req.body);
  const playlist = db.prepare("SELECT id FROM playlists WHERE id = ? AND created_by_client_id = ?").get(playlistId, client.id);
  if (!playlist) return res.status(404).json({ error: "Playlist not found" });
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
  const client = requireClient(req);
  const playlistId = idSchema.parse(req.params.id);
  const songId = idSchema.parse(req.params.songId);
  const playlist = db.prepare("SELECT id FROM playlists WHERE id = ? AND created_by_client_id = ?").get(playlistId, client.id);
  if (!playlist) return res.status(404).json({ error: "Playlist not found" });
  db.prepare("DELETE FROM playlist_songs WHERE playlist_id = ? AND song_id = ?").run(playlistId, songId);
  db.prepare("UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(playlistId);
  res.status(204).end();
});
