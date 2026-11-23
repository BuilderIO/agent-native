import { createSetExperienceProfileAction } from "@agent-native/core/experience-profiles/server";

import { experienceProfileOptions } from "../server/experience-profile.js";

export default {
  ...createSetExperienceProfileAction(experienceProfileOptions),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
};
