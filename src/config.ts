import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const root = process.cwd();

export const config = {
  port: Number(process.env.API_PORT ?? 4000),
  databasePath: path.resolve(process.cwd(), process.env.DATABASE_PATH ?? "./database/music.db"),
  storageRoot: path.resolve(process.cwd(), process.env.STORAGE_ROOT ?? "./storage"),
  ytdlpPath: process.env.YTDLP_PATH || "yt-dlp",
  ffmpegPath: process.env.FFMPEG_PATH || "ffmpeg",
  corsOrigins: (process.env.CORS_ORIGIN || "http://localhost:3010,https://musicplayer.bokzgacilo.com")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  root
};

export const musicDir = path.join(config.storageRoot, "music");
export const thumbnailDir = path.join(config.storageRoot, "thumbnails");
