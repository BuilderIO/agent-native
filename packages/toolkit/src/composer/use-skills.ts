import { useState, useEffect, useRef } from "react";

import { useComposerRuntimeAdapters } from "./runtime-adapters.js";
import type { SkillResult } from "./types.js";

function isSkillResult(skill: unknown): skill is SkillResult {
  if (!skill || typeof skill !== "object") return false;
  const candidate = skill as Record<string, unknown>;
  return (
    typeof candidate.name === "string" &&
    typeof candidate.path === "string" &&
    (candidate.source === "codebase" || candidate.source === "resource") &&
    (candidate.description === undefined ||
      typeof candidate.description === "string")
  );
}

function parseSkillResponse(value: unknown): {
  skills: SkillResult[];
  hint?: string;
} {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid skills response");
  }
  const response = value as { skills?: unknown; hint?: unknown };
  if (
    !Array.isArray(response.skills) ||
    !response.skills.every(isSkillResult) ||
    (response.hint !== undefined && typeof response.hint !== "string")
  ) {
    throw new Error("Invalid skills response");
  }
  return {
    skills: response.skills,
    ...(response.hint !== undefined ? { hint: response.hint } : {}),
  };
}

export function useSkills(enabled: boolean) {
  const {
    resolvePath = (path) => path,
    translate = (_key, options) =>
      typeof options?.defaultValue === "string" ? options.defaultValue : _key,
  } = useComposerRuntimeAdapters();
  const [skills, setSkills] = useState<SkillResult[]>([]);
  const [hint, setHint] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const requestIdRef = useRef(0);
  const translateRef = useRef(translate);
  translateRef.current = translate;

  useEffect(() => {
    if (!enabled) {
      setSkills([]);
      setIsLoading(false);
      setHint(undefined);
      return;
    }

    setIsLoading(true);
    setSkills([]);
    setHint(undefined);
    const id = ++requestIdRef.current;
    const abort = new AbortController();

    fetch(resolvePath("/_agent-native/agent-chat/skills"), {
      signal: abort.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then(parseSkillResponse)
      .then((data) => {
        if (id === requestIdRef.current) {
          setSkills(data.skills);
          setHint(data.hint);
        }
      })
      .catch(() => {
        if (id === requestIdRef.current) {
          setSkills([]);
          setHint(
            translateRef.current("agentChat.mentions.skillsLoadFailed", {
              defaultValue:
                "Couldn't load skills. Close and reopen the menu to try again.",
            }),
          );
        }
      })
      .finally(() => {
        if (id === requestIdRef.current) {
          setIsLoading(false);
        }
      });
    return () => {
      if (requestIdRef.current === id) requestIdRef.current++;
      abort.abort();
    };
  }, [enabled, resolvePath]);

  return { skills, hint, isLoading };
}
