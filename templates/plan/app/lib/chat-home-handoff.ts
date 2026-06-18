import { setAgentSidebarOpenPreference } from "@agent-native/core/client";

const HANDOFF_KEY = "agent-native.plan.chat-home-handoff";
const HANDOFF_TTL_MS = 6 * 60 * 60 * 1000;

export function markPlanChatHomeHandoff() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(HANDOFF_KEY, String(Date.now()));
  } catch {}
  setAgentSidebarOpenPreference(true);
}

export function consumePlanChatHomeHandoff(): boolean {
  if (typeof window === "undefined") return false;
  let startedAt = 0;
  try {
    const raw = window.sessionStorage.getItem(HANDOFF_KEY);
    startedAt = raw ? Number.parseInt(raw, 10) : 0;
    window.sessionStorage.removeItem(HANDOFF_KEY);
  } catch {
    startedAt = 0;
  }

  const active =
    Number.isFinite(startedAt) && Date.now() - startedAt <= HANDOFF_TTL_MS;
  if (active) setAgentSidebarOpenPreference(true);
  return active;
}
