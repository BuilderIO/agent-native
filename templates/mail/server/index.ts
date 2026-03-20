import "dotenv/config";
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
  reportSpam,
  blockSender,
  muteThread,
  deleteEmail,
  sendEmail,
  saveDraft,
  deleteDraft,
  listLabels,
  listContacts,
  getSettings,
  updateSettings,
  calendarRsvp,
} from "./routes/emails.js";
import {
  listComposeDrafts,
  getComposeDraft,
  putComposeDraft,
  deleteComposeDraft,
  deleteAllComposeDrafts,
  getState,
  putState,
  deleteState,
} from "./routes/application-state.js";
import {
  getGoogleAuthUrl,
  handleGoogleCallback,
  getGoogleStatus,
  disconnectGoogle,
} from "./routes/google-auth.js";
import {
  apolloPersonLookup,
  apolloStatus,
  apolloSaveKey,
  apolloDeleteKey,
} from "./routes/apollo.js";
import {
  listAliases,
  createAlias,
  updateAlias,
  deleteAlias,
} from "./routes/aliases.js";
import { hubspotContactLookup } from "./routes/hubspot.js";
import { gongCallsLookup } from "./routes/gong.js";
import { pylonContactLookup } from "./routes/pylon.js";
import { uploadMedia, serveMedia } from "./routes/media.js";
import express from "express";

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
  app.post("/api/emails/:id/spam", reportSpam);
  app.post("/api/emails/:id/block-sender", blockSender);
  app.post("/api/threads/:threadId/mute", muteThread);
  app.delete("/api/emails/:id", deleteEmail);
  app.post("/api/emails/send", sendEmail);
  app.post("/api/emails/draft", saveDraft);
  app.delete("/api/emails/draft/:id", deleteDraft);

  // Labels
  app.get("/api/labels", listLabels);

  // Contacts
  app.get("/api/contacts", listContacts);

  // Aliases
  app.get("/api/aliases", listAliases);
  app.post("/api/aliases", createAlias);
  app.patch("/api/aliases/:id", updateAlias);
  app.delete("/api/aliases/:id", deleteAlias);

  // Settings
  app.get("/api/settings", getSettings);
  app.patch("/api/settings", updateSettings);

  // Calendar RSVP
  app.post("/api/calendar/rsvp", calendarRsvp);

  // Application state — compose drafts (multi-draft)
  app.get("/api/application-state/compose", listComposeDrafts);
  app.get("/api/application-state/compose/:id", getComposeDraft);
  app.put("/api/application-state/compose/:id", putComposeDraft);
  app.delete("/api/application-state/compose/:id", deleteComposeDraft);
  app.delete("/api/application-state/compose", deleteAllComposeDrafts);

  // Application state — generic (navigation, etc.)
  app.get("/api/application-state/:key", getState);
  app.put("/api/application-state/:key", putState);
  app.delete("/api/application-state/:key", deleteState);

  // Apollo
  app.get("/api/apollo/status", apolloStatus);
  app.put("/api/apollo/key", apolloSaveKey);
  app.delete("/api/apollo/key", apolloDeleteKey);
  app.get("/api/apollo/person", apolloPersonLookup);

  // HubSpot
  app.get("/api/hubspot/contact", hubspotContactLookup);

  // Gong
  app.get("/api/gong/calls", gongCallsLookup);

  // Pylon
  app.get("/api/pylon/contact", pylonContactLookup);

  // Media uploads
  app.post(
    "/api/media/upload",
    express.raw({ type: "*/*", limit: "10mb" }),
    uploadMedia,
  );
  app.get("/api/media/:filename", serveMedia);

  // Google Auth
  app.get("/api/google/auth-url", getGoogleAuthUrl);
  app.get("/api/google/callback", handleGoogleCallback);
  app.get("/api/google/status", getGoogleStatus);
  app.post("/api/google/disconnect", disconnectGoogle);

  // SSE events (keep last)
  app.get("/api/events", createSSEHandler(watcher));

  return app;
}
