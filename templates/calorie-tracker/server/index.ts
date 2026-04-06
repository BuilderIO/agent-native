import "dotenv/config";
import express from "express";
import cors from "cors";
import mealRoutes from "./routes/meals";
import exerciseRoutes from "./routes/exercises";
import weightRoutes from "./routes/weights";
import aiRoutes from "./routes/ai";
import voiceRoutes from "./routes/voice";

export function createServer() {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));

  // Fallback middleware to handle string body in serverless environments
  app.use((req, res, next) => {
    if (req.body && typeof req.body === "string" && req.body.length > 0) {
      try {
        req.body = JSON.parse(req.body);
      } catch {
        // Body is not valid JSON, continue
      }
    }
    next();
  });

  // API routes
  app.use("/api", mealRoutes);
  app.use("/api", exerciseRoutes);
  app.use("/api", weightRoutes);
  app.use("/api", aiRoutes);
  app.use("/api", voiceRoutes);

  app.get("/api/ping", (_req, res) => {
    const ping = process.env.PING_MESSAGE ?? "ping";
    res.json({ message: ping });
  });

  // Global error handler - must be last
  app.use(
    (
      err: any,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      console.error("Unhandled error:", err);

      // Ensure we always send a JSON response
      if (!res.headersSent) {
        res.status(500).json({
          error: "Internal server error",
          details: err?.message || String(err),
          stack: err?.stack,
          path: req.path,
          method: req.method,
        });
      }
    },
  );

  return app;
}
