import { useT } from "@agent-native/core/client/i18n";
import { IconSettings } from "@tabler/icons-react";

export default function DesktopAiSetupCard({
  onOpenSettings,
  statusUnavailable = false,
}: {
  onOpenSettings: () => void;
  statusUnavailable?: boolean;
}) {
  const t = useT();

  return (
    <section className="w-full rounded-lg border border-border/80 bg-background/90 p-3 shadow-sm">
      <h3 className="text-sm font-medium text-foreground">
        {t("setup.connectAi")}
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {statusUnavailable
          ? t("setup.providerStatusUnavailable")
          : t("setup.builderOrOwnKeys")}
      </p>
      <button
        type="button"
        className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-accent"
        onClick={onOpenSettings}
      >
        <IconSettings size={13} aria-hidden="true" />
        {t("common.settings")}
      </button>
    </section>
  );
}
