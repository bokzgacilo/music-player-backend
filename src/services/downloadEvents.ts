import type { Server } from "node:http";
import type { IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { db } from "../db.js";
import type { DownloadJobRow } from "../types.js";
import { getAdminFromToken, getClientFromToken } from "./sessions.js";

const APP_STREAM_PATH = "/api/stream";
const DOWNLOADS_STREAM_PATH = "/api/downloads/stream";
const localDevOrigin = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;

type ClientRecord = {
  id: string;
  connectedAt: string;
  lastSeenAt: string;
  userAgent: string;
  ipAddress: string;
  origin: string | null;
  path: string | null;
  userId: number | null;
  username: string;
  avatarPath: string;
  isAdmin: boolean;
};

const clients = new Map<WebSocket, ClientRecord>();

function listDownloadJobs() {
  return db.prepare("SELECT * FROM download_jobs ORDER BY id DESC LIMIT 100").all() as DownloadJobRow[];
}

function isAllowedOrigin(origin: string | undefined) {
  return !origin || config.corsOrigins.includes(origin) || localDevOrigin.test(origin);
}

function sendDownloads(client: WebSocket) {
  client.send(JSON.stringify({ type: "downloads", jobs: listDownloadJobs() }));
}

function listClients() {
  return Array.from(clients.values()).sort((a, b) => a.connectedAt.localeCompare(b.connectedAt));
}

function sendClients(client: WebSocket) {
  client.send(JSON.stringify({ type: "clients", clients: listClients() }));
}

function broadcastClients() {
  const message = JSON.stringify({ type: "clients", clients: listClients() });
  for (const [client, record] of clients.entries()) {
    if (record.isAdmin && client.readyState === client.OPEN) {
      client.send(message);
    }
  }
}

function isAppStream(request: IncomingMessage) {
  const path = request.url?.split("?")[0];
  return path === APP_STREAM_PATH || path === DOWNLOADS_STREAM_PATH;
}

function getIpAddress(request: IncomingMessage) {
  const forwardedFor = request.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.length) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }
  return request.socket.remoteAddress || "unknown";
}

function getQueryToken(request: IncomingMessage, key: string) {
  const host = request.headers.host || "localhost";
  const url = new URL(request.url || "/", `http://${host}`);
  return url.searchParams.get(key) || undefined;
}

function createClientRecord(request: IncomingMessage): ClientRecord | null {
  const client = getClientFromToken(getQueryToken(request, "clientSession"));
  const admin = getAdminFromToken(getQueryToken(request, "adminSession"));
  if (!client) return null;

  return {
    id: randomUUID(),
    connectedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    userAgent: client.userAgent || request.headers["user-agent"] || "unknown",
    ipAddress: getIpAddress(request),
    origin: request.headers.origin || null,
    path: null,
    userId: client.id,
    username: client.username,
    avatarPath: client.avatarPath,
    isAdmin: Boolean(admin)
  };
}

export function setupDownloadWebSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    if (!isAppStream(request)) return;

    if (!isAllowedOrigin(request.headers.origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (client) => {
      wss.emit("connection", client, request);
    });
  });

  wss.on("connection", (client, request) => {
    const record = createClientRecord(request);
    if (!record) {
      client.close(1008, "Client session required");
      return;
    }

    clients.set(client, record);
    sendDownloads(client);
    if (record.isAdmin) sendClients(client);
    broadcastClients();

    client.on("message", (data) => {
      const record = clients.get(client);
      if (!record) return;

      record.lastSeenAt = new Date().toISOString();
      try {
        const payload = JSON.parse(data.toString()) as { type?: string; path?: string };
        if (payload.type === "client:update") {
          record.path = payload.path || null;
          broadcastClients();
        }
      } catch {
        client.send(JSON.stringify({ type: "error", error: "Invalid stream message" }));
      }
    });

    client.on("close", () => {
      clients.delete(client);
      broadcastClients();
    });
  });
}

export function broadcastDownloads() {
  if (!clients.size) return;

  const message = JSON.stringify({ type: "downloads", jobs: listDownloadJobs() });
  for (const client of clients.keys()) {
    if (client.readyState === client.OPEN) {
      client.send(message);
    }
  }
}
