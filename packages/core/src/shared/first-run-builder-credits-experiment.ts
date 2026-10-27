export const FIRST_RUN_BUILDER_CREDITS_V2_EXPERIMENT_ID =
  "first_run_builder_credits_v2";

export const FIRST_RUN_BUILDER_CREDITS_V2_VARIANTS = [
  "control",
  "credits",
] as const;

export type FirstRunBuilderCreditsV2Variant =
  (typeof FIRST_RUN_BUILDER_CREDITS_V2_VARIANTS)[number];

export interface FirstRunBuilderCreditsV2Assignment {
  experiment_id: typeof FIRST_RUN_BUILDER_CREDITS_V2_EXPERIMENT_ID;
  experiment_variant: FirstRunBuilderCreditsV2Variant;
}

export interface FirstRunBuilderCreditsV2RequestAssignment extends FirstRunBuilderCreditsV2Assignment {
  authUserId: string;
}

/** A stable, account-scoped arm that is the same in the browser and on server events. */
export function assignFirstRunBuilderCreditsV2(
  authUserId: string | null | undefined,
): FirstRunBuilderCreditsV2Assignment | null {
  const userId = authUserId?.trim();
  if (!userId) return null;

  const input = `${FIRST_RUN_BUILDER_CREDITS_V2_EXPERIMENT_ID}:${userId}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return {
    experiment_id: FIRST_RUN_BUILDER_CREDITS_V2_EXPERIMENT_ID,
    experiment_variant: (hash >>> 0) % 2 === 0 ? "control" : "credits",
  };
}
