import { defineLab } from "@agent-native/core/labs/registry";

export const ANALYTICS_SESSIONS_TRIAGE_LAB = defineLab({
  key: "analytics.sessions-triage",
  displayName: "Sessions triage",
  description:
    "Filter sessions by tracked events and speed, see app events and page vitals on replay timelines, and browse the event catalog and route performance.",
  keywords:
    "sessions replays events filters timeline catalog triage performance speed web vitals",
});
