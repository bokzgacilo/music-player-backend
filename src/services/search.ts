import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type SearchEntry = {
  id?: string;
  title?: string;
  channel?: string;
  uploader?: string;
  duration?: number;
  thumbnails?: Array<{ url?: string }>;
  webpage_url?: string;
};

export async function searchYoutube(query: string) {
  const { stdout } = await execFileAsync("yt-dlp", [
    "--flat-playlist",
    "--dump-single-json",
    `ytsearch20:${query}`,
  ]);

  const data = JSON.parse(stdout);

  return ((data.entries || []) as SearchEntry[]).map((entry) => ({
        youtube_id: entry.id!,
        title: entry.title!,
        artist: entry.channel || entry.uploader || "Unknown artist",
        duration: entry.duration ?? null,
        thumbnail: entry.thumbnails?.[0]?.url ?? null,
        webpage_url: entry.webpage_url!
  }));
}
