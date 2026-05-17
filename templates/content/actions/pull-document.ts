import { defineAction } from "@agent-native/core";
import { resolveAccess } from "@agent-native/core/sharing";
import { buildDeepLink } from "@agent-native/core/server";
import { hasCollabState } from "@agent-native/core/collab";
import {
  readAppState,
  writeAppState,
  deleteAppState,
} from "@agent-native/core/application-state";
import { z } from "zod";
import "../server/db/index.js";

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
 *      `flush-request-<id>` app-state key (scoped to the caller's browser
 *      session — same scoping the `navigate` command uses).
 *   2. The editor polls that key, serializes its current Y.Doc to markdown
 *      through its existing serializer, calls `update-document`, then deletes
 *      the key.
 *   3. We poll for the key to disappear (flush acknowledged) and then read the
 *      now-fresh row. If the key never clears (no editor actually open), we
 *      fall back to the DB column, which is the best available snapshot.
 *
 * When there is no live collab session the DB column is authoritative and we
 * skip the handshake entirely.
 */

const FLUSH_POLL_INTERVAL_MS = 200;
const FLUSH_TIMEOUT_MS = 4000;

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
    const access = await resolveAccess("document", id);
    if (!access) throw new Error(`Document "${id}" not found`);

    // If a live Yjs collab session is open, the in-memory editor doc is fresher
    // than the SQL column. Ask the open editor to serialize + save, then wait
    // for it to acknowledge by clearing the flush-request key.
    if (await hasCollabState(id)) {
      const flushKey = `flush-request-${id}`;
      await writeAppState(flushKey, { id, ts: Date.now() });
      const deadline = Date.now() + FLUSH_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, FLUSH_POLL_INTERVAL_MS));
        const pending = await readAppState(flushKey);
        if (!pending) break;
      }
      // Best-effort cleanup if the editor never picked it up (no tab open).
      await deleteAppState(flushKey).catch(() => {});
    }

    // Re-resolve so we read the now-fresh row (and re-check access).
    const fresh = await resolveAccess("document", id);
    if (!fresh) throw new Error(`Document "${id}" not found`);
    const doc = fresh.resource;
    const markdown = (doc.content as string) ?? "";
    const content =
      format === "text"
        ? markdown
            .replace(/^#{1,6}\s+/gm, "")
            .replace(/[*_`~>]/g, "")
            .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
            .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
            .trim()
        : markdown;

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
