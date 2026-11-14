import { defineAction } from "@agent-native/core/action";
import {
  getOnboardingStepStatuses,
  readOnboardingDismissed,
} from "@agent-native/core/onboarding/status";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { z } from "zod";

import {
  GETTING_STARTED_CHECKLIST,
  registerGettingStartedSteps,
} from "../server/lib/getting-started.js";

export default defineAction({
  description:
    "Read the user's Getting started checklist: each step with whether the user has completed it and the in-app path that completes it. Use it to tell the user what is left or what to do next.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      throw Object.assign(new Error("Not authenticated"), { statusCode: 401 });
    }
    registerGettingStartedSteps();
    const context = {
      sessionId: userEmail,
      userEmail,
      orgId: getRequestOrgId() ?? null,
    };
    const [steps, dismissed] = await Promise.all([
      getOnboardingStepStatuses(context, {
        checklist: GETTING_STARTED_CHECKLIST,
      }),
      readOnboardingDismissed(userEmail, GETTING_STARTED_CHECKLIST),
    ]);
    return {
      dismissed,
      completeCount: steps.filter((step) => step.complete).length,
      totalCount: steps.length,
      steps: steps.map(({ id, title, description, complete, href }) => ({
        id,
        title,
        description,
        complete,
        href,
      })),
    };
  },
});
