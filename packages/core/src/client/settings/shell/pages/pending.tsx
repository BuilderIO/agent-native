import { useT } from "../../../i18n.js";

/** A page whose content has no home in today's Settings yet. */
export function PendingSettingsPage() {
  const t = useT();
  return (
    <p className="py-10 text-center text-sm text-muted-foreground">
      {t("agentChat.settingsShell.pagePending")}
    </p>
  );
}
