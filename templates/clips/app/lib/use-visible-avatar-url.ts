import { useAvatarUrl } from "@agent-native/core/client/hooks";
import { useEffect, useRef, useState } from "react";

export function useVisibleAvatarUrl(email: string | null | undefined) {
  const avatarRef = useRef<HTMLSpanElement>(null);
  const [visibleEmail, setVisibleEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!email) return;

    const element = avatarRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setVisibleEmail(email);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisibleEmail(email);
        observer.disconnect();
      },
      { rootMargin: "48px" },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [email]);

  return {
    avatarRef,
    avatarUrl: useAvatarUrl(visibleEmail === email ? email : null),
  };
}
