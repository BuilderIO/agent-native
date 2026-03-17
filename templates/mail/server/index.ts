import {
  createServer,
  createFileWatcher,
  createSSEHandler,
} from "@agent-native/core";
import type { EnvKeyConfig } from "@agent-native/core/server";
import {
  listEmails,
  getEmail,
  getThreadMessages,
  markRead,
  toggleStar,
  archiveEmail,
  trashEmail,
  deleteEmail,
  sendEmail,
  listLabels,
  listContacts,
  getSettings,
  updateSettings,
} from "./routes/emails.js";
import {
  getComposeState,
  putComposeState,
  deleteComposeState,
} from "./routes/application-state.js";
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
  const watcher = createFileWatcher(["./data", "./application-state"]);

  app.get("/api/ping", (_req, res) => res.json({ ok: true }));

  // Emails
  app.get("/api/emails", listEmails);
  app.get("/api/threads/:threadId/messages", getThreadMessages);
  app.get("/api/emails/:id", getEmail);
  app.patch("/api/emails/:id/read", markRead);
  app.patch("/api/emails/:id/star", toggleStar);
  app.patch("/api/emails/:id/archive", archiveEmail);
  app.patch("/api/emails/:id/trash", trashEmail);
  app.delete("/api/emails/:id", deleteEmail);
  app.post("/api/emails/send", sendEmail);

  // Labels
  app.get("/api/labels", listLabels);

  // Contacts
  app.get("/api/contacts", listContacts);

  // Settings
  app.get("/api/settings", getSettings);
  app.patch("/api/settings", updateSettings);

  // Application state
  app.get("/api/application-state/compose", getComposeState);
  app.put("/api/application-state/compose", putComposeState);
  app.delete("/api/application-state/compose", deleteComposeState);

  // Google Auth
  app.get("/api/google/auth-url", getGoogleAuthUrl);
  app.get("/api/google/callback", handleGoogleCallback);
  app.get("/api/google/status", getGoogleStatus);
  app.post("/api/google/disconnect", disconnectGoogle);

  // SSE events (keep last)
  app.get("/api/events", createSSEHandler(watcher));

  return app;
}
