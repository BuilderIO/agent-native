import type { ReactNode } from "react";

// Type-only: erased at build time, so declaring app roles pulls no server or
// database code into the browser bundle.
import type { AppRolesDescriptor } from "../../org/app-roles.js";
import { TooltipProvider } from "../components/ui/tooltip.js";
import { useT } from "../i18n.js";
import { SettingsSkeleton } from "../settings/SettingsSkeleton.js";
import {
  WorkspaceAppPrivacySettingsSection,
  WorkspaceApplicationsSection,
} from "./AppsAccessSection.js";
import {
  DomainSettingsSection,
  A2ASecretSection,
} from "./AuthenticationSection.js";
import { useWorkspaceGroupEditor, GroupsSection } from "./GroupsSection.js";
import { useOrg } from "./hooks.js";
import { MembersSection } from "./MembersSection.js";
import {
  WorkspaceUrlSettingsSection,
  DangerZoneCard,
  OrgProfileGroup,
} from "./OrgGeneralSection.js";
import { OrgIdentitySettings } from "./OrgIdentitySettings.js";
import {
  PendingInvitationsCard,
  JoinByDomainCard,
  NoOrgCard,
} from "./TeamOnboardingCards.js";

export { DomainSettingsSection } from "./AuthenticationSection.js";
export { WorkspaceGroupsCard } from "./GroupsSection.js";
export { MemberRow, MembersTableCard } from "./MembersSection.js";
export { OrgIdentitySettings } from "./OrgIdentitySettings.js";

export interface TeamPageProps {
  /**
   * Optional wrapper around the page contents. Templates pass their own Layout
   * component so the Team page renders inside the template's chrome.
   */
  layout?: (children: ReactNode) => ReactNode;
  /**
   * Title shown at the top of the page. Defaults to "Team".
   */
  title?: string;
  /**
   * Hide the page title when this is rendered inside another titled surface,
   * such as the Settings > Team tab.
   */
  showTitle?: boolean;
  /**
   * Description shown on the "Create an Organization" card. Defaults to
   * "Set up a team to collaborate with your colleagues."
   */
  createOrgDescription?: string;
  /**
   * Class applied to the outer max-width container. Templates can use this to
   * tweak page width.
   */
  className?: string;
  /**
   * Opt in to an app-role column on the members table, using the same
   * descriptor the app passes to `defineAppRoles`. Pass it explicitly rather
   * than letting the page discover registered apps: a workspace can host
   * several, and a members table that silently grows a column when some
   * unrelated module registers itself is a surprise, not a feature.
   *
   * Only org owners/admins can change assignments; everyone else sees the
   * column read-only.
   */
  appRoles?: AppRolesDescriptor;
}

// The Team page's "Organization" group interleaves rows that
// AuthenticationSection, AppsAccessSection, and OrgGeneralSection each own, so
// it composes their parts directly to keep today's row order.
function MembersCard({ appRoles }: { appRoles?: AppRolesDescriptor }) {
  const { data: org } = useOrg();
  const groupEditor = useWorkspaceGroupEditor();

  if (!org?.orgId) return null;

  const isOwnerOrAdmin = org.role === "owner" || org.role === "admin";
  const isOwner = org.role === "owner";

  return (
    <div className="space-y-6">
      <OrgProfileGroup>
        {isOwnerOrAdmin && (
          <>
            <DomainSettingsSection
              domain={org.allowedDomain}
              ownerEmail={org.email}
            />
            <WorkspaceAppPrivacySettingsSection
              visibility={org.workspaceAppDefaultVisibility ?? "org"}
            />
            <WorkspaceApplicationsSection />
            <WorkspaceUrlSettingsSection workspaceUrl={org.workspaceUrl} />
            <OrgIdentitySettings
              org={org}
              requiredAuthProvider={org.requiredAuthProvider}
            />
            {isOwner && <A2ASecretSection isSet={Boolean(org.a2aSecretSet)} />}
          </>
        )}
      </OrgProfileGroup>

      <MembersSection appRoles={appRoles} groupEditor={groupEditor} />

      <GroupsSection groupEditor={groupEditor} />

      {isOwner && <DangerZoneCard orgName={org.orgName ?? ""} />}
    </div>
  );
}

/**
 * Default Team management page. Templates can route directly to this component
 * or wrap it with their own Layout via the `layout` prop.
 */
export function TeamPage({
  layout,
  title,
  showTitle = true,
  createOrgDescription,
  className,
  appRoles,
}: TeamPageProps) {
  const t = useT();
  const { data: org, isLoading } = useOrg();

  const content = (
    <div className={`w-full space-y-6 ${className ?? ""}`}>
      {showTitle ? (
        <h2 className="text-2xl font-bold tracking-tight">
          {title ?? t("org.team")}
        </h2>
      ) : null}

      {isLoading && (
        <section className="rounded-lg border border-border bg-card p-6">
          <SettingsSkeleton lines={3} />
        </section>
      )}

      {!isLoading && (
        <>
          <PendingInvitationsCard />
          {/* Sitting in a personal workspace still counts as having an org, so
              gating this on `!org?.orgId` hid the only in-page way to reach the
              company workspace from the people who most needed it. */}
          {org?.domainMatches && org.domainMatches.length > 0 && (
            <JoinByDomainCard matches={org.domainMatches} />
          )}
          {!org?.orgId ? (
            <NoOrgCard
              description={createOrgDescription}
              orgCreation={org?.access?.orgCreation}
            />
          ) : (
            <MembersCard key={org.orgId} appRoles={appRoles} />
          )}
        </>
      )}
    </div>
  );

  const wrapped = (
    <TooltipProvider delayDuration={200}>{content}</TooltipProvider>
  );

  return layout ? <>{layout(wrapped)}</> : wrapped;
}
