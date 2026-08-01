import { Validator as InterpretedValidator } from "@cfworker/json-schema";
import type Ajv from "ajv";
import type { ValidateFunction } from "ajv";

/**
 * One compile seam for the agent loop's JSON-Schema checks.
 *
 * Ajv turns a schema into a validator by building JavaScript source and handing
 * it to `new Function`. Cloudflare Workers — and any other runtime with the same
 * restriction — refuse that outright ("Code generation from strings disallowed
 * for this context"), so every `ajv.compile` call throws and every agent tool
 * call is rejected before it runs. Both Ajv instances in the agent loop go
 * through here so the decision is made once, on the capability rather than on
 * the host name: a future runtime with the same restriction needs no second
 * detector.
 *
 * Where `new Function` works, Ajv is used exactly as before — same options, same
 * `ErrorObject`s, same error text. Where it does not, the schema is interpreted
 * by `@cfworker/json-schema`, which evaluates the schema as data.
 *
 * The two produce DIFFERENT ERROR TEXT and that is accepted. What must not
 * differ is the accept/reject decision, and — for the coercing instance — the
 * value left behind on the input. `json-schema-validator.spec.ts` runs the same
 * schemas and inputs through both paths to hold them to that.
 */

export interface CompiledSchemaValidator {
  (data: unknown): boolean;
  errors?: ValidateFunction["errors"];
  /**
   * Error text for the last rejection. Present only on the interpreted path;
   * the Ajv path leaves this undefined so callers keep using `ajv.errorsText`
   * with their own error shaping.
   */
  interpretedErrorText?: string;
}

let codeGenerationAllowed: boolean | null = null;

/**
 * Probe rather than sniff: constructing one trivial function is exactly what
 * Ajv does, so a runtime that allows this allows Ajv. Cached because the answer
 * cannot change within an isolate.
 */
export function runtimeAllowsCodeGeneration(): boolean {
  if (codeGenerationAllowed !== null) return codeGenerationAllowed;
  try {
    // eslint-disable-next-line no-new-func
    new Function("return 1");
    codeGenerationAllowed = true;
  } catch {
    codeGenerationAllowed = false;
  }
  return codeGenerationAllowed;
}

/** Test seam: forget the cached probe result. */
export function resetCodeGenerationProbeForTests(): void {
  codeGenerationAllowed = null;
}

export interface CompileSchemaValidatorOptions {
  /** Mirror of the Ajv instance's `coerceTypes` setting. */
  coerceTypes?: boolean;
}

/**
 * Compile `schema` with `ajv`, or interpret it when the runtime forbids code
 * generation. Throws on a schema that is genuinely invalid, on either path —
 * "this schema cannot be understood" must never resolve to "this input is
 * fine".
 */
export function compileSchemaValidator(
  ajv: Ajv,
  schema: object,
  options: CompileSchemaValidatorOptions = {},
): CompiledSchemaValidator {
  if (runtimeAllowsCodeGeneration()) {
    const validator = ajv.compile(schema);
    const wrapped: CompiledSchemaValidator = (data: unknown) => {
      const ok = validator(data);
      wrapped.errors = validator.errors;
      return ok;
    };
    return wrapped;
  }

  // Neither of the next two is wrapped in a try: the caller distinguishes
  // "schema is invalid" from "input is invalid" by catching here.
  assertInterpretableSchema(schema);
  const interpreted = new InterpretedValidator(
    schema as Record<string, unknown>,
    "2020-12",
    false,
  );
  const wrapped: CompiledSchemaValidator = (data: unknown) => {
    const target =
      options.coerceTypes === true ? coerceScalarsToSchema(schema, data) : data;
    const outcome = interpreted.validate(target);
    wrapped.errors = null;
    wrapped.interpretedErrorText = outcome.valid
      ? undefined
      : formatInterpretedErrors(outcome.errors);
    return outcome.valid;
  };
  return wrapped;
}

const JSON_SCHEMA_TYPES = new Set([
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "null",
]);

/**
 * Ajv validates a schema against the JSON Schema metaschema and throws on a
 * malformed one. The interpreter does not: it ignores a keyword it cannot read
 * and then accepts everything, which would turn "this schema is unreadable"
 * into "this input is fine" — the failure this whole effort exists to remove.
 *
 * This is a structural check over the keywords `defineAction`'s schema
 * conversion actually emits, not a metaschema implementation, because the
 * interpreter ships no metaschema document. A malformed schema outside this set
 * would be caught by Ajv and not here; that gap is a narrower one than trusting
 * an unreadable schema, and it is a gap in what is DETECTED, never a schema
 * being wrongly treated as satisfied.
 */
function assertInterpretableSchema(schema: unknown, path = "#"): void {
  if (typeof schema === "boolean") return;
  if (!isPlainObject(schema)) {
    throw new TypeError(`schema at ${path} must be an object or boolean`);
  }

  const type = schema.type;
  if (type !== undefined) {
    const values = Array.isArray(type) ? type : [type];
    for (const value of values) {
      if (typeof value !== "string" || !JSON_SCHEMA_TYPES.has(value)) {
        throw new TypeError(
          `schema at ${path} has an unknown type ${JSON.stringify(value)}`,
        );
      }
    }
  }

  if (schema.required !== undefined) {
    if (
      !Array.isArray(schema.required) ||
      schema.required.some((name) => typeof name !== "string")
    ) {
      throw new TypeError(`schema at ${path} has a malformed "required"`);
    }
  }

  if (schema.enum !== undefined && !Array.isArray(schema.enum)) {
    throw new TypeError(`schema at ${path} has a malformed "enum"`);
  }

  for (const keyword of ["properties", "patternProperties", "$defs"] as const) {
    const value = schema[keyword];
    if (value === undefined) continue;
    if (!isPlainObject(value)) {
      throw new TypeError(`schema at ${path} has a malformed "${keyword}"`);
    }
    for (const [key, child] of Object.entries(value)) {
      assertInterpretableSchema(child, `${path}/${keyword}/${key}`);
    }
  }

  for (const keyword of ["anyOf", "oneOf", "allOf"] as const) {
    const value = schema[keyword];
    if (value === undefined) continue;
    if (!Array.isArray(value)) {
      throw new TypeError(`schema at ${path} has a malformed "${keyword}"`);
    }
    value.forEach((child, index) => {
      assertInterpretableSchema(child, `${path}/${keyword}/${index}`);
    });
  }

  for (const keyword of [
    "items",
    "not",
    "additionalProperties",
    "if",
    "then",
    "else",
  ] as const) {
    const value = schema[keyword];
    if (value === undefined) continue;
    assertInterpretableSchema(value, `${path}/${keyword}`);
  }
}

function formatInterpretedErrors(
  errors: ReadonlyArray<{ instanceLocation: string; error: string }>,
): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const error of errors) {
    // "#/foo/bar" reads as "input/foo/bar", matching Ajv's `dataVar` framing.
    const where = error.instanceLocation.replace(/^#/, "input");
    const line = `${where} ${error.error}`;
    if (seen.has(line)) continue;
    seen.add(line);
    parts.push(line);
  }
  return parts.join("; ") || "input did not match the schema";
}

/* ─── Type coercion ──────────────────────────────────────────────────────── */

/**
 * Reproduces Ajv's `coerceTypes: true` scalar coercion, which the interpreted
 * validator has no equivalent for. Without it a model that sends `"3"` for a
 * `number` field is accepted on Node and rejected on a Worker — the same tool
 * call succeeding on one host and failing on another.
 *
 * Ajv coerces IN PLACE, and the mutated object is what the action then runs
 * with, so this does too. Only scalars are coerced; objects and arrays never
 * are, matching Ajv's non-`"array"` mode.
 *
 * Coverage is the scalar table plus `properties`, `items`, `$ref` into `$defs`,
 * and `anyOf`/`oneOf` branch selection. A schema keyword outside that set is
 * left alone rather than guessed at, which can only make this path stricter
 * than Ajv, never looser.
 */
export function coerceScalarsToSchema(schema: unknown, data: unknown): unknown {
  return coerceNode(schema, data, resolveRoot(schema), 0);
}

function resolveRoot(schema: unknown): Record<string, unknown> | null {
  return isPlainObject(schema) ? schema : null;
}

const MAX_COERCE_DEPTH = 32;

function coerceNode(
  schema: unknown,
  data: unknown,
  root: Record<string, unknown> | null,
  depth: number,
): unknown {
  if (depth > MAX_COERCE_DEPTH || !isPlainObject(schema)) return data;

  const resolved = resolveRef(schema, root);
  if (resolved !== schema) return coerceNode(resolved, data, root, depth + 1);

  const branches = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(branches)) {
    // Ajv coerces within whichever branch ends up matching. Take the first
    // branch whose coercion produces a value that branch accepts; if none does,
    // leave the value untouched so the rejection reports the original input.
    for (const branch of branches) {
      const candidate = coerceNode(branch, data, root, depth + 1);
      if (candidate === data) continue;
      if (interpretedAccepts(branch, candidate, root)) return candidate;
    }
    return data;
  }

  if (Array.isArray(data)) {
    const items = schema.items;
    if (!items) return data;
    for (let index = 0; index < data.length; index += 1) {
      data[index] = coerceNode(items, data[index], root, depth + 1);
    }
    return data;
  }

  if (isPlainObject(data)) {
    const properties = schema.properties;
    if (isPlainObject(properties)) {
      for (const [key, value] of Object.entries(data)) {
        if (!(key in properties)) continue;
        data[key] = coerceNode(properties[key], value, root, depth + 1);
      }
    }
    return data;
  }

  return coerceScalar(schema.type, data);
}

function interpretedAccepts(
  schema: unknown,
  data: unknown,
  root: Record<string, unknown> | null,
): boolean {
  if (!isPlainObject(schema)) return false;
  // A branch that references the root's `$defs` cannot be validated standalone,
  // so carry the definitions across rather than reporting a spurious mismatch.
  const standalone =
    root && root.$defs && !schema.$defs
      ? { ...schema, $defs: root.$defs }
      : schema;
  try {
    return new InterpretedValidator(
      standalone as Record<string, unknown>,
      "2020-12",
      false,
    ).validate(data).valid;
    // This only picks which union branch to coerce INTO, never whether the
    // input is valid. A branch that cannot be built standalone is one this
    // function declines to coerce into, so the value is left as the caller sent
    // it and the real accept/reject still happens in the top-level validator —
    // which `assertInterpretableSchema` has already proven readable.
    // coercion-ok: declining to coerce, not deciding validity.
  } catch {
    return false;
  }
}

function resolveRef(
  schema: Record<string, unknown>,
  root: Record<string, unknown> | null,
): unknown {
  const ref = schema.$ref;
  if (typeof ref !== "string" || !root) return schema;
  if (!ref.startsWith("#/")) return schema;
  let node: unknown = root;
  for (const rawSegment of ref.slice(2).split("/")) {
    const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isPlainObject(node)) return schema;
    node = node[segment];
  }
  return isPlainObject(node) ? node : schema;
}

function coerceScalar(type: unknown, value: unknown): unknown {
  if (typeof type === "string") return coerceToType(type, value);
  if (!Array.isArray(type)) return value;
  // Ajv walks the union in order and keeps the first successful coercion.
  for (const candidate of type) {
    if (typeof candidate !== "string") continue;
    if (matchesJsonType(candidate, value)) return value;
  }
  for (const candidate of type) {
    if (typeof candidate !== "string") continue;
    const coerced = coerceToType(candidate, value);
    if (coerced !== value) return coerced;
  }
  return value;
}

function matchesJsonType(type: string, value: unknown): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return false;
  }
}

function coerceToType(type: string, value: unknown): unknown {
  if (matchesJsonType(type, value)) return value;
  // Objects and arrays are never coerced, and never coerced INTO.
  if (typeof value === "object" && value !== null) return value;
  if (value === undefined) return value;

  switch (type) {
    case "string":
      if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
      }
      if (value === null) return "";
      return value;
    case "number":
    case "integer": {
      if (typeof value === "string") {
        if (value.trim() === "") return value;
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return value;
        if (type === "integer" && !Number.isInteger(parsed)) return value;
        return parsed;
      }
      if (typeof value === "boolean") return value ? 1 : 0;
      if (value === null) return 0;
      return value;
    }
    case "boolean":
      if (value === "true") return true;
      if (value === "false") return false;
      if (value === 1) return true;
      if (value === 0) return false;
      if (value === null) return false;
      return value;
    case "null":
      if (value === "" || value === 0 || value === false) return null;
      return value;
    default:
      return value;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
