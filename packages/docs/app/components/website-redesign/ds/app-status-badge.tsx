import { getAppStatus, type AppStatus } from "@agent-native/core/shared";

// The brand --b-* tokens only resolve inside .builder-brand-tokens (header,
// footer, homepage); app landing pages carry the docs --fg/--bg pair instead.
// Both flip with the theme, so the fallback keeps one inverse pill everywhere.
const PILL_CLASS = [
  "inline-flex shrink-0 items-center rounded-full px-2 py-[3px]",
  "font-[family-name:var(--b-font-sans)] text-[10px] font-semibold uppercase leading-none tracking-[0.08em]",
  "bg-[var(--b-text-primary,var(--fg))] text-[var(--b-bg-page,var(--bg))]",
].join(" ");

export function AppStatusBadge({
  appId,
  status,
}: {
  appId?: string;
  status?: AppStatus;
}) {
  return <span className={PILL_CLASS}>{status ?? getAppStatus(appId)}</span>;
}
