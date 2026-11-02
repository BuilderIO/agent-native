export type JsonPath = ReadonlyArray<string | number>;

export interface PartialJson {
  /** Everything parsed so far; containers still being written are closed. */
  value: unknown;
  /** True when the text was a complete JSON document. */
  complete: boolean;
  /**
   * Path of the string still being written, if the text stops inside one.
   * Every other string in `value` is complete.
   */
  openStringPath: JsonPath | null;
  /** True when the text can't become valid JSON however it continues. */
  invalid: boolean;
}

const INCOMPLETE = Symbol("incomplete");

/**
 * Parses JSON that is still streaming in. A string cut off mid-way keeps what
 * has arrived, a number or literal cut off mid-way is dropped, and unclosed
 * objects and arrays are closed. A key whose value hasn't started is omitted.
 */
export function parsePartialJson(text: string): PartialJson {
  let index = 0;
  let openStringPath: JsonPath | null = null;

  const skipWhitespace = () => {
    while (index < text.length && /\s/.test(text.charAt(index))) index++;
  };

  const readString = (path: JsonPath): string => {
    index++;
    let value = "";
    while (index < text.length) {
      const char = text.charAt(index);
      if (char === '"') {
        index++;
        return value;
      }
      if (char === "\\") {
        if (index + 1 >= text.length) break;
        const next = text.charAt(index + 1);
        if (next === "u") {
          const code = text.slice(index + 2, index + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(code)) break;
          value += String.fromCharCode(Number.parseInt(code, 16));
          index += 6;
          continue;
        }
        value +=
          next === "n"
            ? "\n"
            : next === "r"
              ? "\r"
              : next === "t"
                ? "\t"
                : next === "b"
                  ? "\b"
                  : next === "f"
                    ? "\f"
                    : next;
        index += 2;
        continue;
      }
      value += char;
      index++;
    }
    index = text.length;
    openStringPath = path;
    return value;
  };

  const readValue = (path: JsonPath): unknown => {
    skipWhitespace();
    if (index >= text.length) return INCOMPLETE;
    const char = text.charAt(index);
    if (char === '"') return readString(path);
    if (char === "{") {
      index++;
      const object: Record<string, unknown> = {};
      for (;;) {
        skipWhitespace();
        if (index >= text.length) return object;
        if (text[index] === "}") {
          index++;
          return object;
        }
        if (text[index] === ",") {
          index++;
          continue;
        }
        if (text[index] !== '"') throw new SyntaxError("Expected a key");
        const key = readString(path);
        if (openStringPath === path) {
          // The key itself is still being written.
          openStringPath = null;
          return object;
        }
        skipWhitespace();
        if (index >= text.length) return object;
        if (text[index] !== ":") throw new SyntaxError("Expected ':'");
        index++;
        const value = readValue([...path, key]);
        if (value === INCOMPLETE) return object;
        object[key] = value;
      }
    }
    if (char === "[") {
      index++;
      const array: unknown[] = [];
      for (;;) {
        skipWhitespace();
        if (index >= text.length) return array;
        if (text[index] === "]") {
          index++;
          return array;
        }
        if (text[index] === ",") {
          index++;
          continue;
        }
        const value = readValue([...path, array.length]);
        if (value === INCOMPLETE) return array;
        array.push(value);
      }
    }
    const literal =
      /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(
        text.slice(index),
      );
    if (!literal) {
      if (/^(?:-|\d|t|f|n)/.test(text.slice(index))) {
        index = text.length;
        return INCOMPLETE;
      }
      throw new SyntaxError(`Unexpected character ${char}`);
    }
    // A number at the very end may still be growing.
    if (index + literal[0].length >= text.length && /^[-\d]/.test(literal[0])) {
      index = text.length;
      return INCOMPLETE;
    }
    index += literal[0].length;
    return JSON.parse(literal[0]);
  };

  try {
    const parsed = JSON.parse(text);
    return {
      value: parsed,
      complete: true,
      openStringPath: null,
      invalid: false,
    };
    // A full parse failing just means the text is still streaming; the
    // partial parser below reports text that can never become JSON.
    // coercion-ok: falls through to the partial parser, which flags `invalid`
  } catch {}
  try {
    const value = readValue([]);
    return {
      value: value === INCOMPLETE ? undefined : value,
      complete: false,
      openStringPath,
      invalid: false,
    };
  } catch {
    return {
      value: undefined,
      complete: false,
      openStringPath: null,
      invalid: true,
    };
  }
}

export function readJsonPath(value: unknown, path: JsonPath): unknown {
  let current = value;
  for (const segment of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

/** True when the string at `path` has arrived in full. */
export function isJsonStringComplete(
  partial: PartialJson,
  path: JsonPath,
): boolean {
  if (typeof readJsonPath(partial.value, path) !== "string") return false;
  const open = partial.openStringPath;
  if (!open || open.length !== path.length) return true;
  return !open.every((segment, i) => segment === path[i]);
}
