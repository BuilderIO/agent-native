import { getAppStatus } from "@agent-native/core/shared";

export function AppStatusBadge({ appId }: { appId: string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-[var(--b-radius-sm)] border border-solid border-[var(--b-border-default)] bg-[var(--b-bg-raised)] px-[5px] py-px font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-1)] font-semibold uppercase tracking-[0.08em] text-[var(--b-text-secondary)]">
      {getAppStatus(appId)}
    </span>
  );
}
