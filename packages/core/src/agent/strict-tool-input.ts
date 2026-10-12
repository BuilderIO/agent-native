/**
 * Validators for action entries that must receive their arguments exactly as
 * the model sent them. The agent loop normally repairs model input (filling
 * placeholders, parsing stringified JSON, coercing types) before validating;
 * an entry registered here skips that repair and is validated with its own
 * validator instead, which returns an error message or null.
 */
const strictToolInputValidators = new WeakMap<
  object,
  (input: unknown) => string | null
>();

export function registerStrictToolInput(
  entry: object,
  validate: (input: unknown) => string | null,
): void {
  strictToolInputValidators.set(entry, validate);
}

export function getStrictToolInputValidator(
  entry: object | undefined,
): ((input: unknown) => string | null) | undefined {
  return entry ? strictToolInputValidators.get(entry) : undefined;
}
