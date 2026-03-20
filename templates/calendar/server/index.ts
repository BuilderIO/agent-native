import { createServer } from "@agent-native/core";
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

export function createAppServer() {
  const { app, router } = createServer({ envKeys });

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

  return app;
}
