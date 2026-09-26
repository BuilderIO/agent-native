import { Skeleton } from "@agent-native/toolkit/design-system";
import { Button } from "@agent-native/toolkit/ui/button";
import type { ReactNode } from "react";

import type { OrgInfo } from "../../../org/types.js";
import { useT } from "../../i18n.js";
import { useOrg } from "../hooks.js";
import {
  JoinByDomainCard,
  NoOrgCard,
  PendingInvitationsCard,
} from "../TeamOnboardingCards.js";
import { SectionTooltipProvider } from "../TeamPrimitives.js";

/** Rows shaped like a settings group, for pages waiting on org data. */
export function OrgSettingsGroupSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="space-y-2.5" aria-busy="true">
      <Skeleton className="h-4 w-28" />
      <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card">
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6"
          >
            <div className="space-y-2">
              <Skeleton className="h-3.5 w-36" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="h-8 w-28" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Renders an Organization page once the active org is known. Without one it
 * shows the ways into an org (invitations, domain matches, create), and a
 * failed load reads as a failure with a retry, never as "no organization".
 */
export function OrgPageGate({
  children,
  skeletonRows,
}: {
  children: (org: OrgInfo & { orgId: string }) => ReactNode;
  skeletonRows?: number;
}) {
  const t = useT();
  const { data: org, isLoading, error, refetch, isFetching } = useOrg();

  if (isLoading && !org) {
    return <OrgSettingsGroupSkeleton rows={skeletonRows} />;
  }

  if (!org) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card px-5 py-4"
      >
        <p className="text-sm text-destructive">
          {error?.message || t("org.loadErrorFallback")}
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          {t("org.tryAgain")}
        </Button>
      </div>
    );
  }

  if (!org.orgId) {
    return (
      <SectionTooltipProvider>
        <div className="space-y-6">
          <PendingInvitationsCard />
          {org.domainMatches?.length ? (
            <JoinByDomainCard matches={org.domainMatches} />
          ) : null}
          <NoOrgCard orgCreation={org.access?.orgCreation} />
        </div>
      </SectionTooltipProvider>
    );
  }

  return (
    <SectionTooltipProvider>
      {children(org as OrgInfo & { orgId: string })}
    </SectionTooltipProvider>
  );
}

export function orgRoleLabel(
  role: string | null | undefined,
  t: ReturnType<typeof useT>,
): string {
  if (role === "owner") return t("org.owner");
  if (role === "admin") return t("org.admin");
  return t("org.member");
}
