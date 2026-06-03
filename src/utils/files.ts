import fs from "node:fs";
import path from "node:path";
import { musicDir, thumbnailDir, config } from "../config.js";

export function ensureStorage() {
  fs.mkdirSync(musicDir, { recursive: true });
  fs.mkdirSync(thumbnailDir, { recursive: true });
}

export function sanitizeFilename(input: string) {
  return input
    .normalize("NFKD")
    .replace(/[^\w\s.-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "download";
}

export function safeRelativePath(absolutePath: string) {
  const relative = path.relative(config.storageRoot, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path escapes storage root");
  }
  return relative.split(path.sep).join("/");
}

export function resolveStoredPath(relativePath: string) {
  const absolute = path.resolve(config.storageRoot, relativePath);
  if (!absolute.startsWith(config.storageRoot + path.sep)) {
    throw new Error("Invalid stored path");
  }
  return absolute;
}

export function isValidYoutubeUrl(url: string) {
  try {
    const parsed = new URL(url);
    return ["youtube.com", "www.youtube.com", "music.youtube.com", "youtu.be"].includes(parsed.hostname);
  } catch {
    return false;
  }
}
