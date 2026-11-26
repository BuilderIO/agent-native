import { ActionContractError } from "@agent-native/core";
import { fail, type ActionRunContext } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import {
  buildDeepLink,
  getAppConfig,
  getRequestUserEmail,
  toAbsoluteOpenUrl,
} from "@agent-native/core/server";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { documentRevisionToken } from "../server/lib/document-revision.js";
import { appendContentLiveCopyBlocks } from "../server/live-copy/write.js";
import {
  appendNfmBlocks,
  docToNfm,
  parseNfmWithLosses,
} from "../shared/nfm.js";
import { serializePropertyValue } from "../shared/properties.js";
import { provisionContentSpaces } from "./_content-spaces.js";
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
  generation: z.number().int().min(0),
});
type StoredCollection = z.infer<typeof storedCollectionSchema>;

export const mailNoteSchema = z.object({
  markdown: z.string(),
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
  const stored = await getUserSetting(userEmail, SETTING_KEY);
  if (stored === null) return null;
  const parsed = storedCollectionSchema.safeParse(stored);
  if (!parsed.success) {
    fail("The saved Mail notes collection setting is unreadable.", {
      errorCode: "mail_notes_setting_invalid",
      statusCode: 500,
    });
  }
  return parsed.data;
}

async function liveCollection(stored: StoredCollection) {
  const rows = await getDb()
    .select({
      deletedAt: schema.contentDatabases.deletedAt,
      naturalKeyPropertyId: schema.contentDatabases.naturalKeyPropertyId,
      trashedAt: schema.documents.trashedAt,
    })
    .from(schema.contentDatabases)
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.contentDatabases.documentId),
    )
    .where(eq(schema.contentDatabases.id, stored.databaseId));
  const row = rows.at(0);
  if (!row || row.deletedAt || row.trashedAt) return null;
  return { naturalKeyPropertyId: row.naturalKeyPropertyId };
}

function targetOf(stored: StoredCollection): DatabaseMutationTarget {
  return {
    spaceId: stored.spaceId,
    databaseId: stored.databaseId,
    databaseDocumentId: stored.databaseDocumentId,
  } as DatabaseMutationTarget;
}

async function addTextProperty(
  stored: StoredCollection,
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
  const stored: StoredCollection = {
    spaceId: personalSpaceId,
    databaseId: created.database.id,
    databaseDocumentId: created.database.documentId,
    generation,
  };
  await addTextProperty(stored, "Email", true, ctx);
  await addTextProperty(stored, "Company", false, ctx);
  await putUserSetting(userEmail, SETTING_KEY, stored);
  return stored;
}

async function ensureCollection(
  userEmail: string,
  ctx: ActionRunContext | undefined,
) {
  const stored = await readStored(userEmail);
  if (stored) {
    const live = await liveCollection(stored);
    if (live?.naturalKeyPropertyId) {
      return { stored, keyPropertyId: live.naturalKeyPropertyId };
    }
  }
  const next = await createCollection(
    userEmail,
    stored ? stored.generation + 1 : 0,
    ctx,
  );
  const live = await liveCollection(next);
  if (!live?.naturalKeyPropertyId) {
    fail("Content created Mail notes but couldn't read it back. Try again.", {
      errorCode: "mail_notes_readback_failed",
      statusCode: 503,
    });
  }
  return { stored: next, keyPropertyId: live.naturalKeyPropertyId };
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
  return claims.at(0)?.documentId ?? null;
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

function noteOf(page: {
  id: string;
  content: unknown;
  updatedAt: unknown;
}): MailNote {
  return {
    markdown: typeof page.content === "string" ? page.content : "",
    url: noteUrl(page.id),
    updatedAt: String(page.updatedAt ?? ""),
  };
}

export async function readMailNote(email: string): Promise<MailNote | null> {
  const userEmail = requireUser();
  const stored = await readStored(userEmail);
  if (!stored) return null;
  const live = await liveCollection(stored);
  if (!live?.naturalKeyPropertyId) return null;
  const documentId = await claimedPage(
    stored.databaseId,
    live.naturalKeyPropertyId,
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
  const { stored, keyPropertyId } = await ensureCollection(userEmail, ctx);
  const existing = await claimedPage(stored.databaseId, keyPropertyId, email);
  if (existing) return { documentId: existing, created: false };
  const contract = await getDatabaseMutationContract(targetOf(stored));
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
      return;
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
  await appendLine(
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
  return { note: noteOf(await readPage(documentId, "viewer")), created };
}
