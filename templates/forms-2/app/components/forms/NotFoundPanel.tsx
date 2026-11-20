import { useT } from "@agent-native/core/client/i18n";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";

export function NotFoundPanel({ what }: { what: string }) {
  const t = useT();
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-24 text-center">
      <h2 className="text-lg font-bold">{t("forms.blocks.notFoundTitle")}</h2>
      <p className="text-sm text-muted-foreground">
        {t("forms.blocks.notFoundBody", { what })}
      </p>
      <Button asChild variant="ghost">
        <Link to="/">{t("forms.blocks.backToHome")}</Link>
      </Button>
    </div>
  );
}

export function ErrorPanel({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-[7px] border border-border p-4"
    >
      <p className="text-sm font-semibold">{t("forms.blocks.errorTitle")}</p>
      <p className="text-sm text-muted-foreground">
        {t("forms.blocks.errorBody")}
      </p>
      <Button variant="ghost" size="sm" onClick={onRetry}>
        {t("forms.blocks.retry")}
      </Button>
    </div>
  );
}
