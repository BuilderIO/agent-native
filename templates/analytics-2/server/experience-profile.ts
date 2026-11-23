import type { ActionRunContext } from "@agent-native/core/action";

import { experienceDeviations } from "../shared/experience-deviations.js";

export const experienceProfileOptions = {
  appId: "analytics-2",
  deviations: experienceDeviations,
  // This private workspace serves its reference UI to signed-in QA users by default.
  canUseReference: (ctx: ActionRunContext) => Boolean(ctx.userEmail),
};
