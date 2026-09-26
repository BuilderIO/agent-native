import { useT } from "@agent-native/core/client/i18n";
import { SettingsRow } from "@agent-native/core/client/settings";

import { Button } from "@/components/ui/button";

/** Stands in for a group's rows when their read failed, so it never reads as empty. */
export function LoadFailedRow({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <SettingsRow
      label={t("clipsSettings.loadFailed")}
      control={
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {t("libraryGrid.retry")}
        </Button>
      }
    />
  );
}
