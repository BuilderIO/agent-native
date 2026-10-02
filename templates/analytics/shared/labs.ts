import { defineLab } from "@agent-native/core/labs/registry";

export const ANALYTICS_SESSIONS_TRIAGE_LAB = defineLab({
  key: "analytics.sessions-triage",
  displayName: "Sessions triage",
  description:
    "Filter sessions by tracked events and friction signals, see app events on replay timelines, and browse the event catalog.",
  keywords:
    "sessions replays events filters timeline catalog triage friction signals",
});
