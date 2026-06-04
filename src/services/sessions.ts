import { randomBytes } from "node:crypto";
import type { Request } from "express";
import { db } from "../db.js";
import type { AdminSessionRow, ClientSessionRow, ClientUserRow } from "../types.js";

export type AuthenticatedClient = {
  id: number;
  username: string;
  avatarPath: string;
  userAgent: string;
  sessionToken: string;
};

function createToken() {
  return randomBytes(32).toString("hex");
}

function userAgentFromRequest(req: Request) {
  return req.headers["user-agent"] || "unknown";
}

export function createClientSession(input: { username: string; avatarPath: string; userAgent: string }) {
  const username = input.username.trim();
  const avatarPath = input.avatarPath;
  const userAgent = input.userAgent || "unknown";
  const result = db.prepare(`
    INSERT INTO client_users (username, avatar_path, user_agent)
    VALUES (?, ?, ?)
  `).run(username, avatarPath, userAgent);

  const user = db.prepare("SELECT * FROM client_users WHERE id = ?").get(result.lastInsertRowid) as ClientUserRow;
  const token = createToken();
  db.prepare("INSERT INTO client_sessions (token, user_id, user_agent) VALUES (?, ?, ?)").run(token, user.id, userAgent);

  return { token, user };
}

export function getClientFromToken(token: string | undefined): AuthenticatedClient | null {
  if (!token) return null;
  const row = db.prepare(`
    SELECT client_users.*, client_sessions.token AS session_token
    FROM client_sessions
    JOIN client_users ON client_users.id = client_sessions.user_id
    WHERE client_sessions.token = ?
  `).get(token) as (ClientUserRow & { session_token: string }) | undefined;

  if (!row) return null;

  db.prepare("UPDATE client_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE token = ?").run(token);
  db.prepare("UPDATE client_users SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?").run(row.id);

  return {
    id: row.id,
    username: row.username,
    avatarPath: row.avatar_path,
    userAgent: row.user_agent,
    sessionToken: row.session_token
  };
}

export function requireClient(req: Request) {
  const token = req.header("x-client-session");
  const client = getClientFromToken(token);
  if (!client) {
    const error = new Error("Client session required");
    Object.assign(error, { status: 401 });
    throw error;
  }
  return client;
}

export function loginAdmin(input: { username: string; password: string }) {
  const admin = db.prepare("SELECT id FROM admin_users WHERE username = ? AND password = ?").get(input.username, input.password) as { id: number } | undefined;
  if (!admin) return null;

  const token = createToken();
  db.prepare("INSERT INTO admin_sessions (token, admin_user_id) VALUES (?, ?)").run(token, admin.id);
  return { token, username: input.username };
}

export function getAdminFromToken(token: string | undefined) {
  if (!token) return null;
  const session = db.prepare("SELECT * FROM admin_sessions WHERE token = ?").get(token) as AdminSessionRow | undefined;
  if (!session) return null;
  db.prepare("UPDATE admin_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE token = ?").run(token);
  return session;
}

export function requireAdmin(req: Request) {
  const token = req.header("x-admin-session");
  const admin = getAdminFromToken(token);
  if (!admin) {
    const error = new Error("Admin session required");
    Object.assign(error, { status: 401 });
    throw error;
  }
  return admin;
}

export function clientFromRequest(req: Request) {
  const token = req.header("x-client-session");
  const existing = getClientFromToken(token);
  if (existing) return existing;
  return null;
}

export function registerClientFromRequest(req: Request, username: string, avatarPath: string) {
  return createClientSession({ username, avatarPath, userAgent: userAgentFromRequest(req) });
}

export function listClientUsers() {
  const users = db.prepare(`
    SELECT
      client_users.*,
      COUNT(client_sessions.token) AS session_count,
      MAX(client_sessions.last_seen_at) AS session_last_seen_at
    FROM client_users
    LEFT JOIN client_sessions ON client_sessions.user_id = client_users.id
    GROUP BY client_users.id
    ORDER BY client_users.last_seen_at DESC
  `).all() as Array<ClientUserRow & { session_count: number; session_last_seen_at: string | null }>;

  return users.map((user) => ({
    id: user.id,
    username: user.username,
    avatarPath: user.avatar_path,
    userAgent: user.user_agent,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    lastSeenAt: user.session_last_seen_at || user.last_seen_at,
    sessionCount: user.session_count
  }));
}
