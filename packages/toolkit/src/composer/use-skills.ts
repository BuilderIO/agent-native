import { useState, useEffect, useRef } from "react";

import { useComposerRuntimeAdapters } from "./runtime-adapters.js";
import type { SkillResult } from "./types.js";

export function useSkills(enabled: boolean) {
  const { resolvePath = (path) => path } = useComposerRuntimeAdapters();
  const [skills, setSkills] = useState<SkillResult[]>([]);
  const [hint, setHint] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    setIsLoading(true);
    const id = ++requestIdRef.current;

    fetch(resolvePath("/_agent-native/agent-chat/skills"))
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => {
        if (id === requestIdRef.current) {
          setSkills(data.skills || []);
          setHint(data.hint);
        }
      })
      .catch(() => {
        if (id === requestIdRef.current) {
          setSkills([]);
        }
      })
      .finally(() => {
        if (id === requestIdRef.current) {
          setIsLoading(false);
        }
      });
  }, [enabled, resolvePath]);

  return { skills, hint, isLoading };
}
