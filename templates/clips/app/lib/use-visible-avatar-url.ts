import { useAvatarUrl } from "@agent-native/core/client/hooks";
import { useEffect, useRef, useState } from "react";

export function useVisibleAvatarUrl(email: string | null | undefined) {
  const avatarRef = useRef<HTMLSpanElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!email) return;

    const element = avatarRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setIsVisible(true);
        observer.disconnect();
      },
      { rootMargin: "48px" },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [email]);

  return {
    avatarRef,
    avatarUrl: useAvatarUrl(isVisible ? email : null),
  };
}
