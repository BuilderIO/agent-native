import * as React from "react";

/**
 * A component's value, held by the caller when `value` is set and by the
 * component otherwise, as Base UI's controlled and uncontrolled props work.
 */
export function useControlledValue<T>(
  value: T | undefined,
  defaultValue: T,
  onValueChange: ((next: T) => void) | undefined,
): [T, (next: T) => void] {
  const [own, setOwn] = React.useState(defaultValue);
  const controlled = value !== undefined;
  const current = controlled ? value : own;
  const setValue = React.useCallback(
    (next: T) => {
      if (!controlled) setOwn(next);
      onValueChange?.(next);
    },
    [controlled, onValueChange],
  );
  return [current, setValue];
}
