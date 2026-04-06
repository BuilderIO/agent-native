import { useEffect, useRef, useCallback } from "react";
import { apiFetch } from "@/lib/api";

interface NavigationState {
  view: string;
  path: string;
  date?: string;
}

export function useNavigationSync(state: NavigationState) {
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      apiFetch("/_agent-native/application-state/navigation", {
        method: "PUT",
        body: JSON.stringify(state),
      }).catch(() => {});
    }, 500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [state.view, state.path, state.date]);
}
