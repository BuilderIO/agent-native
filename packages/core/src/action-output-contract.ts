import type { StandardSchemaV1 } from "@standard-schema/spec";

import { AGENT_IMAGES_FIELD } from "./agent/tool-result-images.js";
import {
  EMBED_RESULT_SENSITIVE_KEYS,
  HIDDEN_EMBED_URL,
  isEmbedCredentialKey,
  isEmbedStartUrl,
} from "./mcp/embed-redaction.js";
import { isObjectOnly } from "./mcp/tool-input-schema.js";

export type JsonSchemaObject = Record<string, unknown>;

/**
 * The two output contracts of an action that opts in with `mcpOutputSchema`.
 *
 * `semantic` describes the sanitized value `run` returns after `outputSchema`
 * validated it — what in-process callers and typed script bindings see.
 * `response` is what MCP advertises as the tool's `outputSchema`: the semantic
 * contract after the transport transform that builds `structuredContent`
 * (an array result is wrapped as `{ items }`, embed credentials are removed,
 * embed start URLs become the hidden-URL marker, `_agentImages` is lifted
 * into image content, and actions that produce an open link gain optional
 * `openLink` and `url` fields). Every value the semantic contract accepts must still satisfy the
 * response contract after that transform.
 */
export interface ActionMcpOutputContract {
  readonly semantic: JsonSchemaObject;
  readonly response: JsonSchemaObject;
}

const MCP_OPEN_LINK_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: {
    label: { type: "string" },
    view: { type: "string" },
    webUrl: { type: "string" },
    desktopUrl: { type: "string" },
    vscodeUrl: { type: "string" },
  },
};

/**
 * Keywords the response contract may carry. Anything else — `not`,
 * conditionals, `contains`, `minProperties`, `$async`, `$id`, unevaluated*,
 * custom metadata — is refused when the action is defined: either redaction
 * could break it for a valid result, or the validator would treat it in a way
 * the derivation cannot reason about.
 */
const SUPPORTED_KEYWORDS: ReadonlySet<string> = new Set([
  "$ref",
  "$defs",
  "definitions",
  "$comment",
  "title",
  "description",
  "default",
  "examples",
  "deprecated",
  "readOnly",
  "writeOnly",
  "contentEncoding",
  "contentMediaType",
  "type",
  "enum",
  "const",
  "anyOf",
  "oneOf",
  "allOf",
  "properties",
  "required",
  "additionalProperties",
  "patternProperties",
  "propertyNames",
  "maxProperties",
  "items",
  "prefixItems",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
]);

/** Formats the MCP check validates (ajv-formats' full set). */
export const SUPPORTED_OUTPUT_FORMATS: ReadonlySet<string> = new Set([
  "date",
  "time",
  "date-time",
  "iso-time",
  "iso-date-time",
  "duration",
  "uri",
  "uri-reference",
  "uri-template",
  "url",
  "email",
  "hostname",
  "ipv4",
  "ipv6",
  "regex",
  "uuid",
  "json-pointer",
  "json-pointer-uri-fragment",
  "relative-json-pointer",
  "byte",
  "int32",
  "int64",
  "float",
  "double",
  "password",
  "binary",
]);

/** Constraints the hidden-embed-URL marker may fail although it is a string. */
const STRING_CONSTRAINTS = ["format", "pattern", "minLength", "maxLength"];

/**
 * Convert an action's `outputSchema` to JSON Schema through the schema's own
 * Standard JSON Schema *output* converter. The input converter describes what
 * a schema accepts, which differs from what it produces wherever a default,
 * preprocess, or coercion runs.
 */
export function outputSchemaToJsonSchema(
  schema: StandardSchemaV1,
): JsonSchemaObject {
  const output = (
    schema as {
      "~standard"?: {
        jsonSchema?: {
          output?: (options: { target: string }) => unknown;
        };
      };
    }
  )["~standard"]?.jsonSchema?.output;
  if (typeof output !== "function") {
    throw new TypeError(
      "mcpOutputSchema needs an outputSchema with a Standard JSON Schema output converter (`~standard.jsonSchema.output`), such as a Zod 4 schema.",
    );
  }
  const converted = output({ target: "draft-2020-12" });
  if (!converted || typeof converted !== "object" || Array.isArray(converted)) {
    throw new TypeError(
      "outputSchema did not convert to a JSON Schema object.",
    );
  }
  const { $schema: _dialect, ...semantic } = structuredClone(
    converted as JsonSchemaObject,
  );
  return semantic;
}

function isRecord(value: unknown): value is JsonSchemaObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function lookupRef(root: JsonSchemaObject, ref: string): unknown {
  if (ref === "#") return root;
  const match = /^#\/(\$defs|definitions)\/([^/]+)$/.exec(ref);
  if (!match) return undefined;
  const defs = root[match[1]];
  const name = match[2].replace(/~1/g, "/").replace(/~0/g, "~");
  return isRecord(defs) && Object.hasOwn(defs, name) ? defs[name] : undefined;
}

function typeAdmits(node: JsonSchemaObject, type: string): boolean {
  const declared = node.type;
  if (declared === undefined) return true;
  if (typeof declared === "string") return declared === type;
  return Array.isArray(declared) && declared.includes(type);
}

function refuse(reason: string): never {
  throw new TypeError(
    `mcpOutputSchema cannot advertise this outputSchema: ${reason}`,
  );
}

/** Whether redaction can change `value` (a `const` or `enum` member). */
function redactionMayChange(value: unknown): boolean {
  if (typeof value === "string") return isEmbedStartUrl(value);
  if (Array.isArray(value)) return value.some(redactionMayChange);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, item]) =>
      EMBED_RESULT_SENSITIVE_KEYS.has(key) ||
      isEmbedCredentialKey(key) ||
      key === AGENT_IMAGES_FIELD ||
      redactionMayChange(item),
  );
}

const REDACTION_INVARIANT_TYPES = new Set([
  "number",
  "integer",
  "boolean",
  "null",
]);

/**
 * Whether every value valid under `node` passes through redaction unchanged:
 * only then can redaction not make two distinct array items equal.
 */
function redactionInvariant(
  node: unknown,
  root: JsonSchemaObject,
  seen = new Set<unknown>(),
): boolean {
  if (node === false) return true;
  if (!isRecord(node) || seen.has(node)) return false;
  seen.add(node);
  if ("const" in node) return !redactionMayChange(node.const);
  if (Array.isArray(node.enum)) return !node.enum.some(redactionMayChange);
  const type = node.type;
  if (
    (typeof type === "string" && REDACTION_INVARIANT_TYPES.has(type)) ||
    (Array.isArray(type) &&
      type.every((item) => REDACTION_INVARIANT_TYPES.has(item)))
  ) {
    return true;
  }
  if (typeof node.$ref === "string") {
    return redactionInvariant(lookupRef(root, node.$ref), root, seen);
  }
  if (Array.isArray(node.allOf)) {
    return node.allOf.some((branch) => redactionInvariant(branch, root, seen));
  }
  for (const key of ["anyOf", "oneOf"]) {
    const branches = node[key];
    if (Array.isArray(branches)) {
      return branches.every((branch) => redactionInvariant(branch, root, seen));
    }
  }
  return false;
}

const SUBSCHEMA_VALUE_KEYS = [
  "additionalProperties",
  "propertyNames",
  "items",
] as const;
const SUBSCHEMA_LIST_KEYS = ["anyOf", "oneOf", "allOf", "prefixItems"] as const;
const SUBSCHEMA_MAP_KEYS = [
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
] as const;

/**
 * Refuse, at every subschema position, what the derivation cannot carry
 * through redaction: an unsupported keyword or format, a reference it cannot
 * resolve, nested definitions, a `const` or `enum` value redaction would
 * change, and `uniqueItems` over items redaction could make equal.
 */
function assertAdvertisable(
  node: unknown,
  root: JsonSchemaObject,
  atRoot = false,
): void {
  if (typeof node === "boolean") return;
  if (!isRecord(node)) refuse("a subschema is not an object.");
  for (const key of Object.keys(node)) {
    if (!SUPPORTED_KEYWORDS.has(key)) refuse(`unsupported keyword "${key}".`);
  }
  if (
    node.format !== undefined &&
    (typeof node.format !== "string" ||
      !SUPPORTED_OUTPUT_FORMATS.has(node.format))
  ) {
    refuse(`unsupported format ${JSON.stringify(node.format)}.`);
  }
  if (
    node.$ref !== undefined &&
    (typeof node.$ref !== "string" ||
      node.$ref === "#" ||
      lookupRef(root, node.$ref) === undefined)
  ) {
    refuse(`a reference it cannot resolve (${JSON.stringify(node.$ref)}).`);
  }
  if (!atRoot && (node.$defs !== undefined || node.definitions !== undefined)) {
    refuse("definitions below the root.");
  }
  if (
    ("const" in node && redactionMayChange(node.const)) ||
    (Array.isArray(node.enum) && node.enum.some(redactionMayChange))
  ) {
    refuse(
      "a const or enum value holding an embed credential, an embed URL, or _agentImages, which redaction changes.",
    );
  }
  if (
    node.uniqueItems === true &&
    [node.items, ...(Array.isArray(node.prefixItems) ? node.prefixItems : [])]
      .filter((item) => item !== undefined)
      .some((item) => !redactionInvariant(item, root))
  ) {
    refuse(
      "uniqueItems over items that redaction can change, which can turn distinct items into duplicates.",
    );
  }
  for (const key of SUBSCHEMA_VALUE_KEYS) {
    if (node[key] !== undefined) assertAdvertisable(node[key], root);
  }
  for (const key of SUBSCHEMA_LIST_KEYS) {
    if (node[key] === undefined) continue;
    if (!Array.isArray(node[key])) refuse(`"${key}" is not a list.`);
    for (const branch of node[key] as unknown[]) {
      assertAdvertisable(branch, root);
    }
  }
  for (const key of SUBSCHEMA_MAP_KEYS) {
    if (node[key] === undefined) continue;
    if (!isRecord(node[key])) refuse(`"${key}" is not an object.`);
    for (const schema of Object.values(node[key] as JsonSchemaObject)) {
      assertAdvertisable(schema, root);
    }
  }
}

/**
 * Rewrite one schema node (already checked by `assertAdvertisable`) so it
 * accepts what the transport makes of any value it accepted: embed credential
 * keys may disappear, an embed start URL becomes the hidden-URL marker, and
 * `oneOf` loses its exclusivity once branches can lose properties.
 */
function tolerateRedaction(node: unknown, root: JsonSchemaObject): unknown {
  if (!isRecord(node)) return node;
  const out: JsonSchemaObject = { ...node };
  for (const key of ["anyOf", "allOf"] as const) {
    if (Array.isArray(out[key])) {
      out[key] = (out[key] as unknown[]).map((branch) =>
        tolerateRedaction(branch, root),
      );
    }
  }
  if (Array.isArray(out.oneOf)) {
    const branches = (out.oneOf as unknown[]).map((branch) =>
      tolerateRedaction(branch, root),
    );
    delete out.oneOf;
    if (Array.isArray(out.anyOf)) {
      out.allOf = [...((out.allOf as unknown[]) ?? []), { anyOf: branches }];
    } else {
      out.anyOf = branches;
    }
  }

  if (isRecord(out.properties)) {
    const properties: JsonSchemaObject = {};
    const removable = new Set<string>();
    for (const [name, schema] of Object.entries(out.properties)) {
      if (EMBED_RESULT_SENSITIVE_KEYS.has(name)) continue;
      if (isEmbedCredentialKey(name)) removable.add(name);
      properties[name] = tolerateRedaction(schema, root);
    }
    out.properties = properties;
    if (Array.isArray(out.required)) {
      out.required = (out.required as unknown[]).filter(
        (name) =>
          typeof name === "string" &&
          Object.hasOwn(properties, name) &&
          !removable.has(name),
      );
    }
  } else if (Array.isArray(out.required)) {
    // A required key matched only by additionalProperties may be a
    // credential key the transport deletes.
    out.required = [];
  }
  if (isRecord(out.additionalProperties)) {
    out.additionalProperties = tolerateRedaction(
      out.additionalProperties,
      root,
    );
  }
  if (isRecord(out.patternProperties)) {
    out.patternProperties = Object.fromEntries(
      Object.entries(out.patternProperties).map(([pattern, schema]) => [
        pattern,
        tolerateRedaction(schema, root),
      ]),
    );
  }

  if (out.items !== undefined && typeof out.items !== "boolean") {
    out.items = tolerateRedaction(out.items, root);
  }
  if (Array.isArray(out.prefixItems)) {
    out.prefixItems = (out.prefixItems as unknown[]).map((item) =>
      tolerateRedaction(item, root),
    );
  }
  // Where a value holding an embed URL becomes the marker, its schema must
  // accept the marker: an unconstrained string already does, and a const or
  // enum never holds an embed URL (`assertAdvertisable` refuses one).
  const markerMayFail =
    out.$ref === undefined &&
    !("const" in out) &&
    !Array.isArray(out.enum) &&
    typeAdmits(out, "string") &&
    STRING_CONSTRAINTS.some((key) => out[key] !== undefined);
  return markerMayFail ? { anyOf: [out, { const: HIDDEN_EMBED_URL }] } : out;
}

const OPEN_LINK_FIELDS = ["openLink", "url"];

function withTransportFields(
  node: JsonSchemaObject,
  openLink: boolean,
): JsonSchemaObject {
  if (openLink) {
    // These would judge the added openLink and url fields too.
    if (typeof node.$ref === "string") {
      refuse("a linked result's root refers to a definition.");
    }
    for (const key of ["maxProperties", "propertyNames", "const", "enum"]) {
      if (node[key] !== undefined) {
        refuse(`a linked result's root declares "${key}".`);
      }
    }
    if (
      isRecord(node.patternProperties) &&
      Object.keys(node.patternProperties).some((pattern) =>
        OPEN_LINK_FIELDS.some((field) => new RegExp(pattern, "u").test(field)),
      )
    ) {
      refuse(
        "a linked result's root has a patternProperties entry matching openLink or url.",
      );
    }
  }
  const out: JsonSchemaObject = { ...node };
  for (const key of ["anyOf", "allOf"] as const) {
    if (Array.isArray(out[key])) {
      out[key] = (out[key] as unknown[]).map((branch) =>
        isRecord(branch) ? withTransportFields(branch, openLink) : branch,
      );
    }
  }
  const declaresObject =
    out.type === "object" ||
    (out.properties !== undefined && out.type === undefined);
  if (!declaresObject) return out;

  const properties: JsonSchemaObject = {
    ...((out.properties as JsonSchemaObject | undefined) ?? {}),
  };
  delete properties[AGENT_IMAGES_FIELD];
  if (openLink) {
    properties.openLink = MCP_OPEN_LINK_SCHEMA;
    // The transport fills an absent or empty url with the open link's URL.
    properties.url = properties.url
      ? { anyOf: [properties.url, { type: "string" }] }
      : { type: "string" };
  }
  out.properties = properties;
  if (Array.isArray(out.required)) {
    out.required = (out.required as unknown[]).filter(
      (name) => name !== AGENT_IMAGES_FIELD,
    );
  }
  return out;
}

/**
 * Derive the MCP response contract from the semantic one. Only an object
 * root, an object-only composition, or an array root (wrapped as `{ items }`)
 * can become `structuredContent`, so any other root is refused here rather
 * than advertised as a contract no response could meet.
 */
export function deriveMcpResponseOutputSchema(
  semantic: JsonSchemaObject,
  options: { openLink: boolean },
): JsonSchemaObject {
  if (JSON.stringify(semantic).includes('"$ref":"#"')) {
    refuse("its root refers to itself.");
  }
  assertAdvertisable(semantic, semantic, true);
  const { $defs, definitions, ...root } = semantic;
  const tolerateDefs = (defs: unknown) =>
    isRecord(defs)
      ? Object.fromEntries(
          Object.entries(defs).map(([name, schema]) => [
            name,
            tolerateRedaction(schema, semantic),
          ]),
        )
      : defs;
  const defs = {
    ...($defs !== undefined ? { $defs: tolerateDefs($defs) } : {}),
    ...(definitions !== undefined
      ? { definitions: tolerateDefs(definitions) }
      : {}),
  };
  const rootType = root.type;
  if (
    rootType === "array" ||
    (Array.isArray(rootType) &&
      rootType.length === 1 &&
      rootType[0] === "array")
  ) {
    return withTransportFields(
      {
        type: "object",
        properties: { items: tolerateRedaction(root, semantic) },
        required: ["items"],
        additionalProperties: false,
        ...defs,
      },
      options.openLink,
    );
  }
  if (!isObjectOnly(root)) {
    refuse("its root must be an object, an object-only union, or an array.");
  }
  return {
    ...withTransportFields(
      tolerateRedaction(root, semantic) as JsonSchemaObject,
      options.openLink,
    ),
    type: "object",
    ...defs,
  };
}

export function buildActionMcpOutputContract(
  outputSchema: StandardSchemaV1,
  options: { openLink: boolean },
): ActionMcpOutputContract {
  const semantic = outputSchemaToJsonSchema(outputSchema);
  return {
    semantic,
    response: deriveMcpResponseOutputSchema(semantic, options),
  };
}

/**
 * Issue codes reported as they are: Standard Schema / Zod issue codes, JSON
 * Schema keywords, and the codes for a check that could not run. Anything
 * else — a custom refinement code can carry data — is reported as `invalid`.
 */
const REPORTED_ISSUE_CODES: ReadonlySet<string> = new Set([
  "invalid_type",
  "too_big",
  "too_small",
  "invalid_format",
  "not_multiple_of",
  "unrecognized_keys",
  "invalid_union",
  "invalid_key",
  "invalid_element",
  "invalid_value",
  "custom",
  "type",
  "required",
  "additionalProperties",
  "enum",
  "const",
  "format",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
  "maxProperties",
  "propertyNames",
  "anyOf",
  "oneOf",
  "allOf",
  "false schema",
  "validator_threw",
  "not_serializable",
  "transform_failed",
]);

function candidateNodes(
  node: unknown,
  root: JsonSchemaObject,
  depth = 0,
): JsonSchemaObject[] {
  if (!isRecord(node) || depth > 32) return [];
  const nodes = [node];
  if (typeof node.$ref === "string") {
    nodes.push(...candidateNodes(lookupRef(root, node.$ref), root, depth + 1));
  }
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    const branches = node[key];
    if (Array.isArray(branches)) {
      for (const branch of branches) {
        nodes.push(...candidateNodes(branch, root, depth + 1));
      }
    }
  }
  return nodes;
}

function isArrayNode(node: JsonSchemaObject): boolean {
  return (
    node.type === "array" ||
    (Array.isArray(node.type) && node.type.includes("array")) ||
    (node.type === undefined &&
      (node.items !== undefined || node.prefixItems !== undefined))
  );
}

/**
 * Whether a value under `node` may be an object, whose numeric-looking key is
 * data rather than an index. A node that only composes others says nothing:
 * its branches are candidates of their own.
 */
function mayBeObject(node: JsonSchemaObject): boolean {
  const composesOnly =
    node.type === undefined &&
    (typeof node.$ref === "string" ||
      Array.isArray(node.anyOf) ||
      Array.isArray(node.oneOf) ||
      Array.isArray(node.allOf)) &&
    node.properties === undefined &&
    node.additionalProperties === undefined &&
    node.patternProperties === undefined;
  return !composesOnly && typeAdmits(node, "object");
}

/**
 * One output-contract issue as `path: code`, built only from what the schema
 * declares. Object keys and messages can repeat the returned data — a record
 * key (`"42"` as much as `"dave@example.com"`), an unrecognized key, a
 * refinement message that interpolates a value — so the path is walked through
 * `schema`: a segment survives only as an index where the schema allows an
 * array and no object at that point, or as a property name the
 * schema declares at that node. Every other segment is `*`; without a schema, every segment is.
 */
export function describeOutputContractIssue(
  path: ReadonlyArray<string | number>,
  code: unknown,
  schema: JsonSchemaObject | undefined,
): string {
  let nodes = schema ? candidateNodes(schema, schema) : [];
  const segments: string[] = [];
  for (const raw of path) {
    const index =
      typeof raw === "number"
        ? raw
        : /^(0|[1-9]\d*)$/.test(raw)
          ? Number(raw)
          : undefined;
    const arrays =
      index !== undefined && Number.isSafeInteger(index)
        ? nodes.filter(isArrayNode)
        : [];
    const itemsOf = (array: JsonSchemaObject) => {
      const prefix = array.prefixItems;
      return candidateNodes(
        Array.isArray(prefix) && index! < prefix.length
          ? prefix[index!]
          : array.items,
        schema!,
      );
    };
    if (arrays.length > 0 && !nodes.some(mayBeObject)) {
      segments.push(String(index));
      nodes = arrays.flatMap(itemsOf);
      continue;
    }
    const key = String(raw);
    const declaring = nodes.filter(
      (node) =>
        isRecord(node.properties) && Object.hasOwn(node.properties, key),
    );
    if (declaring.length > 0) {
      segments.push(key);
      nodes = declaring.flatMap((node) =>
        candidateNodes((node.properties as JsonSchemaObject)[key], schema!),
      );
      continue;
    }
    // An index that could also be a record key is masked; both readings go on.
    segments.push("*");
    nodes = nodes.flatMap((node) => [
      ...(arrays.includes(node) ? itemsOf(node) : []),
      ...candidateNodes(node.additionalProperties, schema!),
      ...(isRecord(node.patternProperties)
        ? Object.values(node.patternProperties).flatMap((value) =>
            candidateNodes(value, schema!),
          )
        : []),
    ]);
  }
  const safeCode =
    typeof code === "string" && REPORTED_ISSUE_CODES.has(code)
      ? code
      : "invalid";
  return `${segments.length > 0 ? segments.join(".") : "(root)"}: ${safeCode}`;
}
