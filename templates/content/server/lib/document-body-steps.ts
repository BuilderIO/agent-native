import { createHash } from "node:crypto";

import { and, desc, eq, gte, lt } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

type ContentDb = ReturnType<typeof getDb>;

/**
 * How many revisions back a switched page's body can be rebuilt. An agent's
 * edit names the revision it read, and a tab typing meanwhile commits a few
 * times a second; History records at most one of those bodies per interval.
 */
export const DOCUMENT_BODY_STEP_LIMIT = 256;

// A commit that replaces more than this records no step, so a base before it
// can't be rebuilt and an edit made on one is refused.
const DOCUMENT_BODY_STEP_MAX_TEXT = 64 * 1024;

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/**
 * The step that turns `after` back into `before`: replace `after`'s
 * [start, end) with `text`. It never splits a surrogate pair, since SQL text
 * can't hold half of one.
 */
export function documentBodyStep(
  before: string,
  after: string,
): { start: number; end: number; text: string } {
  const shorter = Math.min(before.length, after.length);
  let prefix = 0;
  while (
    prefix < shorter &&
    before.charCodeAt(prefix) === after.charCodeAt(prefix)
  )
    prefix += 1;
  if (prefix > 0 && isHighSurrogate(before.charCodeAt(prefix - 1))) prefix -= 1;
  let suffix = 0;
  while (
    suffix < shorter - prefix &&
    before.charCodeAt(before.length - 1 - suffix) ===
      after.charCodeAt(after.length - 1 - suffix)
  )
    suffix += 1;
  if (suffix > 0 && isLowSurrogate(after.charCodeAt(after.length - suffix)))
    suffix -= 1;
  return {
    start: prefix,
    end: after.length - suffix,
    text: before.slice(prefix, before.length - suffix),
  };
}

/**
 * `body` with each step applied in turn, newest first. Null when a step's
 * range is outside the body it applies to.
 */
export function applyDocumentBodySteps(
  body: string,
  steps: ReadonlyArray<{ start: number; end: number; text: string }>,
): string | null {
  // Each step is applied to pieces of the bodies after it, so rebuilding
  // copies the body once rather than once per step.
  let pieces = [body];
  for (const step of steps) {
    const kept: string[] = [];
    let offset = 0;
    let placed = false;
    for (const piece of pieces) {
      const pieceEnd = offset + piece.length;
      if (pieceEnd <= step.start || offset >= step.end) {
        if (!placed && offset >= step.end) {
          kept.push(step.text);
          placed = true;
        }
        kept.push(piece);
      } else {
        if (offset < step.start) kept.push(piece.slice(0, step.start - offset));
        if (!placed) {
          kept.push(step.text);
          placed = true;
        }
        if (pieceEnd > step.end) kept.push(piece.slice(step.end - offset));
      }
      offset = pieceEnd;
    }
    if (step.start < 0 || step.start > step.end || step.end > offset) {
      return null;
    }
    if (!placed) kept.push(step.text);
    pieces = kept.filter((piece) => piece.length > 0);
  }
  return pieces.join("");
}

/**
 * Records how to get back from a switched page's body at `bodyRevision + 1`
 * to the body it replaced. Runs in the commit's transaction.
 */
export async function recordDocumentBodyStep(args: {
  db: ContentDb;
  ownerEmail: string;
  documentId: string;
  /** The revision `before` was stored at. */
  bodyRevision: number;
  before: string;
  after: string;
  now: string;
}): Promise<void> {
  const step = documentBodyStep(args.before, args.after);
  if (step.text.length <= DOCUMENT_BODY_STEP_MAX_TEXT) {
    const values = {
      ownerEmail: args.ownerEmail,
      documentId: args.documentId,
      bodyRevision: args.bodyRevision,
      startOffset: step.start,
      endOffset: step.end,
      text: step.text,
      createdAt: args.now,
    };
    await args.db
      .insert(schema.documentBodySteps)
      .values({ id: `${args.documentId}:${args.bodyRevision}`, ...values })
      .onConflictDoUpdate({ target: schema.documentBodySteps.id, set: values });
  }
  if (args.bodyRevision % 32 === 0) {
    await args.db
      .delete(schema.documentBodySteps)
      .where(
        and(
          eq(schema.documentBodySteps.documentId, args.documentId),
          lt(
            schema.documentBodySteps.bodyRevision,
            args.bodyRevision - DOCUMENT_BODY_STEP_LIMIT,
          ),
        ),
      );
  }
}

/**
 * The body a switched page held at `revision`, rebuilt from its current body
 * by the steps its commits since recorded. Null unless every commit since
 * recorded one and the rebuilt body has `contentHash`, so a base it returns
 * is exactly the body its revision was served with.
 */
export async function rebuildDocumentBodyBase(args: {
  db: ContentDb;
  ownerEmail: string;
  documentId: string;
  contentHash: string;
  revision: number;
  current: { revision: number; content: string };
}): Promise<string | null> {
  const count = args.current.revision - args.revision;
  if (count <= 0 || count > DOCUMENT_BODY_STEP_LIMIT) return null;
  const steps = await args.db
    .select({
      bodyRevision: schema.documentBodySteps.bodyRevision,
      start: schema.documentBodySteps.startOffset,
      end: schema.documentBodySteps.endOffset,
      text: schema.documentBodySteps.text,
    })
    .from(schema.documentBodySteps)
    .where(
      and(
        eq(schema.documentBodySteps.ownerEmail, args.ownerEmail),
        eq(schema.documentBodySteps.documentId, args.documentId),
        gte(schema.documentBodySteps.bodyRevision, args.revision),
        lt(schema.documentBodySteps.bodyRevision, args.current.revision),
      ),
    )
    .orderBy(desc(schema.documentBodySteps.bodyRevision))
    .limit(count);
  if (steps.length !== count) return null;
  const body = applyDocumentBodySteps(args.current.content, steps);
  if (body === null) return null;
  const hash = `sha256:${createHash("sha256").update(body).digest("hex")}`;
  return hash === args.contentHash ? body : null;
}
