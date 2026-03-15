import { createServer } from "@agent-native/core";
import {
  listEmails,
  getEmail,
  markRead,
  toggleStar,
  archiveEmail,
  trashEmail,
  deleteEmail,
  sendEmail,
  listLabels,
  getSettings,
  updateSettings,
} from "./routes/emails.js";

export function createAppServer() {
  const app = createServer({});

  app.get("/api/ping", (_req, res) => res.json({ ok: true }));

  // Emails
  app.get("/api/emails", listEmails);
  app.get("/api/emails/:id", getEmail);
  app.patch("/api/emails/:id/read", markRead);
  app.patch("/api/emails/:id/star", toggleStar);
  app.patch("/api/emails/:id/archive", archiveEmail);
  app.patch("/api/emails/:id/trash", trashEmail);
  app.delete("/api/emails/:id", deleteEmail);
  app.post("/api/emails/send", sendEmail);

  // Labels
  app.get("/api/labels", listLabels);

  // Settings
  app.get("/api/settings", getSettings);
  app.patch("/api/settings", updateSettings);

  return app;
}
