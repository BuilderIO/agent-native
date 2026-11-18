import { ActionContractError, isOutsideAgentCall } from "@agent-native/core";
import type { ActionRunContext } from "@agent-native/core/action";
import { and, desc, eq, inArray, ne } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { agentLevelFromStored } from "../shared/agent-level.js";
import { lockDocumentRows } from "./_row-lock-order.js";

export type CallProvenance = Pick<
  ActionRunContext,
  "caller" | "networkProtocol" | "automation" | "requestHeaders"
>;

/** Core's `EMBED_TARGET_HEADER`: the app's own frontend sends it with an embedded session's token. */
const EMBED_TARGET_HEADER = "x-agent-native-embed-target";

const relabeledAgentCalls = new WeakSet<object>();

/**
 * For a save that runs as the browser's so it takes the editor's path: the lock
 * still sees whoever started it.
 */
export function keepAgentCallProvenance<Ctx extends CallProvenance>(
  relabeled: Ctx,
  original: CallProvenance | undefined,
): Ctx {
  if (isAgentCall(original)) relabeledAgentCalls.add(relabeled);
  return relabeled;
}

/**
 * For a save the server runs on a caller's behalf and that has to keep the
 * server's path: the lock still sees who started it. A person's stays
 * context-free.
 */
export function serverSaveContext(original: CallProvenance | undefined) {
  return isAgentCall(original)
    ? keepAgentCallProvenance({} as ActionRunContext, original)
    : undefined;
}

/**
 * The frontend header is only the client's claim. The browser signs in with a
 * cookie, so a token alongside the header comes from outside it. A cookie isn't
 * told apart here: whoever holds one could mint the browser's UI proof as well.
 */
function claimsBrowserWithToken(ctx: CallProvenance) {
  return (
    ctx.caller === "frontend" &&
    ctx.requestHeaders?.has("authorization") === true &&
    !ctx.requestHeaders.has(EMBED_TARGET_HEADER)
  );
}

/**
 * Whether an agent made this call: Content's own agent, an MCP client, or
 * another outside caller. A call with no context comes from the server's own
 * code on behalf of whoever started it, so it isn't one. Nor is a chat widget's
 * write: core grants it only to the widget's own frontend, where a person is
 * the one typing.
 */
export function isAgentCall(ctx: CallProvenance | undefined) {
  if (ctx === undefined) return false;
  if (relabeledAgentCalls.has(ctx) || claimsBrowserWithToken(ctx)) return true;
  return (
    ctx.caller !== "mcp-widget-write" &&
    (ctx.caller === "tool" || isOutsideAgentCall(ctx))
  );
}

type StoredAgentLevel = { agentTextLocked?: number | null };

function agentsMayOnlyView() {
  return new ActionContractError(
    "A person has set agents to Can view on this page, so agents can only read it: they can't edit it, comment, react or suggest edits. Only a person can change that, from the page's Share panel.",
    { errorCode: "AGENT_VIEW_ONLY", statusCode: 403 },
  );
}

/**
 * Agents set to Can comment or Can view on a page: a person keeps its title,
 * body, description, icon and tabs out of agents' reach. At Can comment agents
 * can still comment and suggest edits. It keeps connected agents out of the
 * text; it isn't a permission, since they act for someone who could turn it
 * off. A space's catalog entry always takes the space's name, so its title
 * follows a rename of the space's Files page; that page's own level is the one
 * that holds it.
 */
export function assertAgentsMayEditPageText(
  document: StoredAgentLevel | undefined,
  ctx: CallProvenance | undefined,
) {
  if (!document?.agentTextLocked || !isAgentCall(ctx)) return;
  if (agentLevelFromStored(document.agentTextLocked) === "view") {
    throw agentsMayOnlyView();
  }
  throw new ActionContractError(
    "A person has set agents to Can comment on this page, so agents can't change its text. Comment on it, or propose the change with suggest-document-edit for a person to accept. Agents can't unlock it: only a person can change that, from the page's Share panel.",
    { errorCode: "AGENT_TEXT_LOCKED", statusCode: 403 },
  );
}

/**
 * Agents set to Can view on a page: on top of the text, they can't comment,
 * reply, react or suggest edits there, and nothing an agent starts writes
 * comments into it.
 */
export function assertAgentsMayCommentOnPage(
  document: StoredAgentLevel | undefined,
  ctx: CallProvenance | undefined,
) {
  if (agentLevelFromStored(document?.agentTextLocked) !== "view") return;
  if (isAgentCall(ctx)) throw agentsMayOnlyView();
}

/** The same refusal for a caller that has checked access but holds no row. */
export async function assertAgentsMayCommentOnPageId(
  documentId: string,
  ctx: CallProvenance | undefined,
) {
  if (!isAgentCall(ctx)) return;
  // guard:allow-unscoped — callers have checked access; this reads only the level.
  const [page] = await getDb()
    .select({ agentTextLocked: schema.documents.agentTextLocked })
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId))
    .limit(1);
  assertAgentsMayCommentOnPage(page, ctx);
}

/**
 * Ask AI hands a person's comment to an agent, so a page set to Can view
 * refuses it whoever asks.
 */
export function assertAiMayAnswerOnPage(
  document: StoredAgentLevel | undefined,
) {
  if (agentLevelFromStored(document?.agentTextLocked) !== "view") return;
  throw new ActionContractError(
    "Agents can only view this page, so AI can't answer comments on it. Someone who manages the page can change that in Share.",
    { errorCode: "AGENT_VIEW_ONLY", statusCode: 403 },
  );
}

/** A refusal from the page's agent level, at Can comment or Can view. */
export function isAgentTextLockRefusal(
  error: unknown,
): error is ActionContractError {
  return (
    error instanceof ActionContractError &&
    (error.errorCode === "AGENT_TEXT_LOCKED" ||
      error.errorCode === "AGENT_VIEW_ONLY")
  );
}

/** The same refusal for an action that writes many pages at once. */
/**
 * For a write across a collection's rows. Its collection and membership locks
 * don't stop a level change, which updates only the page's row, so an agent's write
 * takes the pages' rows too, next in Content's lock order, and checks under them.
 */
export async function lockPagesAndAssertAgentsMayEditText(
  db: ReturnType<typeof getDb>,
  documentIds: readonly string[],
  ctx: CallProvenance | undefined,
) {
  if (!isAgentCall(ctx)) return;
  await lockDocumentRows(db, documentIds);
  await assertAgentsMayEditPagesText(db, documentIds, ctx);
}

export async function assertAgentsMayEditPagesText(
  db: Pick<ReturnType<typeof getDb>, "select">,
  documentIds: readonly string[],
  ctx: CallProvenance | undefined,
) {
  if (!isAgentCall(ctx)) return;
  for (let start = 0; start < documentIds.length; start += 500) {
    // guard:allow-unscoped — callers have checked access; this reads only the lock.
    const [lockedPage] = await db
      .select({ agentTextLocked: schema.documents.agentTextLocked })
      .from(schema.documents)
      .where(
        and(
          inArray(schema.documents.id, documentIds.slice(start, start + 500)),
          ne(schema.documents.agentTextLocked, 0),
        ),
      )
      .orderBy(desc(schema.documents.agentTextLocked))
      .limit(1);
    assertAgentsMayEditPageText(lockedPage, ctx);
  }
}
