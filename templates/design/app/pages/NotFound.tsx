import { useT } from "@agent-native/core/client";
import { IconArrowLeft } from "@tabler/icons-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  const t = useT();
  return (
    <div className="flex min-h-full w-full flex-col items-center justify-center bg-background px-4 py-12">
      <h1 className="text-6xl font-bold text-muted-foreground/60 mb-4">404</h1>
      <p className="text-sm text-muted-foreground mb-6">
        {t("pages.notFoundDescription")}
      </p>
      <Button asChild variant="outline" className="cursor-pointer">
        <Link to="/">
          <IconArrowLeft className="w-4 h-4 rtl:-scale-x-100" />
          {t("pages.notFoundBackToDesigns")}
        </Link>
      </Button>
    </div>
  );
}
