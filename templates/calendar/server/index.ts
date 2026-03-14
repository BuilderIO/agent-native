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
  const app = createServer({ envKeys });

  app.get("/api/ping", (_req, res) => {
    res.json({ message: "pong" });
  });

  // Google Auth
  app.get("/api/google/auth-url", getGoogleAuthUrl);
  app.get("/api/google/callback", handleGoogleCallback);
  app.get("/api/google/status", getGoogleStatus);
  app.post("/api/google/disconnect", disconnectGoogle);

  // Sync
  app.post("/api/google/sync", syncGoogleCalendar);

  // Events CRUD
  app.get("/api/events", listEvents);
  app.get("/api/events/:id", getEvent);
  app.post("/api/events", createEvent);
  app.put("/api/events/:id", updateEvent);
  app.delete("/api/events/:id", deleteEvent);

  // Availability
  app.get("/api/availability", getAvailability);
  app.put("/api/availability", updateAvailability);

  // Bookings
  app.get("/api/bookings", listBookings);
  app.post("/api/bookings/create", createBooking);
  app.get("/api/bookings/available-slots", getAvailableSlots);
  app.delete("/api/bookings/:id", deleteBooking);

  // Settings
  app.get("/api/settings", getSettings);
  app.put("/api/settings", updateSettings);

  return app;
}
