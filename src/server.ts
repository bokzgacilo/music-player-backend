import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import { ZodError } from "zod";
import { config } from "./config.js";
import { initDb } from "./db.js";
import { router } from "./routes.js";
import { setupDownloadWebSocket } from "./services/downloadEvents.js";
import { ensureStorage } from "./utils/files.js";

ensureStorage();
initDb();

const app = express();
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    const localDevOrigin = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
    if (config.corsOrigins.includes(origin) || localDevOrigin) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked origin: ${origin}`));
  }
}));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

app.get("/", (_req, res) => {
  res.json({ message: "Music player backend is running." });
});

app.use("/api", router);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) {
    return res.status(400).json({ error: "Invalid request", details: error.flatten() });
  }
  const message = error instanceof Error ? error.message : "Internal server error";
  const explicitStatus = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : undefined;
  const status = explicitStatus ?? (message.startsWith("Missing required local tool:") ? 503 : 500);
  console.error("[api]", message, error);
  res.status(status).json({ error: message });
});

const server = createServer(app);
setupDownloadWebSocket(server);

server.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${config.port}`);
  console.log(`[api] database ${config.databasePath}`);
  console.log(`[api] storage ${config.storageRoot}`);
});
