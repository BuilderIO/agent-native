import { createServer } from "@agent-native/core";
import type { EnvKeyConfig } from "@agent-native/core/server";
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
import {
  getGoogleAuthUrl,
  handleGoogleCallback,
  getGoogleStatus,
  disconnectGoogle,
} from "./routes/google-auth.js";

const envKeys: EnvKeyConfig[] = [
  { key: "GOOGLE_CLIENT_ID", label: "Google OAuth Client ID", required: false },
  {
    key: "GOOGLE_CLIENT_SECRET",
    label: "Google OAuth Client Secret",
    required: false,
  },
];

export function createAppServer() {
  const app = createServer({ envKeys });

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

  // Google Auth
  app.get("/api/google/auth-url", getGoogleAuthUrl);
  app.get("/api/google/callback", handleGoogleCallback);
  app.get("/api/google/status", getGoogleStatus);
  app.post("/api/google/disconnect", disconnectGoogle);

  return app;
}
