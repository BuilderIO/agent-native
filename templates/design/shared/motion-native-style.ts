export const MOTION_NATIVE_STYLE_INSTANCE_TYPE = "FIGMA" as const;

export const MOTION_NATIVE_STYLE_KEYS = [
  "TextStagger",
  "Position",
  "Scale",
  "Rotation",
  "Size",
  "Opacity",
  "Path",
] as const;

export type MotionNativeStyleKey = (typeof MOTION_NATIVE_STYLE_KEYS)[number];

export type MotionNativeStyleJsonValue =
  | null
  | boolean
  | number
  | string
  | MotionNativeStyleJsonValue[]
  | { [key: string]: MotionNativeStyleJsonValue };

export interface MotionNativeStyleInstance {
  /** Discriminates native Figma instances from the local CSS track catalog. */
  type: typeof MOTION_NATIVE_STYLE_INSTANCE_TYPE;
  styleKey: MotionNativeStyleKey;
  /** Source identifiers are copied verbatim when Figma supplies them. */
  sourceStyleId?: string;
  sourceInstanceId?: string;
  /** Stable localization key for the instance's display name. */
  nameKey: string;
  /** Duration in seconds. */
  duration: number;
  /** Offset on the parent timeline in seconds. */
  timelineOffset: number;
  targetNodeId: string;
  enabled?: boolean;
  /** Unknown Figma properties are retained as bounded JSON without projection. */
  props: { [key: string]: MotionNativeStyleJsonValue };
}

export const MOTION_NATIVE_STYLE_INSTANCE_MAX_COUNT = 128;
export const MOTION_NATIVE_STYLE_PROPS_MAX_DEPTH = 16;
export const MOTION_NATIVE_STYLE_PROPS_MAX_NODES = 4_096;
export const MOTION_NATIVE_STYLE_PROPS_MAX_BYTES = 64 * 1024;

const MAX_STYLE_KEY_LENGTH = 128;
const MAX_SOURCE_ID_LENGTH = 512;
const MAX_TARGET_NODE_ID_LENGTH = 512;

export type MotionNativeStyleInstanceErrorCode =
  | "invalid-shape"
  | "invalid-type"
  | "invalid-style-key"
  | "invalid-field"
  | "invalid-props"
  | "props-too-deep"
  | "props-too-large";

export class MotionNativeStyleInstanceError extends TypeError {
  constructor(
    readonly code: MotionNativeStyleInstanceErrorCode,
    message: string,
    readonly path?: string,
  ) {
    super(message);
    this.name = "MotionNativeStyleInstanceError";
  }
}

/** Validates one native Figma instance without normalizing or projecting it. */
export function assertMotionNativeStyleInstance(
  value: unknown,
): asserts value is MotionNativeStyleInstance {
  const fields = ownDataEntries(value, "style instance", "invalid-shape");
  assertOnlyKeys(
    fields,
    [
      "type",
      "styleKey",
      "sourceStyleId",
      "sourceInstanceId",
      "nameKey",
      "duration",
      "timelineOffset",
      "targetNodeId",
      "enabled",
      "props",
    ],
    "style instance",
  );
  assertRequiredKeys(
    fields,
    [
      "type",
      "styleKey",
      "nameKey",
      "duration",
      "timelineOffset",
      "targetNodeId",
      "props",
    ],
    "style instance",
  );

  if (fields.get("type") !== MOTION_NATIVE_STYLE_INSTANCE_TYPE) {
    invalid(
      "invalid-type",
      'style instance.type must be "FIGMA"',
      "style instance.type",
    );
  }

  const styleKey = fields.get("styleKey");
  if (
    typeof styleKey !== "string" ||
    !(MOTION_NATIVE_STYLE_KEYS as readonly string[]).includes(styleKey)
  ) {
    invalid(
      "invalid-style-key",
      `style instance.styleKey must be one of ${MOTION_NATIVE_STYLE_KEYS.join(", ")}`,
      "style instance.styleKey",
    );
  }

  for (const idKey of ["sourceStyleId", "sourceInstanceId"] as const) {
    if (fields.has(idKey)) {
      requireBoundedString(
        fields.get(idKey),
        `style instance.${idKey}`,
        MAX_SOURCE_ID_LENGTH,
      );
    }
  }

  requireBoundedString(
    fields.get("nameKey"),
    "style instance.nameKey",
    MAX_STYLE_KEY_LENGTH,
    true,
  );
  const duration = fields.get("duration");
  requireFiniteNumber(duration, "style instance.duration");
  if (duration <= 0 || duration > 120) {
    invalid(
      "invalid-field",
      "style instance.duration must be greater than 0 and at most 120 seconds",
      "style instance.duration",
    );
  }
  const timelineOffset = fields.get("timelineOffset");
  requireFiniteNumber(timelineOffset, "style instance.timelineOffset");
  if (timelineOffset < 0 || timelineOffset > 120) {
    invalid(
      "invalid-field",
      "style instance.timelineOffset must be between 0 and 120 seconds",
      "style instance.timelineOffset",
    );
  }
  requireBoundedString(
    fields.get("targetNodeId"),
    "style instance.targetNodeId",
    MAX_TARGET_NODE_ID_LENGTH,
    true,
  );

  if (fields.has("enabled") && typeof fields.get("enabled") !== "boolean") {
    invalid(
      "invalid-field",
      "style instance.enabled must be a boolean",
      "style instance.enabled",
    );
  }

  assertBoundedJsonObject(fields.get("props"), "style instance.props");
}

/** Validates a bounded collection while keeping Figma instances separate from local styles. */
export function assertMotionNativeStyleInstances(
  value: unknown,
): asserts value is MotionNativeStyleInstance[] {
  if (!isArray(value, "native style instances", "invalid-shape")) {
    invalid("invalid-shape", "native style instances must be an array");
  }
  const instances = ownArrayEntries(
    value,
    "native style instances",
    "invalid-shape",
    MOTION_NATIVE_STYLE_INSTANCE_MAX_COUNT,
  );
  for (const instance of instances) {
    assertMotionNativeStyleInstance(instance);
  }
}

function assertBoundedJsonObject(value: unknown, path: string): void {
  const prototype = getPrototype(value, path);
  if (prototype !== Object.prototype && prototype !== null) {
    invalid("invalid-props", `${path} must be a plain JSON object`, path);
  }

  let nodeCount = 0;
  let byteCount = 0;
  const active = new WeakSet<object>();
  const encoder = new TextEncoder();

  const addBytes = (text: string, currentPath: string) => {
    byteCount += encoder.encode(text).byteLength;
    if (byteCount > MOTION_NATIVE_STYLE_PROPS_MAX_BYTES) {
      invalid(
        "props-too-large",
        `${path} must serialize to at most ${MOTION_NATIVE_STYLE_PROPS_MAX_BYTES} bytes`,
        currentPath,
      );
    }
  };

  const addString = (text: string, currentPath: string) => {
    if (text.length > MOTION_NATIVE_STYLE_PROPS_MAX_BYTES) {
      invalid(
        "props-too-large",
        `${path} must serialize to at most ${MOTION_NATIVE_STYLE_PROPS_MAX_BYTES} bytes`,
        currentPath,
      );
    }
    addBytes(JSON.stringify(text), currentPath);
  };

  const visit = (entry: unknown, currentPath: string, depth: number): void => {
    nodeCount += 1;
    if (nodeCount > MOTION_NATIVE_STYLE_PROPS_MAX_NODES) {
      invalid(
        "props-too-large",
        `${path} must contain at most ${MOTION_NATIVE_STYLE_PROPS_MAX_NODES} JSON values`,
        currentPath,
      );
    }
    if (depth > MOTION_NATIVE_STYLE_PROPS_MAX_DEPTH) {
      invalid(
        "props-too-deep",
        `${path} must be no more than ${MOTION_NATIVE_STYLE_PROPS_MAX_DEPTH} levels deep`,
        currentPath,
      );
    }

    if (entry === null) {
      addBytes("null", currentPath);
      return;
    }
    if (typeof entry === "boolean") {
      addBytes(entry ? "true" : "false", currentPath);
      return;
    }
    if (typeof entry === "string") {
      addString(entry, currentPath);
      return;
    }
    if (typeof entry === "number") {
      if (!Number.isFinite(entry)) {
        invalid(
          "invalid-props",
          `${currentPath} must be a finite JSON number`,
          currentPath,
        );
      }
      addBytes(JSON.stringify(entry), currentPath);
      return;
    }
    if (typeof entry !== "object") {
      invalid(
        "invalid-props",
        `${currentPath} must contain only JSON values`,
        currentPath,
      );
    }

    if (active.has(entry)) {
      invalid(
        "invalid-props",
        `${currentPath} must not contain a circular reference`,
        currentPath,
      );
    }
    active.add(entry);

    if (isArray(entry, currentPath, "invalid-props")) {
      addBytes("[", currentPath);
      const entries = ownArrayEntries(entry, currentPath, "invalid-props");
      for (let index = 0; index < entries.length; index += 1) {
        if (index > 0) addBytes(",", currentPath);
        visit(entries[index], `${currentPath}[${index}]`, depth + 1);
      }
      addBytes("]", currentPath);
    } else {
      const objectPrototype = getPrototype(entry, currentPath);
      if (objectPrototype !== Object.prototype && objectPrototype !== null) {
        invalid(
          "invalid-props",
          `${currentPath} must be a plain JSON object`,
          currentPath,
        );
      }
      addBytes("{", currentPath);
      const entries = ownDataEntries(entry, currentPath, "invalid-props");
      let index = 0;
      for (const [key, child] of entries) {
        if (index > 0) addBytes(",", currentPath);
        addString(key, `${currentPath}.${key}`);
        addBytes(":", currentPath);
        visit(child, `${currentPath}.${key}`, depth + 1);
        index += 1;
      }
      addBytes("}", currentPath);
    }

    active.delete(entry);
  };

  visit(value, path, 0);
}

function ownDataEntries(
  value: unknown,
  path: string,
  code: MotionNativeStyleInstanceErrorCode,
): Map<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    isArray(value, path, code)
  ) {
    invalid(code, `${path} must be an object`, path);
  }

  const prototype = getPrototype(value, path, code);
  if (prototype !== Object.prototype && prototype !== null) {
    invalid(code, `${path} must be a plain object`, path);
  }

  let keys: (string | symbol)[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    invalid(code, `${path} keys could not be read safely`, path);
  }

  const entries = new Map<string, unknown>();
  for (const key of keys) {
    if (typeof key !== "string") {
      invalid(code, `${path} must not contain symbol keys`, path);
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      invalid(
        code,
        `${path}.${key} could not be read safely`,
        `${path}.${key}`,
      );
    }
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      invalid(
        code,
        `${path}.${key} must be an enumerable data property`,
        `${path}.${key}`,
      );
    }
    entries.set(key, descriptor.value);
  }
  return entries;
}

function ownArrayEntries(
  value: unknown[],
  path: string,
  code: MotionNativeStyleInstanceErrorCode,
  maxLength = MOTION_NATIVE_STYLE_PROPS_MAX_NODES,
): unknown[] {
  const prototype = getPrototype(value, path, code);
  if (prototype !== Array.prototype) {
    invalid(code, `${path} must be a plain JSON array`, path);
  }

  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  } catch {
    invalid(code, `${path} length could not be read safely`, path);
  }
  if (
    !lengthDescriptor ||
    !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" ||
    !Number.isInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    invalid(code, `${path} length is invalid`, path);
  }
  const length = lengthDescriptor.value;

  if (length > maxLength) {
    invalid(code, `${path} must contain at most ${maxLength} entries`, path);
  }

  let keys: (string | symbol)[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    invalid(code, `${path} keys could not be read safely`, path);
  }

  if (keys.length !== length + 1 || !keys.includes("length")) {
    invalid(
      code,
      `${path} must be a dense JSON array without extra properties`,
      path,
    );
  }

  const entries: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const key = String(index);
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      invalid(
        code,
        `${path}[${index}] could not be read safely`,
        `${path}[${index}]`,
      );
    }
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      invalid(
        code,
        `${path}[${index}] must be an enumerable data property`,
        `${path}[${index}]`,
      );
    }
    entries.push(descriptor.value);
  }

  return entries;
}

function assertOnlyKeys(
  fields: Map<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const key of fields.keys()) {
    if (!allowed.includes(key)) {
      invalid(
        "invalid-shape",
        `${path}.${key} is not supported`,
        `${path}.${key}`,
      );
    }
  }
}

function assertRequiredKeys(
  fields: Map<string, unknown>,
  required: readonly string[],
  path: string,
): void {
  for (const key of required) {
    if (!fields.has(key)) {
      invalid("invalid-shape", `${path}.${key} is required`, `${path}.${key}`);
    }
  }
}

function requireBoundedString(
  value: unknown,
  path: string,
  maxLength: number,
  requireNonBlank = false,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length > maxLength ||
    (requireNonBlank && value.trim().length === 0)
  ) {
    invalid(
      "invalid-field",
      `${path} must be a string${requireNonBlank ? " with content" : ""} up to ${maxLength} characters`,
      path,
    );
  }
}

function requireFiniteNumber(
  value: unknown,
  path: string,
): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    invalid("invalid-field", `${path} must be a finite number`, path);
  }
}

function getPrototype(
  value: unknown,
  path: string,
  code: MotionNativeStyleInstanceErrorCode = "invalid-props",
): object | null {
  if (typeof value !== "object" || value === null) {
    invalid(code, `${path} must be an object`, path);
  }
  try {
    return Object.getPrototypeOf(value);
  } catch {
    invalid(code, `${path} prototype could not be read safely`, path);
  }
}

function isArray(
  value: unknown,
  path: string,
  code: MotionNativeStyleInstanceErrorCode,
): value is unknown[] {
  try {
    return Array.isArray(value);
  } catch {
    invalid(code, `${path} array shape could not be read safely`, path);
  }
}

function invalid(
  code: MotionNativeStyleInstanceErrorCode,
  message: string,
  path?: string,
): never {
  throw new MotionNativeStyleInstanceError(code, message, path);
}
