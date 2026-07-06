import { useT } from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import { IconFileUnknown } from "@tabler/icons-react";
import { Link } from "react-router";

export default function NotFound() {
  const t = useT();

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-4">
      <div className="bg-destructive/10 p-4 rounded-full">
        <IconFileUnknown className="h-8 w-8 text-destructive" />
      </div>
      <h2 className="text-2xl font-bold tracking-tight">
        {t("common.pageNotFound")}
      </h2>
      <p className="text-muted-foreground max-w-sm">
        {t("common.pageNotFoundDescription")}
      </p>
      <Link to="/">
        <Button variant="default">{t("common.returnToDashboard")}</Button>
      </Link>
    </div>
  );
}
