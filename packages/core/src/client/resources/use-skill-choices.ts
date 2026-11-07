import { useCallback, useMemo, useRef, useState } from "react";

import {
  NO_SKILL_CHOICES,
  skillChoiceKey,
  type SkillChoiceCounts,
  type SkillChoices,
  type SkillMark,
  type SkillSource,
  type SkillSwitch,
} from "../../resources/skill-choice-rules.js";
import { useActionMutation, useActionQuery } from "../use-action.js";
import { useSession } from "../use-session.js";

export {
  isSkillOn,
  skillChoiceKey,
  skillMarkFor,
  SKILL_MARKS,
  type SkillChoiceCount,
  type SkillChoiceCounts,
  type SkillChoices,
  type SkillMark,
  type SkillSource,
  type SkillSwitch,
} from "../../resources/skill-choice-rules.js";

type SkillChoicesAnswer = SkillChoices & { canMark: boolean };

export interface SkillChoicesState {
  /** The viewer's switches and the organization's marks, changes included. */
  choices: SkillChoices;
  /** Whether the viewer is an organization admin who can mark skills. */
  canMark: boolean;
  /** Until the server answers, switches can't save. */
  isLoaded: boolean;
  isError: boolean;
  /** For admins: how many people chose each way. Null until it loads. */
  counts: SkillChoiceCounts | null;
  /** Rejects when the server refused; the switch goes back. */
  setSwitch: (source: SkillSource, path: string, on: boolean) => Promise<void>;
  /** Rejects when the server refused; the mark goes back. */
  setMark: (
    source: Exclude<SkillSource, "personal">,
    path: string,
    mark: SkillMark,
  ) => Promise<void>;
}

/**
 * Each person's skill switches and the organization's marks, for Settings.
 * A change shows at once and stays until the saved answer comes back.
 */
export function useSkillChoices(
  options: { enabled?: boolean } = {},
): SkillChoicesState {
  const { status } = useSession();
  const enabled = (options.enabled ?? true) && status === "authenticated";
  const query = useActionQuery<SkillChoicesAnswer>(
    "get-skill-choices" as never,
    undefined,
    { enabled },
  );
  const canMark = query.data?.canMark === true;
  const countsQuery = useActionQuery<SkillChoiceCounts>(
    "get-skill-choice-counts" as never,
    undefined,
    { enabled: enabled && canMark },
  );
  const saveSwitch = useActionMutation<
    SkillSwitch,
    { source: SkillSource; path: string; on: boolean }
  >("set-skill-switch" as never);
  const saveMark = useActionMutation<
    unknown,
    { source: SkillSource; path: string; mark: SkillMark }
  >("set-skill-mark" as never);
  const { refetch } = query;
  const { refetch: refetchCounts } = countsQuery;
  const { mutateAsync: saveSwitchAsync } = saveSwitch;
  const { mutateAsync: saveMarkAsync } = saveMark;

  const [pendingSwitches, setPendingSwitches] = useState<
    Record<string, SkillSwitch>
  >({});
  const [pendingMarks, setPendingMarks] = useState<Record<string, SkillMark>>(
    {},
  );
  // Only the latest change to a skill clears its pending value.
  const latest = useRef(new Map<string, number>());
  const nextChange = useRef(0);

  const settle = useCallback(
    async <T>(
      key: string,
      setPending: (
        update: (current: Record<string, T>) => Record<string, T>,
      ) => void,
      value: T,
      save: () => Promise<unknown>,
    ) => {
      const change = ++nextChange.current;
      latest.current.set(key, change);
      setPending((current) => ({ ...current, [key]: value }));
      const clear = () => {
        if (latest.current.get(key) !== change) return;
        latest.current.delete(key);
        setPending((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
      };
      try {
        await save();
        // An admin's own switch moves the counts too.
        await Promise.all([refetch(), canMark ? refetchCounts() : null]);
      } finally {
        clear();
      }
    },
    [canMark, refetch, refetchCounts],
  );

  const setSwitch = useCallback(
    (source: SkillSource, path: string, on: boolean) =>
      settle(
        skillChoiceKey(source, path),
        setPendingSwitches,
        { on, at: Date.now() },
        () => saveSwitchAsync({ source, path, on }),
      ),
    [saveSwitchAsync, settle],
  );

  const setMark = useCallback(
    (source: Exclude<SkillSource, "personal">, path: string, mark: SkillMark) =>
      settle(skillChoiceKey(source, path), setPendingMarks, mark, () =>
        saveMarkAsync({ source, path, mark }),
      ),
    [saveMarkAsync, settle],
  );

  const data = query.data;
  const choices = useMemo<SkillChoices>(() => {
    if (!data) return NO_SKILL_CHOICES;
    const marks: Record<string, SkillMark> = { ...data.marks };
    for (const [key, mark] of Object.entries(pendingMarks)) {
      if (mark === "recommended") delete marks[key];
      else marks[key] = mark;
    }
    return { switches: { ...data.switches, ...pendingSwitches }, marks };
  }, [data, pendingMarks, pendingSwitches]);

  return {
    choices,
    canMark,
    isLoaded: data !== undefined,
    isError: query.isError,
    counts: countsQuery.data ?? null,
    setSwitch,
    setMark,
  };
}
