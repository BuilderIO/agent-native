import { useT } from "@agent-native/core/client/i18n";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function Frame({
  children,
  preview = false,
}: {
  children: ReactNode;
  preview?: boolean;
}) {
  return (
    <main
      className={cn(
        "forms-root mx-auto w-full max-w-[var(--fs-page-width,700px)] px-4 pb-40 min-[760px]:px-0",
        preview ? "pt-10" : "pt-[151px]",
      )}
    >
      {children}
    </main>
  );
}

function Message({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <>
      <h1 className="text-[28px] font-extrabold">{title}</h1>
      {children}
    </>
  );
}

export function ClosedState({
  message,
  preview,
}: {
  message?: string | null | undefined;
  preview?: boolean;
}) {
  const t = useT();
  return (
    <Frame preview={preview ?? false}>
      <Message title={t("forms.respond.closedTitle")}>
        <p className="mt-2 text-base text-muted-foreground">
          {message ?? t("forms.respond.closedDefault")}
        </p>
      </Message>
    </Frame>
  );
}

export function DuplicateState() {
  const t = useT();
  return (
    <Frame>
      <Message title={t("forms.collection.duplicateTitle")}>
        <p className="mt-2 text-base text-muted-foreground">
          {t("forms.collection.duplicateBody")}
        </p>
      </Message>
    </Frame>
  );
}

/**
 * A link that answers "unavailable": a draft, a deleted form and a wrong id all
 * come back the same on purpose, so the page must not guess which one it is.
 * Someone signed out is not being told the link is broken - they are being
 * offered the way into the app, which is where a responder or the author of a
 * draft belongs.
 */
export function UnavailableState({ signedIn = false }: { signedIn?: boolean }) {
  const t = useT();
  if (!signedIn)
    return (
      <Frame>
        <Message title={t("forms.respond.signInTitle")}>
          <p className="mt-2 text-base text-muted-foreground">
            {t("forms.respond.signInBody")}
          </p>
          <Link
            to="/"
            className="forms-button mt-5 inline-flex h-9 items-center rounded-[var(--fs-button-radius)] bg-[var(--fs-button-bg)] px-[13.5px] text-[15px] font-semibold text-[var(--fs-button-text)]"
          >
            {t("forms.respond.signInAction")}
          </Link>
        </Message>
      </Frame>
    );
  return (
    <Frame>
      <Message title={t("forms.respond.notFoundTitle")}>
        <p className="mt-2 text-base text-muted-foreground">
          {t("forms.respond.notFoundBody")}
        </p>
      </Message>
    </Frame>
  );
}

export function LoadErrorState({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <Frame>
      <Message title={t("forms.respond.loadErrorTitle")}>
        <p className="mt-2 text-base text-muted-foreground">
          {t("forms.respond.loadErrorBody")}
        </p>
        <Button className="mt-4" variant="ghost" onClick={onRetry}>
          {t("forms.respond.retry")}
        </Button>
      </Message>
    </Frame>
  );
}

export function FormSkeleton() {
  const t = useT();
  return (
    <Frame>
      <div
        role="status"
        aria-label={t("forms.respond.loadingForm")}
        className="flex flex-col gap-8"
      >
        <Skeleton className="h-12 w-96" />
        {[0, 1, 2].map((key) => (
          <div key={key} className="flex flex-col gap-3">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-9 w-80" />
          </div>
        ))}
      </div>
    </Frame>
  );
}
