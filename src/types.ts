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
  downloaded_by_client_id: number | null;
  downloaded_by_username: string | null;
};

export type DownloadJobRow = {
  id: number;
  youtube_id: string;
  title: string;
  status: DownloadStatus;
  progress: number;
  error_message: string | null;
  requested_by_client_id: number | null;
  requested_by_username: string | null;
  created_at: string;
  updated_at: string;
};

export type PlaylistRow = {
  id: number;
  name: string;
  created_by_client_id: number | null;
  created_by_username: string | null;
  is_shared: 0 | 1;
  created_at: string;
  updated_at: string;
};

export type ClientUserRow = {
  id: number;
  username: string;
  avatar_path: string;
  user_agent: string;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
};

export type ClientSessionRow = {
  token: string;
  user_id: number;
  user_agent: string;
  created_at: string;
  last_seen_at: string;
};

export type AdminSessionRow = {
  token: string;
  admin_user_id: number;
  created_at: string;
  last_seen_at: string;
};
