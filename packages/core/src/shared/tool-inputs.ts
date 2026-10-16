export function toolInputsMatch(
  callInput: unknown,
  approvalInput: unknown,
): boolean {
  return (
    callInput !== null &&
    approvalInput !== null &&
    typeof callInput === "object" &&
    typeof approvalInput === "object" &&
    !Array.isArray(callInput) &&
    !Array.isArray(approvalInput) &&
    toolInputValuesMatch(callInput, approvalInput)
  );
}

export function toolInputFingerprint(input: unknown): string | undefined {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(input, (_key, value: unknown) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, (value as Record<string, unknown>)[key]]),
        );
      }
      return value;
    });
  } catch (error) {
    if (error instanceof TypeError) return undefined;
    throw error;
  }
  if (serialized === undefined) return undefined;

  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= BigInt(serialized.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

function toolInputValuesMatch(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => toolInputValuesMatch(value, right[index]))
    );
  }
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        toolInputValuesMatch(
          (left as Record<string, unknown>)[key],
          (right as Record<string, unknown>)[key],
        ),
    )
  );
}
