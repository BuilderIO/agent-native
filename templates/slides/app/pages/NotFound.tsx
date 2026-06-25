import { useT } from "@agent-native/core/client";
import { IconArrowLeft } from "@tabler/icons-react";
import { useEffect } from "react";
import { Link, useLocation } from "react-router";

export default function NotFound() {
  const t = useT();
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-0 w-full flex-1 items-center justify-center bg-background px-4 py-12">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-muted-foreground/40 mb-2">
          404
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          {t("notFound.message")}
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent text-sm text-foreground/70 transition-colors"
        >
          <IconArrowLeft className="w-4 h-4" />
          {t("notFound.backToDecks")}
        </Link>
      </div>
    </div>
  );
}
