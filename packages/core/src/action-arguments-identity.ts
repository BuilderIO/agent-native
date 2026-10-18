import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** Prepared arguments holding a value `encodeActionArguments` cannot encode exactly. */
export class UnsupportedActionArgumentError extends Error {
  /** Where the value sits, as `key.nested[0]`; empty for the arguments themselves. */
  readonly path: string;
  /** What the value is: `Map`, `function`, `accessor`, `circular reference`, and so on. */
  readonly kind: string;

  constructor(path: string, kind: string) {
    super(
      `Argument ${path ? `"${path}"` : "(root)"} has no exact encoding (${kind}).`,
    );
    this.name = "UnsupportedActionArgumentError";
    this.path = path;
    this.kind = kind;
  }
}

/** Prepared arguments as a call runs them, and the hash of their exact encoding. */
export interface ActionArgumentsSnapshot {
  /**
   * A deep, frozen, plain-data copy, read once from the prepared value. Hand
   * each consumer `copyActionArguments(value)`, never this: freezing does not
   * stop `setTime` on a Date, so a consumer holding it could change what the
   * next one reads.
   */
  readonly value: unknown;
  /** SHA-256 hex of `encodeActionArguments(value)`. */
  readonly hash: string;
}

/**
 * Copies prepared arguments into the one value a call's gates, identities and
 * handler all copy from, and hashes it in the same pass. Each property is read
 * once from its descriptor, so an accessor, which could answer differently on
 * the next read, is refused rather than sampled. Throws as
 * `encodeActionArguments` does.
 */
export function snapshotActionArguments(
  value: unknown,
): ActionArgumentsSnapshot {
  const { encoding, copy } = walk(value, "", new Set());
  return { value: copy, hash: hashEncoding(encoding) };
}

/**
 * The exact encoding of prepared arguments. Approval grants, replays,
 * recoveries and read reuse bind it, so arguments that would run differently
 * never share one: every value is tagged with its type, plain object keys are
 * sorted, an `undefined` property differs from a missing one, and a Date
 * encodes as its ISO time. Any other value (a Map, a class instance, a
 * function, an accessor, an invalid Date, a cycle) throws
 * `UnsupportedActionArgumentError` rather than encoding approximately.
 */
export function encodeActionArguments(value: unknown): string {
  return walk(value, "", new Set()).encoding;
}

/** SHA-256 hex of `encodeActionArguments`; throws as it does. */
export function actionArgumentsHash(value: unknown): string {
  return hashEncoding(encodeActionArguments(value));
}

/** A mutable deep copy of a snapshot, for one consumer that may change it. */
export function copyActionArguments(snapshot: unknown): unknown {
  if (snapshot === null || typeof snapshot !== "object") return snapshot;
  if (snapshot instanceof Date) return new Date(snapshot.getTime());
  if (Array.isArray(snapshot)) {
    const copy: unknown[] = new Array(snapshot.length);
    snapshot.forEach((item, index) => {
      copy[index] = copyActionArguments(item);
    });
    return copy;
  }
  return Object.fromEntries(
    Object.entries(snapshot).map(([key, item]) => [
      key,
      copyActionArguments(item),
    ]),
  );
}

function hashEncoding(encoding: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(encoding)));
}

interface Walked {
  readonly encoding: string;
  readonly copy: unknown;
}

function walk(value: unknown, path: string, ancestors: Set<object>): Walked {
  switch (typeof value) {
    case "undefined":
      return { encoding: "u", copy: value };
    case "boolean":
      return { encoding: value ? "t" : "f", copy: value };
    case "number":
      return {
        encoding: `n${Object.is(value, -0) ? "-0" : String(value)}`,
        copy: value,
      };
    case "bigint":
      return { encoding: `i${String(value)}`, copy: value };
    case "string":
      return { encoding: `s${JSON.stringify(value)}`, copy: value };
    case "object":
      break;
    default:
      throw new UnsupportedActionArgumentError(path, typeof value);
  }
  if (value === null) return { encoding: "z", copy: null };
  if (ancestors.has(value)) {
    throw new UnsupportedActionArgumentError(path, "circular reference");
  }
  const prototype = Object.getPrototypeOf(value);
  const ownKeys = Reflect.ownKeys(value);
  if (prototype === Date.prototype && ownKeys.length === 0) {
    let time: number;
    try {
      time = Date.prototype.getTime.call(value);
    } catch {
      throw new UnsupportedActionArgumentError(path, "Date-like object");
    }
    if (Number.isNaN(time)) {
      throw new UnsupportedActionArgumentError(path, "invalid Date");
    }
    const copy = new Date(time);
    return { encoding: `d${copy.toISOString()}`, copy: Object.freeze(copy) };
  }
  ancestors.add(value);
  try {
    if (prototype === Array.prototype) {
      const length = descriptorValue(
        Object.getOwnPropertyDescriptor(value, "length"),
        path,
      );
      if (typeof length !== "number") {
        throw new UnsupportedActionArgumentError(path, "array-like object");
      }
      const copy: unknown[] = new Array(length);
      const encoded: string[] = [];
      let present = 0;
      for (let index = 0; index < length; index++) {
        if (!Object.hasOwn(value, index)) {
          encoded.push("_");
          continue;
        }
        present++;
        const itemPath = `${path}[${index}]`;
        const item = walk(
          descriptorValue(
            Object.getOwnPropertyDescriptor(value, index),
            itemPath,
          ),
          itemPath,
          ancestors,
        );
        encoded.push(item.encoding);
        copy[index] = item.copy;
      }
      // Indices and `length` only: any other property would go unencoded.
      if (ownKeys.length !== present + 1) {
        throw new UnsupportedActionArgumentError(path, "array with properties");
      }
      return {
        encoding: `a[${encoded.join(",")}]`,
        copy: Object.freeze(copy),
      };
    }
    if (prototype === Object.prototype || prototype === null) {
      const entries: Array<[string, Walked]> = [];
      for (const key of ownKeys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        // Symbol and non-enumerable keys would go unencoded.
        if (typeof key === "symbol" || !descriptor?.enumerable) {
          throw new UnsupportedActionArgumentError(
            path,
            "object with hidden keys",
          );
        }
        const keyPath = path ? `${path}.${key}` : key;
        entries.push([
          key,
          walk(descriptorValue(descriptor, keyPath), keyPath, ancestors),
        ]);
      }
      // Only the encoding sorts keys. The copy keeps the arguments' order,
      // which the handler sees in a spread or `JSON.stringify`.
      const copy = Object.freeze(
        Object.fromEntries(entries.map(([key, item]) => [key, item.copy])),
      );
      entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return {
        encoding: `o{${entries
          .map(([key, item]) => `${JSON.stringify(key)}:${item.encoding}`)
          .join(",")}}`,
        copy,
      };
    }
  } finally {
    ancestors.delete(value);
  }
  const name: unknown = prototype?.constructor?.name;
  throw new UnsupportedActionArgumentError(
    path,
    typeof name === "string" && name ? name : "object",
  );
}

/** An own data property's value; an accessor is refused unread. */
function descriptorValue(
  descriptor: PropertyDescriptor | undefined,
  path: string,
): unknown {
  if (!descriptor || !("value" in descriptor)) {
    throw new UnsupportedActionArgumentError(path, "accessor");
  }
  return descriptor.value;
}
