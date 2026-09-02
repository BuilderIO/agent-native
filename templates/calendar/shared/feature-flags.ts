import { defineFeatureFlag } from "@agent-native/core/feature-flags/registry";

export const SHARED_GOOGLE_CALENDARS = defineFeatureFlag({
  key: "shared-google-calendars",
  displayName: "Shared Google calendars",
  description:
    "Display non-primary calendars available through connected Google accounts.",
});
