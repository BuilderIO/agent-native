import { useEffect, useRef, useState } from "react";

/**
 * Local editable state that stays reconciled with an authoritative external
 * value (server/agent writes). Unlike a bare `useState(externalValue)`, this
 * re-adopts the external value whenever it changes — EXCEPT while the user is
 * actively editing the field (`active: true`), so live agent/other-user edits
 * appear without clobbering in-progress typing.
 *
 * Use for any "copy a server value into local edit state" surface (inline
 * editors, form fields, settings) so agent mutations show up live.
 */
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
    // Adopt the new authoritative value unless the user is mid-edit.
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
