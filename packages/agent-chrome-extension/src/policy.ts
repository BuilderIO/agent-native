import type {
  BrowserCommand,
  BrowserKey,
  BrowserModifier,
  NativeRequest,
} from "./protocol";

export class ProtocolValidationError extends Error {
  readonly code = "INVALID_COMMAND";
}

const KEYS = new Set<BrowserKey>([
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "Backspace",
  "Delete",
  "End",
  "Enter",
  "Escape",
  "Home",
  "PageDown",
  "PageUp",
  "Space",
  "Tab",
]);
const MODIFIERS = new Set<BrowserModifier>(["alt", "control", "meta", "shift"]);
const BUTTONS = new Set(["left", "middle", "right"]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProtocolValidationError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    throw new ProtocolValidationError(
      `${label} must be a non-empty string of at most ${maxLength} characters.`,
    );
  }
  return value;
}

function boundedString(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (typeof value !== "string" || value.length > maxLength) {
    throw new ProtocolValidationError(
      `${label} must be a string of at most ${maxLength} characters.`,
    );
  }
  return value;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new ProtocolValidationError(`${label} must be a boolean.`);
  }
  return value;
}

function finiteNumber(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
    throw new ProtocolValidationError(
      `${label} must be between ${min} and ${max}.`,
    );
  }
  return value;
}

function integer(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  const parsed = finiteNumber(value, label, min, max);
  if (!Number.isInteger(parsed))
    throw new ProtocolValidationError(`${label} must be an integer.`);
  return parsed;
}

export function normalizeAllowedOrigin(value: unknown): string {
  const input = nonEmptyString(value, "origin", 2_048);
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ProtocolValidationError("origin must be an absolute URL origin.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ProtocolValidationError(
      "Only HTTP(S) origins can be controlled.",
    );
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new ProtocolValidationError(
      "Allowed origins must not include credentials, paths, queries, or fragments.",
    );
  }
  return url.origin;
}

export function assertUrlAllowed(
  value: unknown,
  allowedOrigins: ReadonlySet<string>,
): URL {
  const input = nonEmptyString(value, "url", 16_384);
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ProtocolValidationError("url must be an absolute URL.");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password
  ) {
    throw new ProtocolValidationError(
      "Only credential-free HTTP(S) URLs can be controlled.",
    );
  }
  if (!allowedOrigins.has(url.origin)) {
    throw new ProtocolValidationError(
      `Origin ${url.origin} is outside this task's allowed origins.`,
    );
  }
  return url;
}

function target(value: unknown): {
  observationId: string;
  backendNodeId: number;
} {
  const input = record(value, "target");
  return {
    observationId: nonEmptyString(
      input.observationId,
      "target.observationId",
      256,
    ),
    backendNodeId: integer(
      input.backendNodeId,
      "target.backendNodeId",
      1,
      2_147_483_647,
    ),
  };
}

function parseCommand(value: unknown): BrowserCommand {
  const input = record(value, "command");
  const type = nonEmptyString(input.type, "command.type", 64);
  switch (type) {
    case "attach": {
      if (
        !Array.isArray(input.allowedOrigins) ||
        input.allowedOrigins.length === 0 ||
        input.allowedOrigins.length > 32
      ) {
        throw new ProtocolValidationError(
          "attach.allowedOrigins must contain 1 to 32 exact origins.",
        );
      }
      return {
        type,
        tabId: integer(input.tabId, "attach.tabId", 0, 2_147_483_647),
        allowedOrigins: [
          ...new Set(input.allowedOrigins.map(normalizeAllowedOrigin)),
        ],
      };
    }
    case "detach":
    case "stop":
      return { type };
    case "observe":
      return {
        type,
        includeScreenshot: optionalBoolean(
          input.includeScreenshot,
          "observe.includeScreenshot",
        ),
        maxNodes:
          input.maxNodes === undefined
            ? undefined
            : integer(input.maxNodes, "observe.maxNodes", 1, 2_000),
      };
    case "click": {
      const button =
        input.button === undefined
          ? undefined
          : nonEmptyString(input.button, "click.button", 16);
      if (button && !BUTTONS.has(button))
        throw new ProtocolValidationError("click.button is not supported.");
      return {
        type,
        target: target(input.target),
        button: button as "left" | "middle" | "right" | undefined,
      };
    }
    case "type":
      return {
        type,
        target: target(input.target),
        text: boundedString(input.text, "type.text", 100_000),
        replace: optionalBoolean(input.replace, "type.replace"),
      };
    case "key": {
      const key = nonEmptyString(input.key, "key.key", 32) as BrowserKey;
      if (!KEYS.has(key))
        throw new ProtocolValidationError("key.key is not supported.");
      if (input.modifiers !== undefined && !Array.isArray(input.modifiers)) {
        throw new ProtocolValidationError("key.modifiers must be an array.");
      }
      const modifiers = (input.modifiers ?? []).map(
        (item) => nonEmptyString(item, "key.modifier", 16) as BrowserModifier,
      );
      if (modifiers.some((item) => !MODIFIERS.has(item)))
        throw new ProtocolValidationError("key.modifier is not supported.");
      return { type, key, modifiers: [...new Set(modifiers)] };
    }
    case "navigate":
      return { type, url: nonEmptyString(input.url, "navigate.url", 16_384) };
    case "scroll":
      return {
        type,
        deltaX: finiteNumber(input.deltaX, "scroll.deltaX", -100_000, 100_000),
        deltaY: finiteNumber(input.deltaY, "scroll.deltaY", -100_000, 100_000),
        x:
          input.x === undefined
            ? undefined
            : finiteNumber(input.x, "scroll.x", 0, 100_000),
        y:
          input.y === undefined
            ? undefined
            : finiteNumber(input.y, "scroll.y", 0, 100_000),
      };
    default:
      throw new ProtocolValidationError(`Unsupported command type: ${type}.`);
  }
}

export function parseNativeRequest(value: unknown): NativeRequest {
  const input = record(value, "request");
  return {
    id: nonEmptyString(input.id, "request.id", 256),
    taskId: nonEmptyString(input.taskId, "request.taskId", 256),
    command: parseCommand(input.command),
  };
}
