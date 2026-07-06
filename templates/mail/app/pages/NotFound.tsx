import { useT } from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import { IconMail } from "@tabler/icons-react";
import { Link } from "react-router";

export function NotFound() {
  const t = useT();
  return (
    <div className="flex min-h-full w-full items-center justify-center bg-background px-4 py-12">
      <div className="text-center">
        <IconMail className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
        <h1 className="text-2xl font-semibold text-foreground">404</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("notFound.message")}
        </p>
        <Button asChild className="mt-6" size="sm">
          <Link to="/inbox">{t("notFound.goToInbox")}</Link>
        </Button>
      </div>
    </div>
  );
}
