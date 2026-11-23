import { z } from "zod";

import {
  cellOutputSchema,
  type CellContents,
} from "../app/lib/model/contracts.js";
import { appDocumentSchema } from "./app-layout.js";
import {
  appSessionIdSchema,
  releaseIdSchema,
  resultIdSchema,
  runIdSchema,
} from "./notebook-execution.js";
import {
  notebookCellIdSchema,
  revisionSchema,
} from "./notebook-snapshot-contract.js";
import { projectDocumentWithLayoutSchema } from "./project-document.js";

const scalar = z.union([
  z.string().max(4000),
  z.number().finite(),
  z.boolean(),
]);
const date = z.iso.date();
export const inputValueSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("null") }),
  z.strictObject({ kind: z.literal("string"), value: z.string().max(4000) }),
  z.strictObject({ kind: z.literal("number"), value: z.number().finite() }),
  z.strictObject({ kind: z.literal("boolean"), value: z.boolean() }),
  z.strictObject({ kind: z.literal("date"), value: date }),
  z
    .strictObject({ kind: z.literal("date-range"), from: date, to: date })
    .refine(({ from, to }) => from <= to),
  z
    .strictObject({
      kind: z.literal("list"),
      itemType: z.enum(["string", "number", "boolean", "date"]),
      items: z.array(scalar).max(200),
    })
    .refine(({ itemType, items }) =>
      items.every((item) =>
        itemType === "date"
          ? date.safeParse(item).success
          : typeof item === itemType,
      ),
    ),
]);
export type InputValue = z.infer<typeof inputValueSchema>;
export type AppInputValues = Record<string, InputValue>;
type Input = Extract<CellContents, { kind: "input" }>;

export function inputValueFromControl(input: Input, value: string): InputValue {
  switch (input.inputType) {
    case "CHECKBOX":
      return {
        kind: "boolean",
        value: z.enum(["true", "false"]).parse(value) === "true",
      };
    case "DROPDOWN":
      return input.optional && value === ""
        ? { kind: "null" }
        : input.optionValueType === "number" && value !== ""
          ? inputValueSchema.parse({ kind: "number", value: Number(value) })
          : inputValueSchema.parse({ kind: "string", value });
    case "NUMERIC_INPUT":
    case "SLIDER":
      return value === ""
        ? { kind: "null" }
        : inputValueSchema.parse({ kind: "number", value: Number(value) });
    case "DATE":
      return value === ""
        ? { kind: "null" }
        : inputValueSchema.parse({ kind: "date", value });
    case "MULTISELECT": {
      const items = z.array(z.string()).parse(JSON.parse(value || "[]"));
      return inputValueSchema.parse({
        kind: "list",
        itemType: input.optionValueType ?? "string",
        items: input.optionValueType === "number" ? items.map(Number) : items,
      });
    }
    case "TEXT_INPUT":
    case "BUTTON":
    case "FILE_UPLOAD":
    case "TABLE":
      return inputValueSchema.parse({ kind: "string", value });
  }
}

export function serializeInputValue(value: InputValue): string {
  switch (value.kind) {
    case "null":
      return "";
    case "list":
      return JSON.stringify(value.items);
    case "date-range":
      return JSON.stringify([value.from, value.to]);
    case "boolean":
    case "date":
    case "number":
    case "string":
      return String(value.value);
  }
}

const valueMap = z.record(z.string(), inputValueSchema);
export const appSessionRefSchema = z.strictObject({
  sessionId: appSessionIdSchema,
  releaseId: releaseIdSchema,
});
export const openAppSessionInput = z.strictObject({
  projectId: z.string().min(1),
  version: z.string().min(1),
  sessionId: appSessionIdSchema.optional(),
  openId: z.uuid(),
  savedViewId: z.uuid().optional(),
});
export const getAppSessionInput = appSessionRefSchema.extend({
  after: revisionSchema.optional(),
});
const operation = appSessionRefSchema.extend({
  requestId: z.uuid(),
  expectedInputRevision: revisionSchema,
});
export const setAppInputsInput = operation.extend({
  updates: z
    .array(
      z.strictObject({
        inputCellId: notebookCellIdSchema,
        value: inputValueSchema,
        optionsResultId: resultIdSchema.optional(),
      }),
    )
    .min(1)
    .max(50)
    .refine(
      (updates) =>
        new Set(updates.map(({ inputCellId }) => inputCellId)).size ===
        updates.length,
    ),
});
export const resetAppSessionInput = operation;
export const appSessionOperationOutput = appSessionRefSchema.extend({
  inputRevision: revisionSchema,
  effectiveValues: valueMap,
  changedInputIds: z.array(notebookCellIdSchema),
  affectedCellIds: z.array(notebookCellIdSchema),
  state: z.enum(["unchanged", "stale", "queued", "reset"]),
  runId: runIdSchema.optional(),
  cursor: revisionSchema,
});
export type AppSessionOperation = z.infer<typeof appSessionOperationOutput>;

export const refreshAppResultsInput = appSessionRefSchema.extend({
  requestId: z.uuid(),
  scope: z.enum(["session", "default"]),
  cachePolicy: z.enum(["reuse", "bypass"]),
});
export const refreshAppResultsOutput = z.strictObject({
  runId: runIdSchema,
  cacheGeneration: revisionSchema.optional(),
  cursor: revisionSchema,
});
export type AppSessionRefresh = z.infer<typeof refreshAppResultsOutput>;

export const saveAppViewInput = operation.extend({
  name: z.string().trim().min(1).max(200),
});
export const saveAppViewOutput = z.strictObject({
  savedViewId: z.uuid(),
  releaseId: releaseIdSchema,
  name: z.string(),
  href: z.string(),
});
export type SavedAppView = z.infer<typeof saveAppViewOutput>;

export const appOutputSchema = z.strictObject({
  output: cellOutputSchema.nullable(),
  resultId: resultIdSchema.optional(),
  resultStatus: z
    .enum([
      "ready",
      "truncated",
      "sampled",
      "coverage_unverified",
      "failed",
      "missing",
      "denied",
      "unreadable",
    ])
    .optional(),
});
export const appSessionProjectionSchema = appSessionRefSchema.extend({
  inputRevision: revisionSchema,
  tabId: z.string().nullable(),
  appDocument: appDocumentSchema.nullable(),
  projection: z.strictObject({
    project: projectDocumentWithLayoutSchema,
    outputs: z.record(z.string(), appOutputSchema),
    metricSourceResultIds: z.record(z.string(), resultIdSchema).optional(),
    runningCellIds: z.array(notebookCellIdSchema),
    tabSlugs: z.array(z.tuple([z.string(), z.string()])),
    canViewSource: z.boolean(),
  }),
  inputChoices: z.record(
    z.string(),
    z.discriminatedUnion("status", [
      z.strictObject({
        status: z.literal("ready"),
        resultId: resultIdSchema,
        values: z.array(
          z.strictObject({ value: z.string(), label: z.string() }),
        ),
      }),
      z.strictObject({
        status: z.enum(["missing", "pending", "empty", "denied", "unreadable"]),
      }),
    ]),
  ),
  effectiveValues: valueMap,
  overrides: valueMap,
  baselineManifestId: z.string().nullable(),
  defaultCacheGeneration: revisionSchema,
  ageStatus: z.enum(["fresh", "stale", "unavailable"]),
  refreshUnavailable: z.literal("hosted-kernel-required").optional(),
  refreshedAt: z.iso.datetime({ offset: true }).nullable(),
  sessionHref: z.string(),
  caps: z.strictObject({ refreshDefault: z.boolean(), saveView: z.boolean() }),
  cursor: revisionSchema,
  state: z.enum(["ready", "running", "error"]),
  runId: runIdSchema.nullable(),
  staleAfter: appDocumentSchema.shape.settings.shape.staleAfter,
});
export type AppSessionProjection = z.infer<typeof appSessionProjectionSchema>;
