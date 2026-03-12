import express from "express";
import cors from "cors";

export interface CreateServerOptions {
  /** CORS options. Pass false to disable. Default: enabled with defaults. */
  cors?: cors.CorsOptions | false;
  /** JSON body parser limit. Default: "50mb" */
  jsonLimit?: string;
  /** Custom ping message. Default: reads PING_MESSAGE env var, falls back to "pong" */
  pingMessage?: string;
  /** Disable the /api/ping health check. Default: false */
  disablePing?: boolean;
}

/**
 * Create a pre-configured Express app with standard agent-native middleware:
 * - CORS
 * - JSON body parser (50mb limit)
 * - URL-encoded body parser
 * - /api/ping health check
 */
export function createServer(options: CreateServerOptions = {}): express.Express {
  const app = express();

  // Middleware
  if (options.cors !== false) {
    app.use(cors(options.cors));
  }
  app.use(express.json({ limit: options.jsonLimit ?? "50mb" }));
  app.use(express.urlencoded({ extended: true }));

  // Health check
  if (!options.disablePing) {
    app.get("/api/ping", (_req, res) => {
      const message = options.pingMessage ?? process.env.PING_MESSAGE ?? "pong";
      res.json({ message });
    });
  }

  return app;
}
