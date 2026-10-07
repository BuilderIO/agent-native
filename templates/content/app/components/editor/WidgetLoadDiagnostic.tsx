import { useT } from "@agent-native/core/client/i18n";
import { useEffect, useState } from "react";

export function WidgetLoadDiagnostic({
  active,
  stage,
  action,
}: {
  active: boolean;
  stage: string;
  action: string;
}) {
  const t = useT();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(false);
    if (!active) return;
    const timeout = window.setTimeout(() => setVisible(true), 8_000);
    return () => window.clearTimeout(timeout);
  }, [active, action, stage]);

  if (!visible) return null;
  return (
    <p
      aria-live="polite"
      className="rounded-md border border-border bg-background/95 p-3 text-sm text-muted-foreground shadow-md"
      role="status"
    >
      {t("editor.widgetLoadStalled", { stage, action })}
    </p>
  );
}
