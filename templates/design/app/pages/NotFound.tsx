import {
  buildSignInReturnHref,
  useSession,
  useT,
} from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import { IconArrowLeft, IconLogin2 } from "@tabler/icons-react";
import { Link } from "react-router";

export default function NotFound() {
  const t = useT();
  const { session, isLoading } = useSession();
  const showSignIn = !isLoading && !session?.email;

  return (
    <div className="flex min-h-full w-full flex-col items-center justify-center bg-background px-4 py-12">
      <h1 className="text-6xl font-bold text-muted-foreground/60 mb-4">404</h1>
      <p className="text-sm text-muted-foreground mb-6">
        {t("pages.notFoundDescription")}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {showSignIn && (
          <Button asChild className="cursor-pointer">
            <a href={buildSignInReturnHref()}>
              <IconLogin2 className="size-4" />
              {t("pages.notFoundSignIn")}
            </a>
          </Button>
        )}
        <Button asChild variant="outline" className="cursor-pointer">
          <Link to="/">
            <IconArrowLeft className="size-4 rtl:-scale-x-100" />
            {t("pages.notFoundBackToDesigns")}
          </Link>
        </Button>
      </div>
    </div>
  );
}
