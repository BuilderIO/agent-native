import { useEffect, useState } from "react";

export function useRestoreFocusOnUnmount(): void {
  const [opener] = useState(() =>
    typeof document === "undefined" ? null : document.activeElement,
  );
  useEffect(
    () => () => {
      if (!(opener instanceof HTMLElement) || !opener.isConnected) return;
      const active = document.activeElement;
      if (active === null || active === document.body) opener.focus();
    },
    [opener],
  );
}
