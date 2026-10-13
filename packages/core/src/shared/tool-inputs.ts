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
