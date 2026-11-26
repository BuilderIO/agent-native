import { ActionContractError } from "@agent-native/core";
import { fail, type ActionRunContext } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import {
  buildDeepLink,
  getAppConfig,
  getRequestUserEmail,
  toAbsoluteOpenUrl,
} from "@agent-native/core/server";
import {
  getUserSettingEntry,
  putUserSetting,
} from "@agent-native/core/settings";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { documentRevisionToken } from "../server/lib/document-revision.js";
import { firstRow } from "../server/lib/first-row.js";
import { appendContentLiveCopyBlocks } from "../server/live-copy/write.js";
import {
  appendNfmBlocks,
  docToNfm,
  parseNfmWithLosses,
} from "../shared/nfm.js";
import { serializePropertyValue } from "../shared/properties.js";
import {
  personalContentSpaceId,
  provisionContentSpaces,
} from "./_content-spaces.js";
import {
  getDatabaseMutationContract,
  upsertDatabaseRow,
  type DatabaseMutationTarget,
} from "./_database-row-mutation.js";
import {
  assertAgentsMayEditPageText,
  serverSaveContext,
} from "./_document-agent-lock.js";
import { nanoid } from "./_property-utils.js";
import configureDocumentProperty from "./configure-document-property.js";
import createContentDatabase from "./create-content-database.js";
import updateDocument from "./update-document.js";

export const MAIL_NOTES_TITLE = "Mail notes";
const SETTING_KEY = "mail-notes-collection";

const storedCollectionSchema = z.object({
  spaceId: z.string().min(1),
  databaseId: z.string().min(1),
  databaseDocumentId: z.string().min(1),
  emailPropertyId: z.string().min(1),
  generation: z.number().int().min(0),
});
type StoredCollection = z.infer<typeof storedCollectionSchema>;
type CollectionTarget = Pick<
  StoredCollection,
  "spaceId" | "databaseId" | "databaseDocumentId"
>;

const MAIL_NOTE_MAX_JSON_CHARS = 100_000;
const NEWLINE_JSON_CHARS = 2;
export const MAIL_NOTE_MAX_RESULT_CHARS = 400_000;

export const mailNoteSchema = z.object({
  markdown: z.string(),
  truncated: z
    .boolean()
    .describe(
      "True when the page is too long to return whole and markdown holds only its newest lines; url opens the whole page",
    ),
  url: z.string(),
  updatedAt: z.string(),
});
export type MailNote = z.infer<typeof mailNoteSchema>;

export const mailNoteEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .max(320)
  .describe("The person's email address; their note page is keyed by it");

function requireUser() {
  const userEmail = getRequestUserEmail();
  if (!userEmail) {
    fail("Sign in to read or add Mail notes.", {
      errorCode: "unauthenticated",
      statusCode: 401,
    });
  }
  return userEmail;
}

function noteUrl(documentId: string) {
  return toAbsoluteOpenUrl(
    buildDeepLink({ app: "content", view: "editor", params: { documentId } }),
    getAppConfig().app.url,
  );
}

async function readStored(userEmail: string) {
  const entry = await getUserSettingEntry(userEmail, SETTING_KEY);
  if (!entry.found) return null;
  const parsed = storedCollectionSchema.safeParse(entry.value);
  if (!parsed.success) {
    fail("The saved Mail notes collection setting is unreadable.", {
      errorCode: "mail_notes_setting_invalid",
      statusCode: 500,
    });
  }
  return parsed.data;
}

async function collectionRow(databaseId: string) {
  const rows = await getDb()
    .select({
      spaceId: schema.contentDatabases.spaceId,
      ownerEmail: schema.contentDatabases.ownerEmail,
      documentId: schema.contentDatabases.documentId,
      deletedAt: schema.contentDatabases.deletedAt,
      naturalKeyPropertyId: schema.contentDatabases.naturalKeyPropertyId,
      trashedAt: schema.documents.trashedAt,
    })
    .from(schema.contentDatabases)
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.contentDatabases.documentId),
    )
    .where(eq(schema.contentDatabases.id, databaseId));
  return firstRow(rows) ?? null;
}

function failKeyChanged(): never {
  fail(
    "Email is no longer the key of your Mail notes collection in Content. Make Email its key again to see or add notes.",
    { errorCode: "mail_notes_key_changed", statusCode: 409 },
  );
}

async function liveCollection(userEmail: string, stored: StoredCollection) {
  const row = await collectionRow(stored.databaseId);
  if (!row) return null;
  if (
    row.ownerEmail.toLowerCase() !== userEmail.toLowerCase() ||
    row.documentId !== stored.databaseDocumentId
  ) {
    fail(
      "The saved Mail notes collection setting doesn't name your own collection.",
      {
        errorCode: "mail_notes_setting_invalid",
        statusCode: 500,
      },
    );
  }
  if (row.deletedAt || row.trashedAt) return null;
  const personalSpaceId = personalContentSpaceId(userEmail);
  if (row.spaceId !== personalSpaceId || stored.spaceId !== personalSpaceId) {
    fail(
      "Your Mail notes collection is no longer in your Personal space in Content. Move it back to see or add notes.",
      { errorCode: "mail_notes_moved", statusCode: 409 },
    );
  }
  if (row.naturalKeyPropertyId !== stored.emailPropertyId) failKeyChanged();
  return stored;
}

function targetOf(stored: CollectionTarget): DatabaseMutationTarget {
  return {
    spaceId: stored.spaceId,
    databaseId: stored.databaseId,
    databaseDocumentId: stored.databaseDocumentId,
  } as DatabaseMutationTarget;
}

async function addTextProperty(
  stored: CollectionTarget,
  name: string,
  naturalKey: boolean,
  ctx: ActionRunContext | undefined,
) {
  const contract = await getDatabaseMutationContract(targetOf(stored));
  await configureDocumentProperty.run(
    {
      operation: "create",
      target: {
        spaceId: stored.spaceId,
        databaseId: stored.databaseId,
        databaseDocumentId: stored.databaseDocumentId,
      },
      expectedSchemaRevision: contract.schemaRevision,
      idempotencyKey: `mail-notes:${stored.databaseId}:${name.toLowerCase()}`,
      definition: { type: "text", name, naturalKey },
    },
    ctx,
  );
}

async function createCollection(
  userEmail: string,
  generation: number,
  ctx: ActionRunContext | undefined,
): Promise<StoredCollection> {
  const { personalSpaceId } = await provisionContentSpaces(getDb(), userEmail);
  const created = await createContentDatabase.run(
    {
      spaceId: personalSpaceId,
      title: MAIL_NOTES_TITLE,
      description:
        "Notes about people you email, one page per person, keyed by email address. Mail adds a dated line linking to the email each time you write a note beside it.",
      idempotencyKey: `mail-notes:${generation}`,
    },
    ctx,
  );
  const target: CollectionTarget = {
    spaceId: personalSpaceId,
    databaseId: created.database.id,
    databaseDocumentId: created.database.documentId,
  };
  await addTextProperty(target, "Email", true, ctx);
  await addTextProperty(target, "Company", false, ctx);
  const emailPropertyId = (await collectionRow(target.databaseId))
    ?.naturalKeyPropertyId;
  if (!emailPropertyId) {
    fail("Content created Mail notes but couldn't read it back. Try again.", {
      errorCode: "mail_notes_readback_failed",
      statusCode: 503,
    });
  }
  const stored: StoredCollection = { ...target, emailPropertyId, generation };
  await putUserSetting(userEmail, SETTING_KEY, stored);
  return stored;
}

async function ensureCollection(
  userEmail: string,
  ctx: ActionRunContext | undefined,
) {
  const stored = await readStored(userEmail);
  const live = stored ? await liveCollection(userEmail, stored) : null;
  if (live) return live;
  const next = await createCollection(
    userEmail,
    stored ? stored.generation + 1 : 0,
    ctx,
  );
  if (!(await liveCollection(userEmail, next))) {
    fail("Content created Mail notes but couldn't read it back. Try again.", {
      errorCode: "mail_notes_readback_failed",
      statusCode: 503,
    });
  }
  return next;
}

async function claimedPage(
  databaseId: string,
  keyPropertyId: string,
  email: string,
) {
  const claims = await getDb()
    .select({ documentId: schema.contentDatabaseItemKeyClaims.documentId })
    .from(schema.contentDatabaseItemKeyClaims)
    .where(
      and(
        eq(schema.contentDatabaseItemKeyClaims.databaseId, databaseId),
        eq(schema.contentDatabaseItemKeyClaims.propertyId, keyPropertyId),
        eq(
          schema.contentDatabaseItemKeyClaims.keyValueJson,
          serializePropertyValue(email),
        ),
      ),
    );
  return firstRow(claims)?.documentId ?? null;
}

async function readPage(documentId: string, role: "viewer" | "editor") {
  const page = (await assertAccess("document", documentId, role)).resource;
  if (page.trashedAt) {
    fail(
      "This person's note is in Trash in Content. Restore it to see or add notes.",
      { errorCode: "mail_note_trashed", statusCode: 409 },
    );
  }
  return page;
}

function jsonChars(text: string) {
  return JSON.stringify(text).length - 2;
}

function newestLines(
  markdown: string,
): Pick<MailNote, "markdown" | "truncated"> {
  if (jsonChars(markdown) <= MAIL_NOTE_MAX_JSON_CHARS) {
    return { markdown, truncated: false };
  }
  const kept: string[] = [];
  let size = -NEWLINE_JSON_CHARS;
  for (const line of markdown.split("\n").reverse()) {
    size += jsonChars(line) + NEWLINE_JSON_CHARS;
    if (size > MAIL_NOTE_MAX_JSON_CHARS) break;
    kept.push(line);
  }
  return { markdown: kept.reverse().join("\n"), truncated: true };
}

function noteOf(page: {
  id: string;
  content: unknown;
  updatedAt: unknown;
}): MailNote {
  return {
    ...newestLines(typeof page.content === "string" ? page.content : ""),
    url: noteUrl(page.id),
    updatedAt: String(page.updatedAt ?? ""),
  };
}

export async function readMailNote(email: string): Promise<MailNote | null> {
  const userEmail = requireUser();
  const stored = await readStored(userEmail);
  if (!stored) return null;
  const live = await liveCollection(userEmail, stored);
  if (!live) return null;
  const documentId = await claimedPage(
    live.databaseId,
    live.emailPropertyId,
    email,
  );
  if (!documentId) return null;
  return noteOf(await readPage(documentId, "viewer"));
}

function isConflict(error: unknown, code: string) {
  return error instanceof ActionContractError && error.errorCode === code;
}

async function ensurePersonPage(
  email: string,
  name: string | undefined,
  ctx: ActionRunContext | undefined,
) {
  const userEmail = requireUser();
  const stored = await ensureCollection(userEmail, ctx);
  const keyPropertyId = stored.emailPropertyId;
  const existing = await claimedPage(stored.databaseId, keyPropertyId, email);
  if (existing) return { documentId: existing, created: false };
  const contract = await getDatabaseMutationContract(targetOf(stored));
  if (contract.naturalKeyPropertyId !== keyPropertyId) failKeyChanged();
  try {
    const result = await upsertDatabaseRow(
      {
        target: contract.target,
        expectedSchemaRevision: contract.schemaRevision,
        idempotencyKey: `mail-notes:${nanoid()}`,
        keyValue: email,
        expectedRowRevision: null,
        title: name?.trim() || email,
      },
      ctx,
    );
    return { documentId: result.receipt.row.documentId, created: true };
  } catch (error) {
    if (!isConflict(error, "ROW_ALREADY_EXISTS")) throw error;
    const raced = await claimedPage(stored.databaseId, keyPropertyId, email);
    if (!raced) throw error;
    return { documentId: raced, created: false };
  }
}

function escapeUrlChar(char: string) {
  if (char === "(") return "%28";
  if (char === ")") return "%29";
  return encodeURIComponent(char);
}

export function mailNoteLine(args: {
  date: string;
  text: string;
  link?: { label: string; url: string } | undefined;
}) {
  const text = args.text.replace(/\s+/g, " ").trim();
  const label = args.link?.label.replace(/[[\]\s]+/g, " ").trim();
  const link =
    args.link && label
      ? ` [${label}](${args.link.url.replace(/[()\s]/g, escapeUrlChar)})`
      : "";
  return `- **${args.date}** ${text}${link}`;
}

function endsWithLine(content: string, line: string) {
  const body = content.trimEnd();
  const last = line.trim();
  return body === last || body.endsWith(`\n${last}`);
}

async function appendLine(
  documentId: string,
  line: string,
  ctx: ActionRunContext | undefined,
) {
  const { doc, losses } = parseNfmWithLosses(line);
  if (losses.length > 0) {
    fail("This note can't be stored on a Content page.", {
      errorCode: "DOCUMENT_BODY_UNREPRESENTABLE",
      statusCode: 422,
    });
  }
  const blocks = docToNfm(doc);
  for (let attempt = 0; ; attempt++) {
    const page = await readPage(documentId, "editor");
    assertAgentsMayEditPageText(page, ctx);
    const existing = (page.content as string | null) ?? "";
    if (endsWithLine(existing, blocks)) return false;
    try {
      const wroteLiveCopy = await appendContentLiveCopyBlocks(documentId, {
        cause: { ctx, operation: "add-mail-note" },
        blocks,
      });
      if (!wroteLiveCopy) {
        const saved = await updateDocument.run(
          {
            id: documentId,
            content: appendNfmBlocks(existing, blocks),
            baseRevision: documentRevisionToken(page.bodyRevision, existing),
            preserveLeadingTitleHeading: true,
          },
          serverSaveContext(ctx),
        );
        if ("conflict" in saved) {
          fail("The note page changed while the note was added. Try again.", {
            errorCode: "DOCUMENT_REVISION_CONFLICT",
            statusCode: 409,
          });
        }
      }
      return true;
    } catch (error) {
      if (attempt === 0 && isConflict(error, "DOCUMENT_REVISION_CONFLICT")) {
        continue;
      }
      throw error;
    }
  }
}

export async function addMailNote(
  args: {
    email: string;
    text: string;
    name?: string | undefined;
    date?: string | undefined;
    link?: { label: string; url: string } | undefined;
  },
  ctx: ActionRunContext | undefined,
) {
  const { documentId, created } = await ensurePersonPage(
    args.email,
    args.name,
    ctx,
  );
  const appended = await appendLine(
    documentId,
    mailNoteLine({
      date: args.date ?? new Date().toISOString().slice(0, 10),
      text: args.text,
      link: args.link,
    }),
    ctx,
  );
  await writeAppState("refresh-signal", { ts: Date.now() }).catch(
    (error: unknown) => {
      console.warn(
        "[add-mail-note] refresh signal failed:",
        error instanceof Error ? error.message : String(error),
      );
    },
  );
  return {
    note: noteOf(await readPage(documentId, "viewer")),
    created,
    appended,
  };
}
