import { useEffect, useRef, useState } from "react";

export function useReconciledState<T>(
  externalValue: T,
  options: { active?: boolean; equals?: (a: T, b: T) => boolean } = {},
): [T, React.Dispatch<React.SetStateAction<T>>, { external: T }] {
  const { active = false, equals } = options;
  const eq = equals ?? Object.is;
  const [local, setLocal] = useState<T>(externalValue);
  const prevExternalRef = useRef<T>(externalValue);
  const skippedExternalRef = useRef(false);

  useEffect(() => {
    const externalChanged = !eq(prevExternalRef.current, externalValue);
    if (externalChanged) {
      prevExternalRef.current = externalValue;
    }
    if (active) {
      if (externalChanged) skippedExternalRef.current = true;
      return;
    }
    if (externalChanged || skippedExternalRef.current) {
      skippedExternalRef.current = false;
      setLocal(externalValue);
    }
  }, [externalValue, active]); // eslint-disable-line react-hooks/exhaustive-deps

  return [local, setLocal, { external: externalValue }];
}
