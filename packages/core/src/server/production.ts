import path from "path";
import type { Express } from "express";
import express from "express";

export interface ProductionServerOptions {
  /** Port to listen on. Default: process.env.PORT || 3000 */
  port?: number | string;
  /** Path to the built SPA directory. Default: inferred from import.meta or "dist/spa" */
  spaDir?: string;
  /** App name for log messages. Default: "Agent-Native" */
  appName?: string;
}

/**
 * Start a production server that:
 * 1. Serves the built SPA static files
 * 2. Falls back to index.html for client-side routing (SPA fallback)
 * 3. Returns 404 JSON for unknown API routes
 * 4. Handles graceful shutdown on SIGTERM/SIGINT
 */
export function createProductionServer(
  app: Express,
  options: ProductionServerOptions = {},
): void {
  const port = options.port ?? process.env.PORT ?? 3000;
  const appName = options.appName ?? "Agent-Native";

  // Resolve SPA directory
  const spaDir = options.spaDir ?? path.resolve(process.cwd(), "dist/spa");

  // Serve static files
  app.use(express.static(spaDir));

  // SPA fallback — serve index.html for all non-API routes
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/health")) {
      return res.status(404).json({ error: "API endpoint not found" });
    }
    res.sendFile(path.join(spaDir, "index.html"));
  });

  app.listen(port, () => {
    console.log(`${appName} server running on port ${port}`);
    console.log(`  Frontend: http://localhost:${port}`);
    console.log(`  API: http://localhost:${port}/api`);
  });

  // Graceful shutdown
  const shutdown = (signal: string) => {
    console.log(`Received ${signal}, shutting down gracefully`);
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
