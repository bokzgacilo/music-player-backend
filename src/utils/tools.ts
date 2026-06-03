import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

type ToolStatus = {
  name: "yt-dlp" | "ffmpeg";
  configuredPath: string;
  resolvedPath: string | null;
  available: boolean;
};

const commonSearchDirs = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin"
];

function canExecute(filePath: string) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveExecutable(command: string) {
  if (path.isAbsolute(command)) {
    return canExecute(command) ? command : null;
  }

  const searchDirs = [
    ...((process.env.PATH ?? "").split(path.delimiter).filter(Boolean)),
    ...commonSearchDirs
  ];

  for (const dir of new Set(searchDirs)) {
    const candidate = path.join(dir, command);
    if (canExecute(candidate)) return candidate;
  }

  return null;
}

export function getToolStatus(): ToolStatus[] {
  return [
    {
      name: "yt-dlp",
      configuredPath: config.ytdlpPath,
      resolvedPath: resolveExecutable(config.ytdlpPath),
      available: Boolean(resolveExecutable(config.ytdlpPath))
    },
    {
      name: "ffmpeg",
      configuredPath: config.ffmpegPath,
      resolvedPath: resolveExecutable(config.ffmpegPath),
      available: Boolean(resolveExecutable(config.ffmpegPath))
    }
  ];
}

export function requireTools(names: Array<ToolStatus["name"]>) {
  const tools = getToolStatus().filter((tool) => names.includes(tool.name));
  const missing = tools.filter((tool) => !tool.available);
  if (missing.length) {
    const namesText = missing.map((tool) => tool.name).join(", ");
    throw new Error(`Missing required local tool: ${namesText}. Install with "brew install yt-dlp ffmpeg" or set YTDLP_PATH/FFMPEG_PATH in apps/api/.env.`);
  }
}
