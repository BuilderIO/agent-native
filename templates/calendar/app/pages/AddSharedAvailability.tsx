import { useT } from "@agent-native/core/client/i18n";
import { IconCalendarCheck, IconArrowLeft } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  useAddOverlayPerson,
  useOverlayPeople,
} from "@/hooks/use-overlay-people";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function BackToCalendarLink({ t }: { t: ReturnType<typeof useT> }) {
  return (
    <Link
      to="/home"
      className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
    >
      <IconArrowLeft className="w-4 h-4" />
      {t("notFound.backToCalendar")}
    </Link>
  );
}

export default function AddSharedAvailability() {
  const t = useT();
  const [searchParams] = useSearchParams();
  const rawEmail = searchParams.get("email") ?? "";
  const email = EMAIL_REGEX.test(rawEmail) ? rawEmail.toLowerCase() : null;

  const {
    data: overlayPeople,
    isLoading,
    isError: overlayPeopleFailed,
  } = useOverlayPeople();
  const addPerson = useAddOverlayPerson();
  const [justAdded, setJustAdded] = useState(false);

  const alreadyAdded = useMemo(
    () =>
      !!email &&
      (overlayPeople ?? []).some((p) => p.email.toLowerCase() === email),
    [overlayPeople, email],
  );

  return (
    <div className="flex min-h-full w-full items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm text-center">
        {!email ? (
          <>
            <p className="text-sm text-muted-foreground mb-6">
              {t("bookingLinks.overlayRequestPageInvalidLink")}
            </p>
            <BackToCalendarLink t={t} />
          </>
        ) : (
          <>
            <IconCalendarCheck className="w-10 h-10 text-primary mx-auto mb-4" />
            <h1 className="text-xl font-semibold tracking-tight mb-2">
              {t("bookingLinks.overlayRequestPageTitle", { email })}
            </h1>
            <p className="text-sm text-muted-foreground mb-6">
              {t(
                justAdded
                  ? "bookingLinks.overlayRequestPageAdded"
                  : alreadyAdded
                    ? "bookingLinks.overlayRequestPageAlreadyAdded"
                    : "bookingLinks.overlayRequestPageDescription",
                { email },
              )}
            </p>

            {justAdded || alreadyAdded ? (
              <BackToCalendarLink t={t} />
            ) : (
              <div className="flex items-center justify-center gap-4">
                <Button
                  onClick={() =>
                    addPerson.mutate(
                      { email },
                      {
                        onSuccess: () => setJustAdded(true),
                        onError: () =>
                          toast.error(
                            t("bookingLinks.overlayRequestPageAddFailed", {
                              email,
                            }),
                          ),
                      },
                    )
                  }
                  disabled={
                    addPerson.isPending || isLoading || overlayPeopleFailed
                  }
                >
                  {t("bookingLinks.addHostToMyCalendar")}
                </Button>
                <Link
                  to="/home"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t("bookingLinks.overlayRequestPageDismiss")}
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
