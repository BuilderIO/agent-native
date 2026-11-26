import { fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { firstRow } from "../server/lib/first-row.js";
import type {
  ContentDatabaseView,
  DocumentPropertySystemRole,
} from "../shared/api.js";
import type {
  ContentFormAnswerType,
  ContentFormChannel,
  ContentFormQuestion,
} from "../shared/content-forms.js";
import { contentDatabaseFormQuestions } from "../shared/database-form.js";
import {
  FORM_QUESTION_BLOCK_TYPE,
  FORM_TITLE_QUESTION_KEY,
  readFormQuestionData,
  type FormQuestionData,
} from "../shared/form-question-block.js";
import { parseRegistryBlockData } from "../shared/nfm-registry.js";
import { nfmToDoc, type PMNode } from "../shared/nfm.js";
import {
  isComputedPropertyType,
  isEmptyPropertyValue,
  parsePropertyOptions,
  type DocumentPropertyType,
  type DocumentPropertyValue,
} from "../shared/properties.js";
import type {
  PreparedCollectionFormRecord,
  PropertyDefinitionRow,
} from "./submit-content-database-form.js";

type ContentDb = ReturnType<typeof getDb>;
type ContentDatabaseRow = typeof schema.contentDatabases.$inferSelect;
export type ContentFormRow = typeof schema.contentForms.$inferSelect;

export interface ContentFormIdentity {
  databaseId: string;
  viewId: string;
}

export const CONTENT_FORM_TITLE_WORDING = "Name";

const ANSWER_TYPES: Partial<
  Record<DocumentPropertyType, ContentFormAnswerType>
> = {
  text: "text",
  blocks: "long_text",
  number: "number",
  select: "one_choice",
  status: "one_choice",
  multi_select: "several_choices",
  date: "date",
  checkbox: "checkbox",
  email: "email",
  url: "url",
  phone: "phone",
  person: "people",
  place: "place",
};

export interface ResolvedContentFormQuestion {
  key: string;
  wording: string;
  required: boolean;
  help: string | null;
  placeholder: string | null;
  definition: PropertyDefinitionRow | null;
  answerType: ContentFormAnswerType | null;
}

export type AnswerableContentFormQuestion = ResolvedContentFormQuestion & {
  answerType: ContentFormAnswerType;
};

export interface ContentFormCanvas {
  documentId: string;
  title: string;
  content: string;
}

export async function readContentFormRow(
  db: ContentDb,
  form: ContentFormIdentity,
): Promise<ContentFormRow | undefined> {
  return firstRow(
    await db
      .select()
      .from(schema.contentForms)
      .where(
        and(
          eq(schema.contentForms.databaseId, form.databaseId),
          eq(schema.contentForms.viewId, form.viewId),
        ),
      )
      .limit(1),
  );
}

function formUnavailable(message: string): never {
  return fail(message, { errorCode: "form_unavailable", statusCode: 409 });
}

function contentFormSettingsSnapshot(settings: ContentFormRow | undefined) {
  return JSON.stringify(
    settings
      ? [
          settings.linkToken,
          settings.audience,
          settings.oneAnswerPerPerson,
          settings.acceptingAnswers,
          settings.canvasDocumentId,
        ]
      : null,
  );
}

export async function assertContentFormUnchanged(
  db: ContentDb,
  form: ContentFormIdentity,
  read: {
    settings: ContentFormRow | undefined;
    canvas: ContentFormCanvas | null;
  },
): Promise<void> {
  const settings = await readContentFormRow(db, form);
  const canvas = read.canvas
    ? firstRow(
        await db
          .select({
            content: schema.documents.content,
            trashedAt: schema.documents.trashedAt,
          })
          .from(schema.documents)
          .where(eq(schema.documents.id, read.canvas.documentId))
          .limit(1),
      )
    : undefined;
  if (
    contentFormSettingsSnapshot(settings) !==
      contentFormSettingsSnapshot(read.settings) ||
    (read.canvas &&
      (!canvas ||
        canvas.trashedAt !== null ||
        canvas.content !== read.canvas.content))
  ) {
    fail(
      "This form changed while it was being answered. Read it again, then send the answers.",
      { errorCode: "form_changed", statusCode: 409 },
    );
  }
}

async function readContentFormCanvas(
  database: ContentDatabaseRow,
  canvasDocumentId: string,
): Promise<ContentFormCanvas> {
  const canvas = firstRow(
    await getDb()
      .select({
        id: schema.documents.id,
        title: schema.documents.title,
        content: schema.documents.content,
        parentId: schema.documents.parentId,
        ownerEmail: schema.documents.ownerEmail,
        trashedAt: schema.documents.trashedAt,
      })
      .from(schema.documents)
      .where(eq(schema.documents.id, canvasDocumentId))
      .limit(1),
  );
  if (
    !canvas ||
    canvas.trashedAt !== null ||
    canvas.parentId !== database.documentId ||
    canvas.ownerEmail !== database.ownerEmail
  ) {
    formUnavailable(
      "This form's page is missing, so the form can't be answered right now.",
    );
  }
  return {
    documentId: canvas.id,
    title: canvas.title,
    content: canvas.content,
  };
}

function collectNodes(
  node: PMNode,
  keep: (node: PMNode) => boolean,
  found: PMNode[] = [],
): PMNode[] {
  if (keep(node)) found.push(node);
  for (const child of node.content ?? []) collectNodes(child, keep, found);
  return found;
}

export async function contentFormCanvasQuestions(
  content: string,
): Promise<FormQuestionData[]> {
  const blocks = collectNodes(
    nfmToDoc(content),
    (node) =>
      node.type === "registryBlock" &&
      node.attrs?.blockType === FORM_QUESTION_BLOCK_TYPE,
  );
  const questions: FormQuestionData[] = [];
  for (const block of blocks) {
    const raw: unknown = block.attrs?.__raw;
    const parsed =
      typeof raw === "string" && raw ? await parseRegistryBlockData(raw) : null;
    const data =
      parsed?.type === FORM_QUESTION_BLOCK_TYPE
        ? readFormQuestionData(parsed.data)
        : null;
    if (!data) {
      formUnavailable(
        "A question on this form's page can't be read, so the form can't be answered right now.",
      );
    }
    questions.push(data);
  }
  return questions;
}

function resolvedQuestion(
  definition: PropertyDefinitionRow | null,
  rule: {
    required: boolean;
    help?: string | undefined;
    placeholder?: string | undefined;
  },
): ResolvedContentFormQuestion {
  return {
    key: definition?.id ?? FORM_TITLE_QUESTION_KEY,
    wording: definition?.name ?? CONTENT_FORM_TITLE_WORDING,
    required: rule.required,
    help: rule.help?.trim() || null,
    placeholder: rule.placeholder?.trim() || null,
    definition,
    answerType: definition
      ? (ANSWER_TYPES[definition.type as DocumentPropertyType] ?? null)
      : "text",
  };
}

export function isAnswerableContentFormQuestion(
  question: ResolvedContentFormQuestion,
): question is AnswerableContentFormQuestion {
  return question.answerType !== null;
}

export async function loadContentFormQuestions(input: {
  database: ContentDatabaseRow;
  view: ContentDatabaseView;
  definitions: PropertyDefinitionRow[];
  settings: ContentFormRow | undefined;
  channel: ContentFormChannel;
}): Promise<{
  questions: ResolvedContentFormQuestion[];
  canvas: ContentFormCanvas | null;
}> {
  const askable = new Map(
    input.definitions
      .filter(
        (definition) =>
          !definition.systemRole &&
          !isComputedPropertyType(definition.type as DocumentPropertyType),
      )
      .map((definition) => [definition.id, definition]),
  );
  const canvasDocumentId = input.settings?.canvasDocumentId;
  if (canvasDocumentId) {
    const canvas = await readContentFormCanvas(
      input.database,
      canvasDocumentId,
    );
    const seen = new Set<string>();
    const questions: ResolvedContentFormQuestion[] = [];
    for (const block of await contentFormCanvasQuestions(canvas.content)) {
      if (seen.has(block.propertyId)) continue;
      const definition =
        block.propertyId === FORM_TITLE_QUESTION_KEY
          ? null
          : askable.get(block.propertyId);
      if (definition === undefined) continue;
      seen.add(block.propertyId);
      questions.push(resolvedQuestion(definition, block));
    }
    return { questions, canvas };
  }

  const properties = input.definitions.map((definition) => ({
    definition: {
      id: definition.id,
      type: definition.type as DocumentPropertyType,
      systemRole: definition.systemRole as DocumentPropertySystemRole | null,
    },
  }));
  const listed = new Set(
    (input.view.formQuestions ?? []).map((question) => question.key),
  );
  const questions = contentDatabaseFormQuestions(input.view, properties)
    .filter(
      (question) =>
        question.enabled &&
        (input.channel === "collection" ||
          (listed.size === 0
            ? question.key === FORM_TITLE_QUESTION_KEY
            : listed.has(question.key))),
    )
    .flatMap((question) => {
      const definition =
        question.key === FORM_TITLE_QUESTION_KEY
          ? null
          : askable.get(question.key);
      return definition === undefined
        ? []
        : [resolvedQuestion(definition, { required: question.required })];
    });
  return { questions, canvas: null };
}

export function linkContentFormQuestions(
  questions: ResolvedContentFormQuestion[],
): AnswerableContentFormQuestion[] {
  const unanswerable = questions.find(
    (question) => question.required && question.answerType === null,
  );
  if (unanswerable) {
    formUnavailable(
      `This form asks for "${unanswerable.wording}", which can't be answered through a link yet.`,
    );
  }
  return questions.filter(isAnswerableContentFormQuestion);
}

function questionChoices(definition: PropertyDefinitionRow) {
  return (parsePropertyOptions(definition.optionsJson).options ?? []).map(
    (option) => ({ id: option.id, label: option.name }),
  );
}

export function publicContentFormQuestion(
  question: AnswerableContentFormQuestion,
): ContentFormQuestion {
  const choices =
    question.definition &&
    (question.answerType === "one_choice" ||
      question.answerType === "several_choices")
      ? questionChoices(question.definition)
      : null;
  return {
    key: question.key,
    wording: question.wording,
    help: question.help,
    placeholder: question.placeholder,
    required: question.required,
    answerType: question.answerType,
    ...(choices ? { choices } : {}),
  };
}

function choiceAnswers(definition: PropertyDefinitionRow): string[] {
  const choices = questionChoices(definition);
  const ids = new Set(choices.map((choice) => choice.id));
  const labelCounts = new Map<string, number>();
  for (const choice of choices) {
    const label = choice.label.trim().toLocaleLowerCase();
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }
  return [
    ...new Set(
      choices.map((choice) =>
        (labelCounts.get(choice.label.trim().toLocaleLowerCase()) ?? 0) > 1 ||
        ids.has(choice.label.trim())
          ? choice.id
          : choice.label,
      ),
    ),
  ];
}

function answerValueSchema(
  question: AnswerableContentFormQuestion,
): Record<string, unknown> {
  const base = {
    title: question.wording,
    ...(question.help ? { description: question.help } : {}),
  };
  const text = {
    ...base,
    type: "string",
    ...(question.required ? { minLength: 1 } : {}),
  };
  const list = {
    ...base,
    type: "array",
    ...(question.required ? { minItems: 1 } : {}),
  };
  const choices = question.definition ? choiceAnswers(question.definition) : [];
  switch (question.answerType) {
    case "number":
      return { ...base, type: "number" };
    case "checkbox":
      return { ...base, type: "boolean" };
    case "date":
      return {
        ...text,
        pattern: "^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2})?$",
      };
    case "one_choice":
      return { ...text, enum: choices };
    case "several_choices":
      return {
        ...list,
        items: { type: "string", enum: choices },
        uniqueItems: true,
      };
    case "people":
      return { ...list, items: { type: "string" } };
    case "text":
    case "long_text":
    case "email":
    case "url":
    case "phone":
    case "place":
      return text;
  }
}

export function contentFormAnswerSchema(
  questions: AnswerableContentFormQuestion[],
): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(
      questions.map((question) => [question.key, answerValueSchema(question)]),
    ),
    required: questions
      .filter((question) => question.required)
      .map((question) => question.key),
  };
}

function receiptValue(
  definition: PropertyDefinitionRow,
  value: DocumentPropertyValue,
): unknown {
  const type = definition.type as DocumentPropertyType;
  if (type !== "select" && type !== "status" && type !== "multi_select") {
    return value;
  }
  const labels = new Map(
    questionChoices(definition).map((choice) => [choice.id, choice.label]),
  );
  return Array.isArray(value)
    ? value.map((id) => labels.get(id) ?? id)
    : typeof value === "string"
      ? (labels.get(value) ?? value)
      : value;
}

export function contentFormReceiptAnswers(
  questions: ResolvedContentFormQuestion[],
  record: PreparedCollectionFormRecord,
): Array<{ question: string; wording: string; value: unknown }> {
  return questions.flatMap((question) => {
    if (!question.definition) {
      return record.title
        ? [
            {
              question: question.key,
              wording: question.wording,
              value: record.title,
            },
          ]
        : [];
    }
    const value = record.values.get(question.key) ?? null;
    return isEmptyPropertyValue(value)
      ? []
      : [
          {
            question: question.key,
            wording: question.wording,
            value: receiptValue(question.definition, value),
          },
        ];
  });
}
