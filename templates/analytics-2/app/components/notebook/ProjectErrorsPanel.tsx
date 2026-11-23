import { useT } from "@agent-native/core/client/i18n";
import { IconAlertTriangle } from "@tabler/icons-react";

export function ProjectErrorsPanel({
  failedCount,
  onRerun,
}: {
  failedCount: number;
  onRerun: () => void;
}) {
  const t = useT();
  if (failedCount === 0) return null;
  return (
    <div className="nb-cell-error" role="status" data-project-errors>
      <IconAlertTriangle aria-hidden="true" size={16} />
      <div className="nb-cell-error-body">
        <p className="font-medium">{t("publishedApp.projectErrors")}</p>
        <p>{t("publishedApp.projectErrorsDetail")}</p>
      </div>
      <button type="button" className="nb-button" onClick={onRerun}>
        {t("publishedApp.rerunApp")}
      </button>
    </div>
  );
}
