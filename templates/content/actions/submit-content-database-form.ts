import { defineAction, embedApp } from "@agent-native/core";
import {
  fail,
  isActionContractError,
  type ActionRunContext,
} from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { buildDeepLink } from "@agent-native/core/server";
import {
  accessFilter,
  assertAccess,
  currentAccess,
  ForbiddenError,
} from "@agent-native/core/sharing";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { syncAnalyticsChartCitations } from "../server/lib/analytics-chart-citations.js";
import { documentAttributionActor } from "../server/lib/document-attribution.js";
import { firstRow } from "../server/lib/first-row.js";
import { assertInteractiveHtmlBlocks } from "../server/lib/interactive-html-blocks.js";
import { syncPageLinks } from "../server/lib/page-links.js";
import { syncPrivateMediaReferences } from "../server/lib/private-media-references.js";
import type {
  ContentDatabaseView,
  SubmitContentDatabaseFormResponse,
} from "../shared/api.js";
import type {
  ContentFormProblem,
  ContentFormSender,
} from "../shared/content-forms.js";
import { FORM_TITLE_QUESTION_KEY } from "../shared/form-question-block.js";
import {
  blocksStorageTarget,
  isBlocksPropertyType,
  isEmptyPropertyValue,
  isComputedPropertyType,
  normalizePropertyValue,
  parsePropertyOptions,
  serializePropertyValue,
  type DocumentPropertyOption,
  type DocumentPropertyType,
  type DocumentPropertyValue,
} from "../shared/properties.js";
import {
  lockContentDatabaseMutation,
  touchContentDatabase,
} from "./_content-database-mutation-lock.js";
import { ensureDocumentFilesMembership } from "./_content-files.js";
import {
  assertContentFormUnchanged,
  contentFormReceiptAnswers,
  loadContentFormQuestions,
  readContentFormRow,
} from "./_content-form-questions.js";
import {
  assertNoContentFormSubmission,
  assertSameContentFormSubmission,
  contentFormAnswersDigest,
  ContentFormSubmissionExists,
  deleteContentFormDraftRow,
  findContentFormSubmission,
  insertContentFormSubmission,
  sortedContentFormEntries,
  type ContentFormSubmissionRow,
} from "./_content-form-receipts.js";
import {
  ensureNaturalKeyClaim,
  strictValue,
} from "./_database-row-mutation.js";
import { assertCollectionAcceptsNewRows } from "./_document-source.js";
import { nextAppendPosition } from "./_position-utils.js";
import { nanoid, parseDatabaseViewConfig } from "./_property-utils.js";
import { validateRelationWrite } from "./_relation-values.js";

const submitContentDatabaseFormSchema = z.object({
  databaseId: z.string().min(1).describe("Content collection ID"),
  viewId: z
    .string()
    .min(1)
    .optional()
    .describe("Form view ID; defaults to the active or first form view"),
  title: z.string().max(500).optional().describe("Row page title"),
  content: z
    .string()
    .optional()
    .describe(
      "Row page body for narrative request details that are not represented by an enabled form property. Omit when a primary Blocks form field already carries the body.",
    ),
  propertyEntries: z
    .array(
      z.object({
        property: z
          .string()
          .min(1)
          .describe("Property definition ID or exact property name"),
        value: z.unknown().describe("Value to submit for this property"),
      }),
    )
    .min(1)
    .optional()
    .describe(
      "Form values as explicit property/value entries. Include every enabled field value the user supplied. Select, status, and multi-select values may use option IDs or labels.",
    ),
  propertyValues: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Compatibility map for programmatic callers. Agents should use propertyEntries because dynamic object keys may be discarded by model tool schemas. Omit both arguments only for a deliberately title-only submission.",
    ),
  idempotencyKey: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "A new random key per submission. Resending the same key with the same answers returns the first submission's row instead of adding another; the same key with different answers is refused.",
    ),
});

export type PropertyDefinitionRow =
  typeof schema.documentPropertyDefinitions.$inferSelect;

class FormAnswerProblem extends Error {}

export function propertyDefinitionFingerprint(
  definitions: PropertyDefinitionRow[],
) {
  return JSON.stringify(
    definitions
      .map((definition) => ({
        id: definition.id,
        name: definition.name,
        type: definition.type,
        systemRole: definition.systemRole,
        visibility: definition.visibility,
        optionsJson: definition.optionsJson,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
}

function resolveFormView(
  views: ContentDatabaseView[],
  activeViewId: string,
  requestedViewId?: string,
) {
  const requested = requestedViewId
    ? views.find((view) => view.id === requestedViewId)
    : (views.find((view) => view.id === activeViewId && view.type === "form") ??
      views.find((view) => view.type === "form"));
  if (!requested) throw new Error("This database does not have a form view.");
  if (requested.type !== "form") {
    throw new Error(`Database view "${requested.id}" is not a form view.`);
  }
  return requested;
}

function optionCandidates(value: unknown, multiple: boolean): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((candidate): candidate is string => typeof candidate === "string")
      .map((candidate) => candidate.trim())
      .filter(Boolean);
  }
  if (value === null || value === undefined || value === "") return [];
  const text = (
    typeof value === "string" ? value : (JSON.stringify(value) ?? "")
  ).trim();
  if (!text) return [];
  return multiple
    ? text
        .split(/[\n,]/)
        .map((candidate) => candidate.trim())
        .filter(Boolean)
    : [text];
}

function resolveOption(
  candidate: string,
  options: DocumentPropertyOption[],
  propertyName: string,
) {
  const exactId = options.find((option) => option.id === candidate);
  if (exactId) return exactId.id;
  const normalized = candidate.toLocaleLowerCase();
  const labelMatches = options.filter(
    (option) => option.name.trim().toLocaleLowerCase() === normalized,
  );
  if (labelMatches.length === 1) return labelMatches[0].id;
  if (labelMatches.length > 1) {
    throw new FormAnswerProblem(
      `Value "${candidate}" is ambiguous for "${propertyName}". Use an option ID.`,
    );
  }
  const allowed = options.map((option) => option.name).join(", ");
  throw new FormAnswerProblem(
    `Unknown option "${candidate}" for "${propertyName}".${allowed ? ` Choose one of: ${allowed}.` : " This property has no options."}`,
  );
}

function isValidSubmittedDatePart(value: unknown): boolean {
  if (typeof value === "number") {
    return (
      Number.isFinite(value) &&
      value % 60_000 === 0 &&
      !Number.isNaN(new Date(value).getTime())
    );
  }
  if (typeof value !== "string") return false;
  const match = value
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = hourText === undefined ? 0 : Number(hourText);
  const minute = minuteText === undefined ? 0 : Number(minuteText);
  if (hour > 23 || minute > 59) return false;
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  return (
    calendarDate.getUTCFullYear() === year &&
    calendarDate.getUTCMonth() === month - 1 &&
    calendarDate.getUTCDate() === day
  );
}

const ANSWER_ERROR_CODES = new Set([
  "INVALID_PROPERTY_VALUE",
  "RELATION_TARGET_MISSING",
  "RELATION_LIMIT_EXCEEDED",
  "INVALID_RELATION_TARGET",
]);

const CHECKBOX_WORDS = new Map([
  ["true", true],
  ["yes", true],
  ["on", true],
  ["1", true],
  ["checked", true],
  ["false", false],
  ["no", false],
  ["off", false],
  ["0", false],
  ["unchecked", false],
]);

function readableSubmittedValue(
  type: DocumentPropertyType,
  value: unknown,
  explicitlyEmpty: boolean,
): unknown {
  if (type === "date" || isBlocksPropertyType(type)) {
    return normalizePropertyValue(type, value);
  }
  if (explicitlyEmpty) return null;
  if (typeof value === "string") {
    if (type === "checkbox") {
      return CHECKBOX_WORDS.get(value.trim().toLocaleLowerCase()) ?? value;
    }
    if (type === "email" || type === "url") return value.trim();
    return normalizePropertyValue(type, value);
  }
  return Array.isArray(value) &&
    (type === "person" || type === "files_media" || type === "relation")
    ? normalizePropertyValue(type, value)
    : value;
}

async function normalizeSubmittedPropertyValue(
  definition: PropertyDefinitionRow,
  value: unknown,
): Promise<DocumentPropertyValue> {
  const type = definition.type as DocumentPropertyType;
  const explicitlyEmpty =
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0);
  let normalized: unknown;
  if (type === "select" || type === "status" || type === "multi_select") {
    if (Array.isArray(value)) {
      const invalidCandidates = value.filter(
        (candidate) => typeof candidate !== "string" || candidate.trim() === "",
      );
      const nonEmptyCandidates = value.filter(
        (candidate): candidate is string =>
          typeof candidate === "string" && candidate.trim() !== "",
      );
      if (
        invalidCandidates.length > 0 ||
        (type !== "multi_select" && nonEmptyCandidates.length > 1)
      ) {
        throw new FormAnswerProblem(
          `Invalid value for "${definition.name}"; every supplied option must be preserved exactly once.`,
        );
      }
    }
    const options = parsePropertyOptions(definition.optionsJson).options ?? [];
    const scalarOption =
      type === "multi_select" && typeof value === "string" ? value.trim() : "";
    const exactScalarOption =
      scalarOption &&
      options.some(
        (option) =>
          option.id === scalarOption ||
          option.name.trim().toLocaleLowerCase() ===
            scalarOption.toLocaleLowerCase(),
      );
    const values = (
      exactScalarOption
        ? [scalarOption]
        : optionCandidates(value, type === "multi_select")
    ).map((candidate) => resolveOption(candidate, options, definition.name));
    normalized =
      type === "multi_select" ? [...new Set(values)] : (values[0] ?? null);
  } else {
    if (
      ["person", "relation", "files_media"].includes(type) &&
      Array.isArray(value) &&
      value.some((candidate) => typeof candidate !== "string")
    ) {
      throw new FormAnswerProblem(
        `Invalid value for "${definition.name}"; every supplied item must be preserved exactly once.`,
      );
    }
    if (type === "date") {
      const dateParts =
        value !== null && typeof value === "object" && !Array.isArray(value)
          ? [
              (value as { start?: unknown }).start,
              ...("end" in value ? [(value as { end?: unknown }).end] : []),
            ]
          : [value];
      const explicitIncludeTime =
        value !== null && typeof value === "object" && !Array.isArray(value)
          ? (value as { includeTime?: unknown }).includeTime
          : undefined;
      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        dateParts.some((part) => typeof part === "number")
      ) {
        throw new FormAnswerProblem(
          `Invalid value for "${definition.name}"; numeric dates are only supported as scalar values.`,
        );
      }
      if (
        typeof explicitIncludeTime === "boolean" &&
        dateParts.some((part) => {
          if (
            part === undefined ||
            part === null ||
            (typeof part === "string" && part.trim() === "")
          ) {
            return false;
          }
          const hasTime =
            typeof part === "number" ||
            (typeof part === "string" && part.includes("T"));
          return hasTime !== explicitIncludeTime;
        })
      ) {
        throw new FormAnswerProblem(
          `Invalid value for "${definition.name}"; includeTime must match the supplied date precision.`,
        );
      }
      if (
        dateParts.some(
          (part) =>
            part !== undefined &&
            part !== null &&
            !(typeof part === "string" && part.trim() === "") &&
            !isValidSubmittedDatePart(part),
        )
      ) {
        throw new FormAnswerProblem(
          `Invalid value for "${definition.name}"; use a real ISO calendar date.`,
        );
      }
      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        explicitIncludeTime === undefined &&
        dateParts.some((part) => typeof part === "string" && part.includes("T"))
      ) {
        throw new FormAnswerProblem(
          `Invalid value for "${definition.name}"; includeTime is required for timed date ranges.`,
        );
      }
    }
    normalized = readableSubmittedValue(type, value, explicitlyEmpty);
  }
  const rawDateEnd =
    type === "date" &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "end" in value
      ? (value as { end?: unknown }).end
      : undefined;
  const hasSuppliedDateEnd =
    rawDateEnd !== undefined &&
    rawDateEnd !== null &&
    (typeof rawDateEnd !== "string" || rawDateEnd.trim() !== "");
  if (
    hasSuppliedDateEnd &&
    (typeof normalized !== "object" ||
      normalized === null ||
      Array.isArray(normalized) ||
      !("end" in normalized) ||
      !normalized.end)
  ) {
    throw new FormAnswerProblem(
      `Invalid value for "${definition.name}"; the supplied date end could not be preserved.`,
    );
  }
  if (
    type === "date" &&
    typeof normalized === "object" &&
    normalized !== null &&
    !Array.isArray(normalized) &&
    "includeTime" in normalized &&
    normalized.includeTime === true &&
    "end" in normalized &&
    typeof normalized.end === "string" &&
    "start" in normalized &&
    typeof normalized.start === "string" &&
    normalized.end < normalized.start
  ) {
    throw new FormAnswerProblem(
      `Invalid value for "${definition.name}"; the supplied date end is before the start.`,
    );
  }
  if (
    !explicitlyEmpty &&
    isEmptyPropertyValue(normalized as DocumentPropertyValue)
  ) {
    throw new FormAnswerProblem(
      `Invalid value for "${definition.name}"; the supplied value could not be preserved as ${type}.`,
    );
  }
  if (isBlocksPropertyType(type)) {
    return typeof normalized === "string" ? normalized : null;
  }
  if (type === "relation") {
    return isEmptyPropertyValue(normalized as DocumentPropertyValue)
      ? null
      : validateRelationWrite(getDb(), {
          definition,
          nextValue: normalized,
          previousValue: null,
        });
  }
  return strictValue(definition, normalized);
}

export type CollectionFormScope = "collection" | "form";

export interface CollectionFormQuestionRule {
  key: string;
  wording: string;
  required: boolean;
}

export interface PreparedCollectionFormRecord {
  title: string;
  documentContent: string;
  values: Map<string, DocumentPropertyValue>;
  standardValues: Array<[string, DocumentPropertyValue]>;
  additionalBlocks: Array<[string, DocumentPropertyValue]>;
  submittedProperties: Array<{ propertyId: string; name: string }>;
}

export interface CollectionFormRecordCreated {
  documentId: string;
  itemId: string;
  now: string;
}

type ContentDb = ReturnType<typeof getDb>;
type ContentDatabaseRow = typeof schema.contentDatabases.$inferSelect;

async function resolveSubmittedProperties(
  definitions: PropertyDefinitionRow[],
  questionPropertyIds: Set<string>,
  submitted: ReadonlyArray<readonly [string, unknown]>,
  scope: CollectionFormScope,
) {
  const candidates =
    scope === "form"
      ? definitions.filter((definition) =>
          questionPropertyIds.has(definition.id),
        )
      : definitions;
  const byId = new Map(
    candidates.map((definition) => [definition.id, definition]),
  );
  const byName = new Map<string, PropertyDefinitionRow[]>();
  for (const definition of candidates) {
    const key = definition.name.trim().toLocaleLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), definition]);
  }

  const resolved = new Map<string, DocumentPropertyValue>();
  const seen = new Set<string>();
  const problems: ContentFormProblem[] = [];
  for (const [inputKey, inputValue] of submitted) {
    const exact = byId.get(inputKey);
    const named = byName.get(inputKey.trim().toLocaleLowerCase()) ?? [];
    const definition = exact ?? (named.length === 1 ? named[0] : undefined);
    const problem = (message: string) => {
      problems.push({
        question: definition?.id ?? inputKey,
        wording: definition?.name ?? null,
        message,
      });
    };
    if (exact && named.some((candidate) => candidate.id !== exact.id)) {
      problem(
        `Property identifier "${inputKey}" matches one property ID and another property name. Use an unambiguous property name or ID.`,
      );
      continue;
    }
    if (!exact && named.length > 1) {
      problem(
        `Property name "${inputKey}" is ambiguous. Use a property definition ID.`,
      );
      continue;
    }
    if (!definition) {
      problem(
        scope === "form"
          ? `This form has no question "${inputKey}".`
          : `Unknown form property "${inputKey}".`,
      );
      continue;
    }
    if (definition.systemRole) {
      problem(`System property "${definition.name}" cannot be submitted.`);
      continue;
    }
    if (!questionPropertyIds.has(definition.id)) {
      problem(`Property "${definition.name}" is not enabled in this form.`);
      continue;
    }
    if (isComputedPropertyType(definition.type as DocumentPropertyType)) {
      problem(`Computed property "${definition.name}" cannot be submitted.`);
      continue;
    }
    if (seen.has(definition.id)) {
      problem(`Property "${definition.name}" was submitted more than once.`);
      continue;
    }
    seen.add(definition.id);
    try {
      resolved.set(
        definition.id,
        await normalizeSubmittedPropertyValue(definition, inputValue),
      );
    } catch (error) {
      if (
        !(error instanceof FormAnswerProblem) &&
        !(
          isActionContractError(error) &&
          ANSWER_ERROR_CODES.has(error.errorCode)
        )
      ) {
        throw error;
      }
      problem(error.message);
    }
  }
  return { values: resolved, problems };
}

export async function prepareCollectionFormRecord(input: {
  definitions: PropertyDefinitionRow[];
  questions: CollectionFormQuestionRule[];
  title?: string | undefined;
  content?: string | undefined;
  entries: ReadonlyArray<readonly [string, unknown]>;
  scope: CollectionFormScope;
  ctx?: ActionRunContext | undefined;
}): Promise<
  | { ok: false; problems: ContentFormProblem[] }
  | { ok: true; record: PreparedCollectionFormRecord }
> {
  const { definitions, questions, content } = input;
  const questionPropertyIds = new Set(
    questions
      .filter((question) => question.key !== FORM_TITLE_QUESTION_KEY)
      .map((question) => question.key),
  );
  const { values, problems } = await resolveSubmittedProperties(
    definitions,
    questionPropertyIds,
    input.entries,
    input.scope,
  );
  const normalizedTitle = input.title?.trim() ?? "";
  const definitionById = new Map(
    definitions.map((definition) => [definition.id, definition]),
  );
  const answeredWithProblem = new Set(
    problems.map((problem) => problem.question),
  );
  for (const question of questions) {
    if (!question.required || answeredWithProblem.has(question.key)) continue;
    const missing =
      question.key === FORM_TITLE_QUESTION_KEY
        ? !normalizedTitle
        : isEmptyPropertyValue(values.get(question.key) ?? null);
    if (missing) {
      problems.push({
        question: question.key,
        wording: question.wording,
        message: `"${question.wording}" is required.`,
      });
    }
  }

  const primaryBlocks = definitions.find((definition) => {
    const type = definition.type as DocumentPropertyType;
    return (
      isBlocksPropertyType(type) &&
      blocksStorageTarget(parsePropertyOptions(definition.optionsJson)) ===
        "document_body"
    );
  });
  const primaryContent = primaryBlocks
    ? values.get(primaryBlocks.id)
    : undefined;
  if (
    primaryBlocks &&
    typeof primaryContent === "string" &&
    content !== undefined &&
    primaryContent !== content
  ) {
    problems.push({
      question: primaryBlocks.id,
      wording: primaryBlocks.name,
      message:
        "Provide narrative body content either through the primary Blocks form field or content, not both.",
    });
  }
  if (problems.length > 0) return { ok: false, problems };

  const documentContent =
    typeof primaryContent === "string" ? primaryContent : (content ?? "");
  const standardValues = [...values.entries()].filter(([propertyId]) => {
    const definition = definitionById.get(propertyId);
    return (
      definition &&
      !isBlocksPropertyType(definition.type as DocumentPropertyType)
    );
  });
  const additionalBlocks = [...values.entries()].filter(([propertyId]) => {
    const definition = definitionById.get(propertyId);
    return (
      definition &&
      isBlocksPropertyType(definition.type as DocumentPropertyType) &&
      propertyId !== primaryBlocks?.id
    );
  });
  for (const body of [
    documentContent,
    ...additionalBlocks.map(([, value]) => value),
  ]) {
    if (typeof body === "string") {
      assertInteractiveHtmlBlocks(input.ctx, null, body);
    }
  }
  return {
    ok: true,
    record: {
      title: normalizedTitle,
      documentContent,
      values,
      standardValues,
      additionalBlocks,
      submittedProperties: [...values.keys()].map((propertyId) => ({
        propertyId,
        name: definitionById.get(propertyId)?.name ?? propertyId,
      })),
    },
  };
}

export async function writeCollectionFormRecord<TInserted>(input: {
  database: ContentDatabaseRow;
  databaseDocument: Pick<
    typeof schema.documents.$inferSelect,
    "hideFromSearch" | "visibility"
  >;
  definitionsFingerprint: string;
  record: PreparedCollectionFormRecord;
  createdBy: string | null;
  shareCreatedBy: string;
  privateMediaActor: string | null | false;
  assertNotSubmitted: (tx: ContentDb) => Promise<void>;
  verifyLocked: (tx: ContentDb) => Promise<void>;
  afterInsert: (
    tx: ContentDb,
    created: CollectionFormRecordCreated,
  ) => Promise<TInserted>;
}): Promise<CollectionFormRecordCreated & { inserted: TInserted }> {
  const { database, databaseDocument, definitionsFingerprint } = input;
  const {
    title: normalizedTitle,
    documentContent,
    standardValues,
    additionalBlocks,
  } = input.record;
  const databaseId = database.id;
  const documentId = nanoid();
  const itemId = nanoid();
  const now = new Date().toISOString();
  const db = getDb();

  const inserted = await db.transaction(async (tx) => {
    const lockedDb = tx as unknown as ContentDb;
    await lockContentDatabaseMutation(lockedDb, databaseId);
    await input.assertNotSubmitted(lockedDb);
    const lockedDatabase = firstRow(
      await tx
        .select({
          viewConfigJson: schema.contentDatabases.viewConfigJson,
          deletedAt: schema.contentDatabases.deletedAt,
          naturalKeyPropertyId: schema.contentDatabases.naturalKeyPropertyId,
          spaceId: schema.contentDatabases.spaceId,
          orgId: schema.contentDatabases.orgId,
          ownerEmail: schema.contentDatabases.ownerEmail,
        })
        .from(schema.contentDatabases)
        .where(eq(schema.contentDatabases.id, databaseId)),
    );
    if (
      !lockedDatabase ||
      lockedDatabase.deletedAt !== null ||
      lockedDatabase.viewConfigJson !== database.viewConfigJson ||
      lockedDatabase.spaceId !== database.spaceId ||
      lockedDatabase.orgId !== database.orgId ||
      lockedDatabase.ownerEmail !== database.ownerEmail
    ) {
      fail("The database form changed before form submission completed.", {
        errorCode: "form_changed",
        statusCode: 409,
      });
    }
    await tx
      .update(schema.documentShares)
      .set({ role: sql`${schema.documentShares.role}` })
      .where(eq(schema.documentShares.resourceId, database.documentId))
      .returning({ id: schema.documentShares.id });
    const lockedDocuments = await tx
      .update(schema.documents)
      .set({ updatedAt: sql`${schema.documents.updatedAt}` })
      .where(eq(schema.documents.id, database.documentId))
      .returning({ id: schema.documents.id });
    if (lockedDocuments.length !== 1) {
      fail("Database page not found.", {
        errorCode: "form_unavailable",
        statusCode: 404,
      });
    }
    await input.verifyLocked(lockedDb);
    await touchContentDatabase(lockedDb, databaseId, now);
    const lockedDefinitions = await tx
      .select()
      .from(schema.documentPropertyDefinitions)
      .where(
        and(
          eq(schema.documentPropertyDefinitions.databaseId, databaseId),
          eq(
            schema.documentPropertyDefinitions.ownerEmail,
            database.ownerEmail,
          ),
        ),
      );
    if (
      propertyDefinitionFingerprint(lockedDefinitions) !==
      definitionsFingerprint
    ) {
      fail("Database properties changed before form submission completed.", {
        errorCode: "form_changed",
        statusCode: 409,
      });
    }
    for (const [propertyId, value] of standardValues) {
      const definition = lockedDefinitions.find(
        (candidate) => candidate.id === propertyId,
      );
      if (definition?.type !== "relation" || value === null) continue;
      await validateRelationWrite(lockedDb, {
        definition,
        nextValue: value,
        previousValue: null,
      });
    }
    await ensureNaturalKeyClaim(
      lockedDb,
      {
        database: {
          ...database,
          naturalKeyPropertyId: lockedDatabase.naturalKeyPropertyId,
        },
      },
      {
        itemId,
        documentId,
        values: new Map(
          standardValues.flatMap(([propertyId, value]) =>
            value === null
              ? []
              : [[propertyId, serializePropertyValue(value)] as const],
          ),
        ),
        now,
      },
    );
    const maxDocumentPosition = firstRow(
      await tx
        .select({ max: sql<unknown>`COALESCE(MAX(position), -1)` })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.ownerEmail, database.ownerEmail),
            eq(schema.documents.parentId, database.documentId),
          ),
        ),
    );
    const maxItemPosition = firstRow(
      await tx
        .select({ max: sql<unknown>`COALESCE(MAX(position), -1)` })
        .from(schema.contentDatabaseItems)
        .where(eq(schema.contentDatabaseItems.databaseId, databaseId)),
    );
    const inheritedShares = await tx
      .select({
        principalType: schema.documentShares.principalType,
        principalId: schema.documentShares.principalId,
        role: schema.documentShares.role,
      })
      .from(schema.documentShares)
      .where(eq(schema.documentShares.resourceId, database.documentId));

    await tx.insert(schema.documents).values({
      id: documentId,
      spaceId: database.spaceId,
      ownerEmail: database.ownerEmail,
      orgId: database.orgId,
      parentId: database.documentId,
      title: normalizedTitle,
      content: documentContent,
      icon: null,
      position: nextAppendPosition(maxDocumentPosition?.max),
      isFavorite: 0,
      hideFromSearch: databaseDocument.hideFromSearch,
      visibility: databaseDocument.visibility,
      createdBy: input.createdBy,
      updatedBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    });
    if (input.privateMediaActor !== false) {
      await syncPrivateMediaReferences(lockedDb, {
        documentId,
        after: documentContent,
        userEmail: input.privateMediaActor,
      });
    }
    await syncAnalyticsChartCitations(lockedDb, {
      documentId,
      after: documentContent,
    });
    await syncPageLinks(lockedDb, {
      documentId,
      after: documentContent,
    });
    await tx.insert(schema.contentDatabaseItems).values({
      id: itemId,
      ownerEmail: database.ownerEmail,
      orgId: database.orgId,
      databaseId,
      documentId,
      position: nextAppendPosition(maxItemPosition?.max),
      createdAt: now,
      updatedAt: now,
    });
    if (inheritedShares.length > 0) {
      await tx.insert(schema.documentShares).values(
        inheritedShares.map((share) => ({
          id: nanoid(),
          resourceId: documentId,
          principalType: share.principalType,
          principalId: share.principalId,
          role: share.role,
          createdBy: input.shareCreatedBy,
          createdAt: now,
        })),
      );
    }
    if (standardValues.length > 0) {
      await tx.insert(schema.documentPropertyValues).values(
        standardValues.map(([propertyId, value]) => ({
          id: nanoid(),
          ownerEmail: database.ownerEmail,
          documentId,
          propertyId,
          valueJson: serializePropertyValue(value),
          createdAt: now,
          updatedAt: now,
        })),
      );
    }
    if (additionalBlocks.length > 0) {
      await tx.insert(schema.documentBlockFieldContents).values(
        additionalBlocks.map(([propertyId, value]) => ({
          id: nanoid(),
          ownerEmail: database.ownerEmail,
          documentId,
          propertyId,
          content: typeof value === "string" ? value : "",
          createdAt: now,
          updatedAt: now,
        })),
      );
    }

    await ensureDocumentFilesMembership(tx, documentId, now);

    const savedDocument = firstRow(
      await tx
        .select({
          id: schema.documents.id,
          title: schema.documents.title,
          content: schema.documents.content,
        })
        .from(schema.documents)
        .where(eq(schema.documents.id, documentId)),
    );
    const savedItem = firstRow(
      await tx
        .select({ id: schema.contentDatabaseItems.id })
        .from(schema.contentDatabaseItems)
        .where(
          and(
            eq(schema.contentDatabaseItems.id, itemId),
            eq(schema.contentDatabaseItems.documentId, documentId),
            eq(schema.contentDatabaseItems.databaseId, databaseId),
          ),
        ),
    );
    const savedPropertyValues =
      standardValues.length === 0
        ? []
        : await tx
            .select({
              propertyId: schema.documentPropertyValues.propertyId,
              valueJson: schema.documentPropertyValues.valueJson,
            })
            .from(schema.documentPropertyValues)
            .where(
              and(
                eq(schema.documentPropertyValues.documentId, documentId),
                inArray(
                  schema.documentPropertyValues.propertyId,
                  standardValues.map(([propertyId]) => propertyId),
                ),
              ),
            );
    const savedByPropertyId = new Map(
      savedPropertyValues.map((value) => [value.propertyId, value.valueJson]),
    );
    const standardValuesVerified = standardValues.every(
      ([propertyId, value]) =>
        savedByPropertyId.get(propertyId) === serializePropertyValue(value),
    );
    const savedAdditionalBlocks =
      additionalBlocks.length === 0
        ? []
        : await tx
            .select({
              propertyId: schema.documentBlockFieldContents.propertyId,
              content: schema.documentBlockFieldContents.content,
            })
            .from(schema.documentBlockFieldContents)
            .where(
              and(
                eq(schema.documentBlockFieldContents.documentId, documentId),
                inArray(
                  schema.documentBlockFieldContents.propertyId,
                  additionalBlocks.map(([propertyId]) => propertyId),
                ),
              ),
            );
    const savedBlockByPropertyId = new Map(
      savedAdditionalBlocks.map((value) => [value.propertyId, value.content]),
    );
    const additionalBlocksVerified = additionalBlocks.every(
      ([propertyId, value]) =>
        savedBlockByPropertyId.get(propertyId) ===
        (typeof value === "string" ? value : ""),
    );
    if (
      !savedDocument ||
      !savedItem ||
      savedDocument.title !== normalizedTitle ||
      savedDocument.content !== documentContent ||
      !standardValuesVerified ||
      !additionalBlocksVerified
    ) {
      // guard:allow-bare-error — invariant: rows read back in their own transaction always match what it wrote
      throw new Error(
        "The form submission could not be verified; no row was saved.",
      );
    }
    return input.afterInsert(lockedDb, { documentId, itemId, now });
  });
  return { documentId, itemId, now, inserted };
}

function submitContentDatabaseFormResponse(input: {
  databaseId: string;
  viewId: string;
  documentId: string;
  itemId: string;
  submittedProperties: Array<{ propertyId: string; name: string }>;
  submittedContent: boolean;
}): SubmitContentDatabaseFormResponse {
  return {
    databaseId: input.databaseId,
    viewId: input.viewId,
    createdItemId: input.itemId,
    createdDocumentId: input.documentId,
    urlPath: `/page/${input.documentId}`,
    deepLink: buildDeepLink({
      app: "content",
      view: "editor",
      params: { documentId: input.documentId },
    }),
    submittedProperties: input.submittedProperties,
    submittedContent: input.submittedContent,
    verified: true,
  };
}

export default defineAction({
  description:
    "Submit one row through a Content collection form. Validates that form's required questions, resolves option labels safely, writes the title, Blocks, and property values atomically, verifies the saved row, and returns its exact page link.",
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Submit Content Database Form",
    description:
      "Delegate a validated, atomic submission to an existing Content collection form.",
  },
  schema: submitContentDatabaseFormSchema,
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Open submitted page",
      description: "Open the new collection row in Content.",
      iframeTitle: "Agent-Native Content",
      openLabel: "Open in Content",
      height: 900,
    }),
  },
  run: async (
    {
      databaseId,
      viewId,
      title,
      content,
      propertyEntries,
      propertyValues,
      idempotencyKey,
    },
    ctx,
  ): Promise<SubmitContentDatabaseFormResponse> => {
    if (propertyEntries && propertyValues) {
      throw new Error("Provide propertyEntries or propertyValues, not both.");
    }
    const submittedEntries: ReadonlyArray<readonly [string, unknown]> =
      propertyEntries
        ? propertyEntries.map(({ property, value }) => [property, value])
        : Object.entries(propertyValues ?? {});
    const db = getDb();
    const [database] = await db
      .select()
      .from(schema.contentDatabases)
      .where(
        and(
          eq(schema.contentDatabases.id, databaseId),
          isNull(schema.contentDatabases.deletedAt),
        ),
      );
    if (!database) throw new Error(`Database "${databaseId}" not found.`);
    if (!database.spaceId) {
      throw new Error("Database does not belong to a Content space.");
    }

    const accessContext = currentAccess();
    const access = await assertAccess(
      "document",
      database.documentId,
      "editor",
      accessContext,
    );
    const databaseDocument = access.resource;
    if (databaseDocument.spaceId !== database.spaceId) {
      throw new Error(
        "Database page and database belong to different Content spaces.",
      );
    }
    const viewConfig = parseDatabaseViewConfig(database.viewConfigJson);
    const formView = resolveFormView(
      viewConfig.views,
      viewConfig.activeViewId,
      viewId,
    );
    const form = { databaseId, viewId: formView.id };
    const actor = documentAttributionActor();
    const sender: ContentFormSender = actor
      ? { kind: "signed_in", email: actor }
      : { kind: "anonymous" };
    const submissionKey = idempotencyKey ?? `collection-${nanoid(24)}`;
    const digest = contentFormAnswersDigest({
      title: title ?? null,
      content: content ?? null,
      entries: sortedContentFormEntries(submittedEntries),
    });
    const replay = (submission: ContentFormSubmissionRow) => {
      const stored = assertSameContentFormSubmission(submission, {
        sender,
        digest,
      });
      return submitContentDatabaseFormResponse({
        databaseId,
        viewId: formView.id,
        documentId: submission.documentId,
        itemId: submission.itemId,
        submittedProperties: stored.submittedProperties,
        submittedContent: stored.submittedContent,
      });
    };
    const existing = await findContentFormSubmission(db, form, submissionKey);
    if (existing) return replay(existing);

    await assertCollectionAcceptsNewRows(database.id, db);
    const definitions = await db
      .select()
      .from(schema.documentPropertyDefinitions)
      .where(
        and(
          eq(schema.documentPropertyDefinitions.databaseId, databaseId),
          eq(
            schema.documentPropertyDefinitions.ownerEmail,
            database.ownerEmail,
          ),
        ),
      );
    const definitionsFingerprint = propertyDefinitionFingerprint(definitions);
    const settings = await readContentFormRow(db, form);
    const { questions, canvas } = await loadContentFormQuestions({
      database,
      view: formView,
      definitions,
      settings,
      channel: "collection",
    });

    const prepared = await prepareCollectionFormRecord({
      definitions,
      questions,
      title,
      content,
      entries: submittedEntries,
      scope: "collection",
      ctx,
    });
    if (!prepared.ok) {
      fail(prepared.problems.map((problem) => problem.message).join(" "), {
        errorCode: "invalid_answers",
        statusCode: 422,
        details: { problems: prepared.problems },
      });
    }
    const { record } = prepared;
    let created: CollectionFormRecordCreated & {
      inserted: ContentFormSubmissionRow;
    };
    try {
      created = await writeCollectionFormRecord({
        database,
        databaseDocument,
        definitionsFingerprint,
        record,
        createdBy: actor,
        shareCreatedBy: actor ?? database.ownerEmail,
        privateMediaActor: actor,
        assertNotSubmitted: (tx) =>
          assertNoContentFormSubmission(tx, form, submissionKey),
        verifyLocked: async (tx) => {
          await assertContentFormUnchanged(tx, form, { settings, canvas });
          await assertCollectionAcceptsNewRows(database.id, tx);
          const lockedAccess = firstRow(
            await tx
              .select({ id: schema.documents.id })
              .from(schema.documents)
              .where(
                and(
                  eq(schema.documents.id, database.documentId),
                  accessFilter(
                    schema.documents,
                    schema.documentShares,
                    accessContext,
                    "editor",
                  ),
                ),
              ),
          );
          if (!lockedAccess) {
            throw new ForbiddenError(
              `Requires editor role on document ${database.documentId}`,
            );
          }
        },
        afterInsert: async (tx, inserted) => {
          const submission = await insertContentFormSubmission(tx, {
            form,
            created: inserted,
            channel: "collection",
            sender,
            idempotencyKey: submissionKey,
            digest,
            receipt: {
              formTitle: formView.name,
              answers: contentFormReceiptAnswers(questions, record),
              thankYouMessage: settings?.thankYouMessage ?? "",
              submittedProperties: record.submittedProperties,
              submittedContent: record.documentContent !== "",
            },
          });
          if (actor) await deleteContentFormDraftRow(tx, form, actor);
          return submission;
        },
      });
    } catch (error) {
      if (error instanceof ContentFormSubmissionExists) {
        return replay(error.submission);
      }
      throw error;
    }

    await writeAppState("refresh-signal", { ts: Date.now() });
    return submitContentDatabaseFormResponse({
      databaseId,
      viewId: formView.id,
      documentId: created.documentId,
      itemId: created.itemId,
      submittedProperties: record.submittedProperties,
      submittedContent: record.documentContent !== "",
    });
  },
  link: ({ result }) => {
    const documentId = (result as SubmitContentDatabaseFormResponse | null)
      ?.createdDocumentId;
    if (!documentId) return null;
    return {
      url: buildDeepLink({
        app: "content",
        view: "editor",
        params: { documentId },
      }),
      label: "Open submitted page",
      view: "editor",
    };
  },
});
