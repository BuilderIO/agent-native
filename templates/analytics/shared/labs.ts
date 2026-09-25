import { defineLab, defineLabs } from "@agent-native/core/labs/registry";

export const ANALYTICS_SESSIONS_TRIAGE_LAB = defineLab({
  key: "analytics.sessions-triage",
  displayName: "Sessions triage",
  description: "Explore session filters and sorting.",
  keywords: "sessions replays filters triage",
});

export const ANALYTICS_LABS = defineLabs([ANALYTICS_SESSIONS_TRIAGE_LAB]);
