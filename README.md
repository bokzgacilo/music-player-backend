# Music App API

Express + TypeScript backend for the local music app. It owns SQLite, downloaded MP3 files, thumbnails, yt-dlp downloads, and audio streaming.

## Requirements

- Node.js 22+
- `yt-dlp`
- `ffmpeg`
- Persistent disk for SQLite and `storage/`

Install tools on macOS:

```bash
brew install yt-dlp ffmpeg
```

Install tools on Ubuntu/Debian:

```bash
sudo apt update
sudo apt install ffmpeg python3-pip
python3 -m pip install -U yt-dlp
```

## Environment

Copy the example:

```bash
cp .env.example .env
```

Important production values:

```bash
API_PORT=4000
DATABASE_PATH=/srv/music-app/database/music.db
STORAGE_ROOT=/srv/music-app/storage
YTDLP_PATH=yt-dlp
FFMPEG_PATH=ffmpeg
CORS_ORIGIN=https://your-frontend.vercel.app
```

`STORAGE_ROOT` must contain:

```text
storage/
  music/
  thumbnails/
```

The API stores only relative paths in SQLite and streams files by song ID through `/api/stream/:songId`.

## Local Development

```bash
npm install
npm run dev
```

API runs at:

```text
http://localhost:4000
```

Health check:

```bash
curl http://localhost:4000/api/health
```

## Production Build

```bash
npm install
npm run build
npm run start
```

## Homelab Deployment Notes

Recommended layout:

```text
/srv/music-app/
  api/
  database/music.db
  storage/music/
  storage/thumbnails/
```

Run with a process manager such as `systemd`, `pm2`, or Docker. Make sure:

- `yt-dlp` and `ffmpeg` are installed inside the host/container.
- `DATABASE_PATH` points to persistent storage.
- `STORAGE_ROOT` points to persistent storage.
- `CORS_ORIGIN` contains your Vercel frontend URL.
- Your reverse proxy forwards to `API_PORT`.

## Docker

Build this API Dockerfile directly from the backend repo root:

```bash
docker build -t music-app-api .
```

Or use Compose:

```bash
docker compose up --build
```

## Main Endpoints

- `GET /api/search?q=`
- `POST /api/download`
- `GET /api/downloads`
- `GET /api/library`
- `DELETE /api/library/:id`
- `GET /api/recycle-bin`
- `POST /api/recycle-bin/:id/restore`
- `GET /api/stream/:songId`
- `GET /api/playlists`
- `POST /api/playlists`
