import { defineAction } from "@agent-native/core";
import { resolveAccess } from "@agent-native/core/sharing";
import { buildDeepLink, getRequestUserEmail } from "@agent-native/core/server";
import { hasCollabState } from "@agent-native/core/collab";
import {
  appStateGet,
  appStatePut,
  appStateDelete,
} from "@agent-native/core/application-state";
import { z } from "zod";
import "../server/db/index.js";
import {
  getLocalFileDocument,
  isContentLocalFileMode,
} from "./_local-file-documents.js";

/**
 * Collab-aware "ingest the final" read for external agents.
 *
 * The `documents.content` column can lag behind a live Yjs collab session: the
 * editor holds the authoritative Y.XmlFragment in memory and only debounces it
 * back to SQL via `update-document`. To hand an external agent the document the
 * user actually sees, we ask the OPEN editor to flush instead of duplicating a
 * ProseMirror -> markdown serializer server-side:
 *
 *   1. If a collab session exists for this doc, write a one-shot
 *      `flush-request-<id>` app-state key under the DOCUMENT OWNER's session
 *      (and, for back-compat, the caller's own session). The open editor polls
 *      `/_agent-native/application-state/flush-request-<id>`, which the
 *      framework scopes to the *logged-in browser user* — i.e. the human with
 *      the editor open, which is the document owner. Scoping the write to the
 *      external agent caller's session (the old behavior) meant the editor
 *      never saw the key, so every external `pull-document` waited the full
 *      timeout and returned stale DB content.
 *   2. The editor polls that key, serializes its current Y.Doc to markdown
 *      through its existing serializer, calls `update-document`, then deletes
 *      the key.
 *   3. We poll (across both candidate sessions) for the key to disappear
 *      (flush acknowledged) and then read the now-fresh row. If the key never
 *      clears (no editor actually open), we fall back to the DB column, which
 *      is the best available snapshot.
 *
 * When there is no live collab session the DB column is authoritative and we
 * skip the handshake entirely. The handshake itself is bounded by
 * FLUSH_TIMEOUT_MS so a stale `hasCollabState` (presence lingering with no tab
 * actually open) can never hang the request longer than a few seconds.
 */

const FLUSH_POLL_INTERVAL_MS = 200;
const FLUSH_TIMEOUT_MS = 4000;

function formatDocumentContent(markdown: string, format: "markdown" | "text") {
  return format === "text"
    ? markdown
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/[*_`~>]/g, "")
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .trim()
    : markdown;
}

export default defineAction({
  description:
    "Read a document's final content, flushing any open live collaborative editing session to SQL first so external agents ingest exactly what the user sees (prefer this over get-document for external ingest).",
  schema: z.object({
    id: z.string().describe("Document ID (required)"),
    format: z
      .enum(["markdown", "text"])
      .default("markdown")
      .describe("Return format. 'markdown' (default) or plain 'text'."),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async ({ id, format }) => {
    if (await isContentLocalFileMode()) {
      const doc = await getLocalFileDocument(id);
      if (doc.source?.kind === "folder") {
        throw new Error("Folders cannot be pulled as markdown documents");
      }
      return {
        id: doc.id,
        title: doc.title,
        content: formatDocumentContent(doc.content ?? "", format),
        format,
        deepLink: buildDeepLink({
          app: "content",
          view: "editor",
          params: { documentId: doc.id },
        }),
      };
    }

    const access = await resolveAccess("document", id);
    if (!access) throw new Error(`Document "${id}" not found`);

    // If a live Yjs collab session is open, the in-memory editor doc is fresher
    // than the SQL column. Ask the open editor to serialize + save, then wait
    // for it to acknowledge by clearing the flush-request key.
    if (await hasCollabState(id)) {
      const flushKey = `flush-request-${id}`;
      // The editor polls `flush-request-<id>` via the framework app-state
      // route, which scopes reads to the logged-in browser user (the document
      // owner). Writing under the caller's (external agent's) session — what
      // the old `writeAppState` helper did — meant the editor never saw the
      // key. Write under the owner's session so the open editor's poll picks
      // it up; also write under the caller's own session for back-compat (e.g.
      // an in-app agent that is itself the owner), de-duped.
      const ownerEmail =
        (access.resource.ownerEmail as string | undefined) || undefined;
      const callerEmail = getRequestUserEmail() || undefined;
      const targetSessions = Array.from(
        new Set(
          [ownerEmail, callerEmail].filter(
            (s): s is string => typeof s === "string" && s.length > 0,
          ),
        ),
      );
      const flushValue = { id, ts: Date.now() };
      await Promise.all(
        targetSessions.map((s) =>
          appStatePut(s, flushKey, flushValue, {
            requestSource: "agent",
          }).catch(() => {}),
        ),
      );
      const deadline = Date.now() + FLUSH_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, FLUSH_POLL_INTERVAL_MS));
        // The editor deletes the key from whichever session it polls. Treat
        // the flush as acknowledged once it is gone from all target sessions.
        const pending = await Promise.all(
          targetSessions.map((s) => appStateGet(s, flushKey)),
        );
        if (pending.every((p) => !p)) break;
      }
      // Best-effort cleanup if the editor never picked it up (no tab open).
      await Promise.all(
        targetSessions.map((s) =>
          appStateDelete(s, flushKey, { requestSource: "agent" }).catch(
            () => {},
          ),
        ),
      );
    }

    // Re-resolve so we read the now-fresh row (and re-check access).
    const fresh = await resolveAccess("document", id);
    if (!fresh) throw new Error(`Document "${id}" not found`);
    const doc = fresh.resource;
    const markdown = (doc.content as string) ?? "";
    const content = formatDocumentContent(markdown, format);

    return {
      id: doc.id,
      title: doc.title,
      content,
      format,
      deepLink: buildDeepLink({
        app: "content",
        view: "editor",
        params: { documentId: doc.id },
      }),
    };
  },
  link: ({ result }) => {
    const id = (result as { id?: string } | null)?.id;
    if (!id) return null;
    return {
      url: buildDeepLink({
        app: "content",
        view: "editor",
        params: { documentId: id },
      }),
      label: "Open document",
      view: "editor",
    };
  },
});
