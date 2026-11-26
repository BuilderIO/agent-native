import type { AriaAttributes } from "react";

export type AccessibleName = Pick<
  AriaAttributes,
  "aria-label" | "aria-labelledby"
>;

export function inheritedName(
  shared: AccessibleName | undefined,
  local: AccessibleName,
) {
  return local["aria-label"] === undefined &&
    local["aria-labelledby"] === undefined
    ? shared
    : undefined;
}
