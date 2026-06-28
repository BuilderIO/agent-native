import {
  appStateDelete,
  appStateGet,
  appStatePut,
} from "@agent-native/core/application-state";
import { hasCollabState } from "@agent-native/core/collab";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";

const FLUSH_POLL_INTERVAL_MS = 200;
const FLUSH_TIMEOUT_MS = 4000;

export async function flushOpenDocumentEditorToSql(args: {
  documentId: string;
  ownerEmail?: string | null;
}) {
  // If a live Yjs collab session is open, the in-memory editor doc is fresher
  // than the SQL column. Ask the open editor to serialize + save, then wait
  // for it to acknowledge by clearing the flush-request key.
  if (!(await hasCollabState(args.documentId))) return;

  const flushKey = `flush-request-${args.documentId}`;
  // The editor polls `flush-request-<id>` via the framework app-state route,
  // which scopes reads to the logged-in browser user (the document owner).
  // Writing under the caller's (external agent's) session alone can miss the
  // human editor tab, so write under both plausible sessions and de-dupe.
  const callerEmail = getRequestUserEmail() || undefined;
  const targetSessions = Array.from(
    new Set(
      [args.ownerEmail ?? undefined, callerEmail].filter(
        (s): s is string => typeof s === "string" && s.length > 0,
      ),
    ),
  );
  if (targetSessions.length === 0) return;

  const flushValue = { id: args.documentId, ts: Date.now() };
  await Promise.all(
    targetSessions.map((session) =>
      appStatePut(session, flushKey, flushValue, {
        requestSource: "agent",
      }).catch(() => {}),
    ),
  );

  const deadline = Date.now() + FLUSH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, FLUSH_POLL_INTERVAL_MS));
    const pending = await Promise.all(
      targetSessions.map((session) => appStateGet(session, flushKey)),
    );
    if (pending.every((value) => !value)) break;
  }

  // Best-effort cleanup if the editor never picked it up (no tab open).
  await Promise.all(
    targetSessions.map((session) =>
      appStateDelete(session, flushKey, { requestSource: "agent" }).catch(
        () => {},
      ),
    ),
  );
}
