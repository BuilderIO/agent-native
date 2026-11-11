/**
 * Names that never overwrite: the half a browser can import. A name that
 * addresses something (a filename, a slug, a path) is picked free with
 * {@link nextFreeName}, and a write onto a taken one fails with one typed
 * refusal carrying a free suggestion, which {@link isNameTaken} recognizes.
 * The server half is `@agent-native/core/free-name/server`.
 */

export const NAME_TAKEN_ERROR_CODE = "name_taken";

export interface NameTakenDetails {
  /** The name that was asked for. */
  name: string;
  /** A free name to use instead. */
  suggestion: string;
}

function splitExtension(name: string): { stem: string; extension: string } {
  const dot = name.lastIndexOf(".");
  // A leading dot (".env") is part of the name, not an extension.
  return dot > 0
    ? { stem: name.slice(0, dot), extension: name.slice(dot) }
    : { stem: name, extension: "" };
}

/**
 * The preferred name if it's free, otherwise the first free one of
 * "stem-2.ext", "stem-3.ext", and so on. Picking is not claiming: two writers
 * can pick the same name at once, so the write that claims it must still be
 * refused, or retried, when the name was taken in between.
 */
export function nextFreeName(
  preferred: string,
  taken: ReadonlySet<string> | ((name: string) => boolean),
): string {
  const isTaken =
    typeof taken === "function" ? taken : (name: string) => taken.has(name);
  if (!isTaken(preferred)) return preferred;
  const { stem, extension } = splitExtension(preferred);
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${stem}-${suffix}${extension}`;
    if (!isTaken(candidate)) return candidate;
  }
}

/**
 * Whether `name` is `preferred` or one of the names {@link nextFreeName}
 * would pick for it, such as "home-3.html" for "home.html".
 */
export function isFreeNameFor(name: string, preferred: string): boolean {
  if (name === preferred) return true;
  const { stem, extension } = splitExtension(preferred);
  if (!name.startsWith(`${stem}-`) || !name.endsWith(extension)) return false;
  const suffix = name.slice(stem.length + 1, name.length - extension.length);
  return /^[1-9]\d*$/.test(suffix) && Number(suffix) >= 2;
}

/**
 * True for the refusal `nameTaken()` throws, however it reached this side: the
 * action route, `useAction`, or an app's own fetch that kept `errorCode` and
 * `details`.
 */
export function isNameTaken(error: unknown): error is Error & {
  errorCode: typeof NAME_TAKEN_ERROR_CODE;
  details: NameTakenDetails;
} {
  if (!error || typeof error !== "object") return false;
  const { errorCode, details } = error as {
    errorCode?: unknown;
    details?: unknown;
  };
  if (errorCode !== NAME_TAKEN_ERROR_CODE) return false;
  if (!details || typeof details !== "object") return false;
  const { name, suggestion } = details as {
    name?: unknown;
    suggestion?: unknown;
  };
  return typeof name === "string" && typeof suggestion === "string";
}
