import { z } from "zod";

import { identifierSchema, operationIdSchema } from "./contract.js";
import { FORBIDDEN_SEGMENTS, validateResponsePath } from "./expressions.js";
import { itemKindSchema } from "./items.js";

const OPERATION_NODE_KINDS = ["source", "lookup", "action", "agent"] as const;
export type OperationNodeKind = (typeof OPERATION_NODE_KINDS)[number];

const responsePathSchema = z
  .string()
  .refine((path) => validateResponsePath(path).ok, "not a valid response path");

const MAX_MAPPED_SOURCE_CHARS = 300;
const TEMPLATE_HOLE = /\{([^{}]*)\}/g;

type MappedSource =
  | { kind: "path"; path: string }
  | { kind: "template"; parts: ({ text: string } | { path: string })[] };

/**
 * One way to fill a mapped item field: a response path, or text with `{path}`
 * holes (`"Lead {id}"`). A path never holds a brace, so a brace is what makes
 * it a template. A template reads once at least one of its holes has a value;
 * a hole with none renders as nothing.
 */
export function parseMappedSource(
  source: string,
): { ok: true; source: MappedSource } | { ok: false; message: string } {
  if (source.length > MAX_MAPPED_SOURCE_CHARS) {
    return { ok: false, message: "too long" };
  }
  if (!source.includes("{") && !source.includes("}")) {
    return validateResponsePath(source).ok
      ? { ok: true, source: { kind: "path", path: source } }
      : { ok: false, message: "not a valid response path" };
  }
  const parts: ({ text: string } | { path: string })[] = [];
  let holes = 0;
  let cursor = 0;
  for (const hole of source.matchAll(TEMPLATE_HOLE)) {
    const text = source.slice(cursor, hole.index);
    if (text) parts.push({ text });
    if (!validateResponsePath(hole[1]).ok) {
      return {
        ok: false,
        message: `"${hole[1]}" is not a valid response path`,
      };
    }
    parts.push({ path: hole[1] });
    holes += 1;
    cursor = hole.index + hole[0].length;
  }
  const rest = source.slice(cursor);
  if (rest) parts.push({ text: rest });
  const literal = parts.map((part) => ("text" in part ? part.text : ""));
  if (holes === 0 || /[{}]/.test(literal.join(""))) {
    return {
      ok: false,
      message: "a template holds {path} holes and no other braces",
    };
  }
  return { ok: true, source: { kind: "template", parts } };
}

const mappedSourceSchema = z.string().superRefine((source, ctx) => {
  const parsed = parseMappedSource(source);
  if (!parsed.ok) ctx.addIssue({ code: "custom", message: parsed.message });
});

// A list is a fallback chain: the first entry that reads as non-empty wins.
const mappedValueSchema = z.union([
  mappedSourceSchema,
  z.array(mappedSourceSchema).min(2).max(6),
]);

const operationFieldSchema = z
  .strictObject({
    name: identifierSchema,
    type: z.enum(["string", "number", "boolean", "enum", "json", "text"]),
    required: z.boolean().optional(),
    enum: z.array(z.string().min(1).max(80)).min(1).max(100).optional(),
    default: z.unknown().optional(),
    label: z.string().min(1).max(120).optional(),
    // For the agent that writes graphs, not for the canvas: how to fill the field.
    description: z.string().min(1).max(300).optional(),
    // Decides who or where the effect lands: a recipient, channel, project, branch, repository, owner. A graph may not bind it from a model-written value unless `modelMayWrite` says that was reviewed.
    target: z.boolean().optional(),
    modelMayWrite: z.boolean().optional(),
  })
  .superRefine((field, ctx) => {
    if (field.modelMayWrite && !field.target) {
      ctx.addIssue({
        code: "custom",
        message: "only a target field can say a model may write it",
        path: ["modelMayWrite"],
      });
    }
    if (field.type === "enum" && !field.enum) {
      ctx.addIssue({
        code: "custom",
        message: "an enum field lists its values",
        path: ["enum"],
      });
    }
    if (field.type !== "enum" && field.enum) {
      ctx.addIssue({
        code: "custom",
        message: "only an enum field lists values",
        path: ["enum"],
      });
    }
  });
export type OperationField = z.infer<typeof operationFieldSchema>;

const operationOutputSchema = z.strictObject({
  name: identifierSchema,
  type: z.enum(["string", "number", "boolean", "list", "object"]),
  // The field is always there, and holds null when the thing it names does not exist yet.
  nullable: z.boolean().optional(),
  description: z.string().min(1).max(500).optional(),
});
export type OperationOutput = z.infer<typeof operationOutputSchema>;

// An operation with no fixed endpoint: the declared fields below carry the
// path a person typed and the optional query, headers, sign-in, timeout,
// paging and paths to keep, and the request builder checks each one. Only a GET
// read may declare it, and a model is never given one as a tool.
const freeFormSchema = z.strictObject({
  path: identifierSchema,
  query: identifierSchema.optional(),
  headers: identifierSchema.optional(),
  auth: identifierSchema.optional(),
  timeoutSeconds: identifierSchema.optional(),
  pagination: identifierSchema.optional(),
  includeStatus: identifierSchema.optional(),
  fieldsToKeep: identifierSchema.optional(),
  // Names core fills from the provider's connection, such as `{projectId}`; a typed path may keep one as a whole segment.
  placeholders: z.array(identifierSchema).max(5).optional(),
});
export type FreeFormRequest = z.infer<typeof freeFormSchema>;

const implementationSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("action"),
    action: z.string().min(1).max(120),
    argMap: z.record(z.string().min(1), z.string().min(1)).optional(),
  }),
  z.strictObject({
    type: z.literal("provider-request"),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    pathTemplate: z.string().min(1).max(500),
    query: z.record(z.string().min(1), z.string()).optional(),
    bodyTemplate: z.unknown().optional(),
    freeForm: freeFormSchema.optional(),
  }),
  z.strictObject({
    type: z.literal("builder"),
    op: z.enum(["start", "check", "followUp"]),
  }),
]);

// The fields a provider response can fill on a NormalizedItem. `externalId`
// comes from `dedupeKey`; the host mints `id` from it, the operation and the
// factory.
const MAPPED_ITEM_FIELD =
  /^(?:title|text|url|author|occurredAt|thread\.(?:channelId|threadTs|repo|number|ticketId)|extras\.[A-Za-z_][A-Za-z0-9_]*)$/;

const itemMappingSchema = z
  .strictObject({
    kind: itemKindSchema,
    // Where the list of results sits in the response; omitted when the response is the list.
    itemsPath: responsePathSchema.optional(),
    fields: z.record(
      z.string().regex(MAPPED_ITEM_FIELD, "not a mappable item field"),
      mappedValueSchema,
    ),
    dedupeKey: responsePathSchema,
    // Mapped `extras.*` fields that arrive as numeric text (BigQuery sends every cell as a string) and are read as numbers.
    numberFields: z
      .array(z.string().regex(/^extras\.[A-Za-z_][A-Za-z0-9_]*$/))
      .max(10)
      .optional(),
  })
  .superRefine((mapping, ctx) => {
    for (const field of mapping.numberFields ?? []) {
      if (!(field in mapping.fields)) {
        ctx.addIssue({
          code: "custom",
          message: `"${field}" is not a mapped field`,
          path: ["numberFields"],
        });
      }
    }
    for (const required of ["title", "occurredAt"]) {
      if (!(required in mapping.fields)) {
        ctx.addIssue({
          code: "custom",
          message: `an item mapping must fill "${required}"`,
          path: ["fields"],
        });
      }
    }
    for (const field of Object.keys(mapping.fields)) {
      const extra = field.startsWith("extras.") ? field.slice(7) : undefined;
      if (
        extra !== undefined &&
        (FORBIDDEN_SEGMENTS as readonly string[]).includes(extra)
      ) {
        ctx.addIssue({
          code: "custom",
          message: `"${extra}" is a reserved name`,
          path: ["fields", field],
        });
      }
    }
  });

export const operationDefinitionSchema = z
  .strictObject({
    id: operationIdSchema,
    provider: z.string().min(1).max(60),
    label: z.string().min(1).max(120),
    // For the agent that writes graphs, not for the canvas: what the operation is for and where its limits are.
    description: z.string().min(1).max(1000).optional(),
    nodeKinds: z.array(z.enum(OPERATION_NODE_KINDS)).min(1).max(4),
    effect: z.enum(["read", "write"]),
    // A read that goes out as a POST (a search or query), so a write cannot hide behind `read`.
    readsViaPost: z.boolean().optional(),
    fields: z.array(operationFieldSchema).max(60),
    implementation: implementationSchema,
    itemMapping: itemMappingSchema.optional(),
    cursor: z
      .strictObject({
        param: z.string().min(1).max(80),
        // Where the position after a whole newest-first page sits in the response; priming reads it.
        path: responsePathSchema,
        // The position before any row existed. A priming pass over an empty page stores it, so the source is primed and the first row that arrives is processed.
        origin: z.string().min(1).max(80).optional(),
        // For a provider that can sort oldest first: once a position is stored the request asks oldest first (`sortParam` holds `oldestFirst`, otherwise `newestFirst`) and the position after a page is `itemPath` of the last row kept, so a page cut at the limit continues next tick.
        forward: z
          .strictObject({
            itemPath: responsePathSchema,
            sortParam: z.string().min(1).max(80),
            newestFirst: z.string().min(1).max(40),
            oldestFirst: z.string().min(1).max(40),
          })
          .optional(),
      })
      .optional(),
    window: z
      .strictObject({
        fromParam: z.string().min(1).max(80),
        toParam: z.string().min(1).max(80),
      })
      .optional(),
    // For a provider that answers a range holding nothing with a 404 instead of an empty list: the 404 reads as zero items only when every error text it carries contains this text. Any other 404 stays a failure.
    emptyRange: z
      .strictObject({ errorIncludes: z.string().trim().min(3).max(120) })
      .optional(),
    // For a lookup: the most characters of the provider's answer it hands on, cut and reported the way any over-long answer is. One step carries 64 KB in all, summed over every item it emits and every earlier answer still attached, so a lookup that runs once per item is sized to what a full step of items can hold.
    answerBudgetChars: z.number().int().min(1_000).max(30_000).optional(),
    // What `nodes.<step>` carries once this operation ran. A graph that reads a name not listed here is refused on save; an operation that lists none is not checked.
    outputs: z.array(operationOutputSchema).min(1).max(60).optional(),
    receipt: z
      .strictObject({
        externalRef: responsePathSchema,
        url: responsePathSchema.optional(),
      })
      .optional(),
    credential: z.strictObject({ provider: z.string().min(1).max(60) }),
  })
  .superRefine((def, ctx) => {
    const fail = (message: string, path: string) =>
      ctx.addIssue({ code: "custom", message, path: [path] });
    const kinds = new Set(def.nodeKinds);
    const isSource = kinds.has("source");

    if (def.id.split(".")[0] !== def.provider) {
      fail(`the id must start with "${def.provider}."`, "id");
    }
    if (kinds.size !== def.nodeKinds.length) {
      fail("node kinds must be unique", "nodeKinds");
    }
    if (
      new Set(def.fields.map((field) => field.name)).size !== def.fields.length
    ) {
      fail("field names must be unique", "fields");
    }
    const sortParam = def.cursor?.forward?.sortParam;
    if (
      sortParam !== undefined &&
      (def.fields.some((field) => field.name === sortParam) ||
        sortParam === def.cursor?.param ||
        sortParam === def.window?.fromParam ||
        sortParam === def.window?.toParam)
    ) {
      fail("the sort parameter must be its own name", "cursor");
    }
    if (
      new Set((def.outputs ?? []).map((output) => output.name)).size !==
      (def.outputs ?? []).length
    ) {
      fail("output names must be unique", "outputs");
    }
    if (isSource && !def.itemMapping) {
      fail("a source operation declares its item mapping", "itemMapping");
    }
    if (def.emptyRange) {
      const itemsPath = def.itemMapping?.itemsPath;
      const path = itemsPath ? validateResponsePath(itemsPath) : undefined;
      const indexed =
        path?.ok === true &&
        path.path.segments.some((segment) => typeof segment === "number");
      if (!def.window || indexed) {
        fail(
          "only a window source whose list sits under named fields declares an empty range",
          "emptyRange",
        );
      }
    }
    if (!isSource) {
      for (const name of ["itemMapping", "cursor", "window"] as const) {
        if (def[name]) fail("only a source operation declares this", name);
      }
    }
    if (
      def.effect === "write" &&
      (kinds.has("source") || kinds.has("lookup"))
    ) {
      fail("a write operation cannot be a source or lookup", "effect");
    }
    if (
      def.answerBudgetChars !== undefined &&
      !(def.effect === "read" && kinds.size === 1 && kinds.has("lookup"))
    ) {
      fail("only a lookup read declares an answer budget", "answerBudgetChars");
    }
    if (def.effect === "read" && kinds.has("action")) {
      fail("a read operation cannot be an action", "effect");
    }
    const method =
      def.implementation.type === "provider-request"
        ? def.implementation.method
        : undefined;
    if (def.effect === "read" && method !== undefined && method !== "GET") {
      if (method !== "POST") {
        fail(`a read operation cannot send a ${method}`, "effect");
      } else if (!def.readsViaPost) {
        fail(
          'a read that sends a POST declares "readsViaPost"',
          "readsViaPost",
        );
      }
    }
    if (def.readsViaPost && !(def.effect === "read" && method === "POST")) {
      fail('"readsViaPost" marks a read that sends a POST', "readsViaPost");
    }
    if (
      def.implementation.type === "provider-request" &&
      def.implementation.freeForm
    ) {
      const { freeForm, pathTemplate, query, bodyTemplate } =
        def.implementation;
      if (def.effect !== "read" || method !== "GET") {
        fail("a free-form request is a GET read", "implementation");
      }
      if (query !== undefined || bodyTemplate !== undefined) {
        fail(
          "a free-form request has no fixed query or body",
          "implementation",
        );
      }
      if (def.nodeKinds.some((kind) => kind !== "lookup")) {
        fail("a free-form request serves only lookup nodes", "nodeKinds");
      }
      if (pathTemplate !== `/{${freeForm.path}}`) {
        fail(
          `a free-form request's path is exactly "/{${freeForm.path}}"`,
          "implementation",
        );
      }
      const roles = {
        path: "string",
        query: "json",
        headers: "json",
        auth: "enum",
        timeoutSeconds: "number",
        pagination: "json",
        includeStatus: "boolean",
        fieldsToKeep: "json",
      } as const;
      const named: string[] = [];
      for (const [role, type] of Object.entries(roles)) {
        const name = freeForm[role as keyof typeof roles];
        if (name === undefined) continue;
        named.push(name);
        const field = def.fields.find((candidate) => candidate.name === name);
        if (field?.type !== type) {
          fail(`"${name}" is declared as a ${type} field`, "implementation");
        }
      }
      if (new Set(named).size !== named.length) {
        fail("each free-form role has a field of its own", "implementation");
      }
      const pathField = def.fields.find(
        (field) => field.name === freeForm.path,
      );
      if (pathField && !pathField.required) {
        fail("the path field is required", "implementation");
      }
      const auth = def.fields.find((field) => field.name === freeForm.auth);
      if (
        auth &&
        (auth.enum?.length !== 2 ||
          !auth.enum.includes("provider") ||
          !auth.enum.includes("none"))
      ) {
        fail('the sign-in field is "provider" or "none"', "implementation");
      }
    }
    if (kinds.has("agent")) {
      if (def.nodeKinds.length !== 1) {
        fail("an agent operation serves only agent nodes", "nodeKinds");
      }
      if (def.implementation.type !== "builder") {
        fail(
          "an agent operation uses the builder implementation",
          "implementation",
        );
      } else if (
        def.effect !== (def.implementation.op === "check" ? "read" : "write")
      ) {
        fail('"check" reads; "start" and "followUp" write', "effect");
      }
    } else if (def.implementation.type === "builder") {
      fail(
        "the builder implementation serves only agent nodes",
        "implementation",
      );
    }
  });
export type OperationDefinition = z.infer<typeof operationDefinitionSchema>;
export type OperationDefinitionInput = z.input<
  typeof operationDefinitionSchema
>;

/**
 * A write may run only on a node that exists to cause effects. Reads are
 * allowed wherever the operation declares it can run.
 */
export function isWriteAllowedForNode(
  def: OperationDefinition,
  nodeKind: OperationNodeKind,
): boolean {
  if (!def.nodeKinds.includes(nodeKind)) return false;
  if (def.effect === "write")
    return nodeKind === "action" || nodeKind === "agent";
  return true;
}

/**
 * A model may be given a read as a tool only when a person fixed what it
 * reads. An operation that takes a typed endpoint path is never one: letting a
 * model choose the path would let it read anything the connection can reach.
 */
export function isModelToolAllowed(def: OperationDefinition): boolean {
  if (def.effect !== "read") return false;
  return !(
    def.implementation.type === "provider-request" &&
    def.implementation.freeForm !== undefined
  );
}

/**
 * The outputs `nodes.<step>` carries after `def` ran: the ones it declares,
 * plus the receipt's `externalRef` and `url`, which the engine adds to a
 * write's result. Undefined for an operation that declares none, so nothing
 * about it is checked.
 */
export function operationOutputs(
  def: OperationDefinition,
): OperationOutput[] | undefined {
  if (!def.outputs) return undefined;
  const receipt: OperationOutput[] = [];
  if (def.receipt) {
    receipt.push({
      name: "externalRef",
      type: "string",
      description: "The receipt's reference to what the write created.",
    });
    if (def.receipt.url) {
      receipt.push({
        name: "url",
        type: "string",
        description: "A link to what the write created.",
      });
    }
  }
  const declared = new Set(def.outputs.map((output) => output.name));
  return [
    ...def.outputs,
    ...receipt.filter((output) => !declared.has(output.name)),
  ];
}

export interface OperationCatalog {
  get(id: string): OperationDefinition | undefined;
}

export class OperationRegistryError extends Error {
  readonly code = "duplicate_operation";
  readonly operationId: string;

  constructor(operationId: string) {
    super(`Operation "${operationId}" is already registered.`);
    this.name = "OperationRegistryError";
    this.operationId = operationId;
  }
}

export interface OperationRegistry extends OperationCatalog {
  /** Parses the definition (throws a ZodError when invalid) and rejects a duplicate id. */
  register(definition: OperationDefinitionInput): OperationDefinition;
  list(): OperationDefinition[];
}

export function createOperationRegistry(): OperationRegistry {
  const operations = new Map<string, OperationDefinition>();
  return {
    register(definition) {
      const parsed = operationDefinitionSchema.parse(definition);
      if (operations.has(parsed.id)) {
        throw new OperationRegistryError(parsed.id);
      }
      operations.set(parsed.id, parsed);
      return parsed;
    },
    get: (id) => operations.get(id),
    list: () => [...operations.values()],
  };
}
