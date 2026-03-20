import "dotenv/config";
import fs from "fs";
import {
  createServer,
  createFileWatcher,
  createSSEHandler,
} from "@agent-native/core";
import { defineEventHandler } from "h3";
import { createFileSync } from "@agent-native/core/adapters/sync";
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
import {
  listScheduledJobs,
  createScheduledJob,
  updateScheduledJob,
  deleteScheduledJob,
  parseDateNl,
} from "./routes/scheduled-jobs.js";
import { processJobs } from "./tasks/jobs/process.js";

const envKeys: EnvKeyConfig[] = [
  { key: "GOOGLE_CLIENT_ID", label: "Google OAuth Client ID", required: false },
  {
    key: "GOOGLE_CLIENT_SECRET",
    label: "Google OAuth Client Secret",
    required: false,
  },
];

export async function createAppServer() {
  const { app, router } = createServer({ envKeys });
  const watcher = createFileWatcher(["./data", "./application-state"]);

  // Emails
  router.get("/api/emails", listEmails);
  router.get("/api/threads/:threadId/messages", getThreadMessages);
  router.get("/api/emails/:id", getEmail);
  router.patch("/api/emails/:id/read", markRead);
  router.patch("/api/emails/:id/star", toggleStar);
  router.patch("/api/emails/:id/archive", archiveEmail);
  router.patch("/api/emails/:id/trash", trashEmail);
  router.post("/api/emails/:id/spam", reportSpam);
  router.post("/api/emails/:id/block-sender", blockSender);
  router.post("/api/threads/:threadId/mute", muteThread);
  router.delete("/api/emails/:id", deleteEmail);
  router.post("/api/emails/send", sendEmail);
  router.post("/api/emails/draft", saveDraft);
  router.delete("/api/emails/draft/:id", deleteDraft);

  // Labels
  router.get("/api/labels", listLabels);

  // Contacts
  router.get("/api/contacts", listContacts);

  // Aliases
  router.get("/api/aliases", listAliases);
  router.post("/api/aliases", createAlias);
  router.patch("/api/aliases/:id", updateAlias);
  router.delete("/api/aliases/:id", deleteAlias);

  // Settings
  router.get("/api/settings", getSettings);
  router.patch("/api/settings", updateSettings);

  // Calendar RSVP
  router.post("/api/calendar/rsvp", calendarRsvp);

  // Application state — compose drafts
  router.get("/api/application-state/compose", listComposeDrafts);
  router.get("/api/application-state/compose/:id", getComposeDraft);
  router.put("/api/application-state/compose/:id", putComposeDraft);
  router.delete("/api/application-state/compose/:id", deleteComposeDraft);
  router.delete("/api/application-state/compose", deleteAllComposeDrafts);

  // Application state — generic
  router.get("/api/application-state/:key", getState);
  router.put("/api/application-state/:key", putState);
  router.delete("/api/application-state/:key", deleteState);

  // Apollo
  router.get("/api/apollo/status", apolloStatus);
  router.put("/api/apollo/key", apolloSaveKey);
  router.delete("/api/apollo/key", apolloDeleteKey);
  router.get("/api/apollo/person", apolloPersonLookup);

  // HubSpot
  router.get("/api/hubspot/contact", hubspotContactLookup);

  // Gong
  router.get("/api/gong/calls", gongCallsLookup);

  // Pylon
  router.get("/api/pylon/contact", pylonContactLookup);

  // Media uploads
  router.post("/api/media/upload", uploadMedia);
  router.get("/api/media/:filename", serveMedia);

  // Google Auth
  router.get("/api/google/auth-url", getGoogleAuthUrl);
  router.get("/api/google/callback", handleGoogleCallback);
  router.get("/api/google/status", getGoogleStatus);
  router.post("/api/google/disconnect", disconnectGoogle);

  // Scheduled jobs (snooze / send-later)
  router.get("/api/scheduled-jobs", listScheduledJobs);
  router.post("/api/scheduled-jobs", createScheduledJob);
  router.patch("/api/scheduled-jobs/:id", updateScheduledJob);
  router.delete("/api/scheduled-jobs/:id", deleteScheduledJob);
  router.post("/api/parse-date", parseDateNl);

  // File sync (multi-user collaboration)
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

  // SSE events (keep last)
  router.get(
    "/api/events",
    createSSEHandler(watcher, { extraEmitters, contentRoot: "./data" }),
  );

  // Process scheduled jobs every minute (snooze + send-later)
  setInterval(() => {
    processJobs().catch((err) =>
      console.error("[jobs] Error processing jobs:", err),
    );
  }, 60_000);

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
