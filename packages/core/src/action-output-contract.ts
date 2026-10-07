import type { StandardSchemaV1 } from "@standard-schema/spec";

import { AGENT_IMAGES_FIELD } from "./agent/tool-result-images.js";
import { isObjectOnly } from "./mcp/tool-input-schema.js";

export type JsonSchemaObject = Record<string, unknown>;

/**
 * The two output contracts of an action that opts in with `mcpOutputSchema`.
 *
 * `semantic` describes the sanitized value `run` returns after `outputSchema`
 * validated it — what in-process callers and typed script bindings see.
 * `response` is what MCP advertises as the tool's `outputSchema`: the semantic
 * contract after the transport transform that builds `structuredContent`
 * (an array result is wrapped as `{ items }`, `_agentImages` is lifted into
 * image content, and actions that produce an open link gain optional
 * `openLink` and `url` fields).
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

function withTransportFields(
  node: JsonSchemaObject,
  openLink: boolean,
): JsonSchemaObject {
  const out: JsonSchemaObject = { ...node };
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    if (Array.isArray(out[key])) {
      out[key] = (out[key] as unknown[]).map((branch) =>
        branch && typeof branch === "object" && !Array.isArray(branch)
          ? withTransportFields(branch as JsonSchemaObject, openLink)
          : branch,
      );
    }
  }
  const declaresObject =
    out.type === "object" ||
    (out.properties !== undefined && out.type === undefined);
  if (!declaresObject) return out;

  const properties: Record<string, unknown> = {
    ...((out.properties as Record<string, unknown> | undefined) ?? {}),
  };
  delete properties[AGENT_IMAGES_FIELD];
  if (openLink) {
    properties.openLink = MCP_OPEN_LINK_SCHEMA;
    properties.url ??= { type: "string" };
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
    throw new TypeError(
      "mcpOutputSchema cannot advertise an outputSchema whose root refers to itself.",
    );
  }
  const { $defs, definitions, ...root } = semantic;
  const defs = {
    ...($defs !== undefined ? { $defs } : {}),
    ...(definitions !== undefined ? { definitions } : {}),
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
        properties: { items: root },
        required: ["items"],
        additionalProperties: false,
        ...defs,
      },
      options.openLink,
    );
  }
  if (!isObjectOnly(root)) {
    throw new TypeError(
      "mcpOutputSchema needs an outputSchema whose root is an object, an object-only union, or an array.",
    );
  }
  return {
    ...withTransportFields(root, options.openLink),
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

/** Every property name a JSON Schema declares, at any depth. */
export function outputContractPropertyNames(schema: unknown): Set<string> {
  const names = new Set<string>();
  const visit = (node: unknown, depth: number) => {
    if (!node || typeof node !== "object" || depth > 64) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    const record = node as Record<string, unknown>;
    const properties = record.properties;
    if (
      properties &&
      typeof properties === "object" &&
      !Array.isArray(properties)
    ) {
      for (const name of Object.keys(properties)) names.add(name);
    }
    for (const value of Object.values(record)) visit(value, depth + 1);
  };
  visit(schema, 0);
  return names;
}

const SAFE_ISSUE_CODE = /^[A-Za-z][A-Za-z_]{0,39}$/;

/**
 * One output-contract issue as `path: code`, built only from what the schema
 * declares. Messages and object keys can repeat the returned data — a record
 * key, an unrecognized key, a refinement message that interpolates a value — so
 * a path segment survives only as an array index or a property name the
 * schema itself declares, and the code only as a bare keyword.
 */
export function describeOutputContractIssue(
  path: ReadonlyArray<string | number>,
  code: unknown,
  declaredNames: ReadonlySet<string>,
): string {
  const segments = path.map((segment) =>
    typeof segment === "number" || /^\d+$/.test(segment)
      ? String(segment)
      : declaredNames.has(segment)
        ? segment
        : "*",
  );
  const safeCode =
    typeof code === "string" && SAFE_ISSUE_CODE.test(code) ? code : "invalid";
  return `${segments.length > 0 ? segments.join(".") : "(root)"}: ${safeCode}`;
}
