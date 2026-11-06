import { useCallback, useState } from "react";

import type {
  ExperienceProfile,
  ExperienceProfileState,
} from "../experience-profiles/index.js";
import { useActionMutation, useActionQuery } from "./use-action.js";

export function useExperienceProfile() {
  const query = useActionQuery<ExperienceProfileState>(
    "get-experience-profile" as never,
    undefined,
    { retry: false },
  );
  const mutation = useActionMutation<
    ExperienceProfileState,
    { profile: ExperienceProfile }
  >("set-experience-profile" as never);
  const [saving, setSaving] = useState(false);
  const setProfile = useCallback(
    async (profile: ExperienceProfile) => {
      setSaving(true);
      try {
        const result = await mutation.mutateAsync({ profile });
        await query.refetch();
        return result;
      } finally {
        setSaving(false);
      }
    },
    [mutation.mutateAsync, query.refetch],
  );
  return { ...query, setProfile, saving, mutationError: mutation.error };
}
