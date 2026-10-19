import { defineAction, fail } from "@agent-native/core/action";
import { getUserProfile } from "@agent-native/core/user-profile/server";
import {
  getOnboardingRoleCategory,
  type OnboardingRoleCategory,
} from "@agent-native/core/user-profile/shared";
import { z } from "zod";

const HOME_SUGGESTION_IDS = ["pitch", "roadmap", "explainer"] as const;

type HomeSuggestionId = (typeof HOME_SUGGESTION_IDS)[number];

const SUGGESTION_ORDER_BY_ROLE: Record<
  OnboardingRoleCategory,
  readonly HomeSuggestionId[]
> = {
  product: ["roadmap", "pitch", "explainer"],
  design: ["explainer", "pitch", "roadmap"],
  developer: ["explainer", "roadmap", "pitch"],
  marketing: ["pitch", "explainer", "roadmap"],
  sales: ["pitch", "roadmap", "explainer"],
  ops: ["roadmap", "explainer", "pitch"],
  individual: ["explainer", "roadmap", "pitch"],
  other: ["pitch", "roadmap", "explainer"],
};

export default defineAction({
  description:
    "Prioritize the Slides-2 home's existing static prompt suggestions from the signed-in user's onboarding role. The suggestions stay localized in the UI; this action does not generate text.",
  agentTool: false,
  schema: z.object({}),
  readOnly: true,
  http: { method: "GET" },
  run: async (_args, ctx) => {
    if (!ctx?.userEmail) {
      fail("Not authenticated.", {
        statusCode: 401,
        errorCode: "unauthorized",
      });
    }

    const profile = await getUserProfile(ctx.userEmail);
    const role = profile.onboardingRole
      ? getOnboardingRoleCategory(profile.onboardingRole)
      : "other";

    return {
      status: "ready" as const,
      suggestionIds: [...SUGGESTION_ORDER_BY_ROLE[role]],
    };
  },
});
