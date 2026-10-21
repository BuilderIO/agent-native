import { useT } from "@agent-native/core/client/i18n";
import { GettingStartedCard } from "@agent-native/toolkit/app/onboarding";
import { useMemo } from "react";
import { Link } from "react-router";

const GETTING_STARTED_STEP_KEYS = {
  "create-design": "createDesign",
  "add-brand": "addBrand",
  "use-real-data": "useRealData",
  "share-feedback": "shareFeedback",
  "invite-teammate": "inviteTeammate",
  "save-template": "saveTemplate",
} as const;

export function GettingStarted({ className }: { className?: string }) {
  const t = useT();
  const labels = useMemo(
    () => ({
      title: t("gettingStarted.title"),
      progress: (completeCount: number, totalCount: number) =>
        t("gettingStarted.progress", { completeCount, totalCount }),
      moreOptions: t("gettingStarted.moreOptions"),
      hide: t("gettingStarted.hide"),
      collapse: t("gettingStarted.collapse"),
      expand: t("gettingStarted.expand"),
      completed: t("gettingStarted.completed"),
      loadError: t("gettingStarted.loadError"),
      retry: t("gettingStarted.retry"),
    }),
    [t],
  );
  const stepTitles = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(GETTING_STARTED_STEP_KEYS).map(([id, key]) => [
          id,
          t(`gettingStarted.steps.${key}`),
        ]),
      ),
    [t],
  );

  return (
    <GettingStartedCard
      checklist="getting-started"
      labels={labels}
      stepTitles={stepTitles}
      LinkComponent={Link}
      className={className}
    />
  );
}
