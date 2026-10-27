/**
 * Validators for action entries that must receive their arguments exactly as
 * the model sent them. The agent loop normally repairs model input (filling
 * placeholders, parsing stringified JSON, coercing types) before validating;
 * an entry registered here skips that repair and is validated with its own
 * validator instead, which returns an error message or null.
 *
 * The validator lives on the entry under a symbol rather than in a side table:
 * registries copy entries with object spread as they filter them, and spread
 * keeps own symbol properties, so the copy reaching the loop stays strict.
 */
const STRICT_TOOL_INPUT = Symbol("agent-native.strictToolInput");

type StrictToolInputValidator = (input: unknown) => string | null;

export function registerStrictToolInput(
  entry: object,
  validate: StrictToolInputValidator,
): void {
  Object.defineProperty(entry, STRICT_TOOL_INPUT, {
    value: validate,
    enumerable: true,
  });
}

export function getStrictToolInputValidator(
  entry: object | undefined,
): StrictToolInputValidator | undefined {
  const validate = entry
    ? (entry as { [STRICT_TOOL_INPUT]?: unknown })[STRICT_TOOL_INPUT]
    : undefined;
  return typeof validate === "function"
    ? (validate as StrictToolInputValidator)
    : undefined;
}
