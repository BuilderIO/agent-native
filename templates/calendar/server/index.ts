import {
  createServer,
  createFileWatcher,
  createSSEHandler,
} from "@agent-native/core";
import { defineEventHandler } from "h3";
import fs from "fs";
import { createFileSync } from "@agent-native/core/adapters/sync";
import { envKeys } from "./lib/env-config.js";
import {
  getGoogleAuthUrl,
  handleGoogleCallback,
  getGoogleStatus,
  disconnectGoogle,
} from "./routes/google-auth.js";
import { syncGoogleCalendar } from "./routes/sync.js";
import {
  listEvents,
  getEvent,
  createEvent,
  updateEvent,
  deleteEvent,
} from "./routes/events.js";
import { getAvailability, updateAvailability } from "./routes/availability.js";
import {
  listBookings,
  createBooking,
  getAvailableSlots,
  deleteBooking,
} from "./routes/bookings.js";
import { getSettings, updateSettings } from "./routes/settings.js";

export async function createAppServer() {
  const { app, router } = createServer({ envKeys });

  const watcher = createFileWatcher("./data");

  router.get("/api/ping", () => ({ message: "pong" }));

  // Google Auth
  router.get("/api/google/auth-url", getGoogleAuthUrl);
  router.get("/api/google/callback", handleGoogleCallback);
  router.get("/api/google/status", getGoogleStatus);
  router.post("/api/google/disconnect", disconnectGoogle);

  // Sync
  router.post("/api/google/sync", syncGoogleCalendar);

  // Events CRUD
  router.get("/api/events", listEvents);
  router.get("/api/events/:id", getEvent);
  router.post("/api/events", createEvent);
  router.put("/api/events/:id", updateEvent);
  router.delete("/api/events/:id", deleteEvent);

  // Availability
  router.get("/api/availability", getAvailability);
  router.put("/api/availability", updateAvailability);

  // Bookings
  router.get("/api/bookings", listBookings);
  router.post("/api/bookings/create", createBooking);
  router.get("/api/bookings/available-slots", getAvailableSlots);
  router.delete("/api/bookings/:id", deleteBooking);

  // Settings
  router.get("/api/settings", getSettings);
  router.put("/api/settings", updateSettings);

  // File sync
  const syncResult = await createFileSync({ contentRoot: "./data" });
  if (syncResult.status === "error") {
    console.warn(`[app] File sync failed: ${syncResult.reason}`);
  }
  const extraEmitters =
    syncResult.status === "ready" ? [syncResult.sseEmitter] : [];

  router.get(
    "/api/file-sync/status",
    defineEventHandler(() => {
      if (syncResult.status !== "ready")
        return { enabled: false, conflicts: 0 };
      return {
        enabled: true,
        connected: true,
        conflicts: syncResult.fileSync.conflictCount,
      };
    }),
  );

  // SSE uses /api/sse to avoid collision with /api/events (calendar CRUD)
  router.get(
    "/api/sse",
    createSSEHandler(watcher, { extraEmitters, contentRoot: "./data" }),
  );

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    if (syncResult.status === "ready") await syncResult.shutdown();
    process.exit(0);
  });

  // Conflict notification
  if (syncResult.status === "ready") {
    syncResult.fileSync.syncEvents.on("sync", (event) => {
      try {
        if (event.type === "conflict-needs-llm") {
          fs.mkdirSync("application-state", { recursive: true });
          fs.writeFileSync(
            "application-state/sync-conflict.json",
            JSON.stringify(event, null, 2),
          );
        } else if (event.type === "conflict-resolved") {
          fs.rmSync("application-state/sync-conflict.json", { force: true });
        }
      } catch {
        /* best-effort */
      }
    });
  }

  return app;
}
