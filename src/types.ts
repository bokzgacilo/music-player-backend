export type SearchResult = {
  youtube_id: string;
  title: string;
  artist: string;
  duration: number | null;
  thumbnail: string | null;
  webpage_url: string;
};

export type DownloadStatus = "queued" | "downloading" | "processing" | "completed" | "failed";

export type SongRow = {
  id: number;
  youtube_id: string;
  title: string;
  artist: string;
  duration: number | null;
  file_path: string;
  thumbnail_path: string | null;
  source_url: string;
  play_count: number;
  favorite: 0 | 1;
  downloaded_at: string;
  deleted: 0 | 1;
  deleted_at: string | null;
};

export type DownloadJobRow = {
  id: number;
  youtube_id: string;
  title: string;
  status: DownloadStatus;
  progress: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};
