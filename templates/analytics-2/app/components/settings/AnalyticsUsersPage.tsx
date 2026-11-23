import { useT } from "@agent-native/core/client/i18n";
import { OrgMembersPage } from "@agent-native/toolkit/app/org";

import { AppSettingsSections } from "@/skins/app-settings-sections";

import { AnalyticsMemberDetails } from "./AnalyticsMemberDetails";
import { RoleRequestControl, RoleRequestQueue } from "./RoleRequests";
import { useAnalyticsUsersPageSections } from "./useAnalyticsUsersPageSections";

export { inviteLinkFor } from "./inviteLink";

/**
 * Settings → Users.
 *
 * The members surface owns invites, roles, app roles and groups. What it does not
 * offer is the link an admin can paste into a chat: the invitations it lists
 * already carry an id the accept endpoint takes, so a shareable link is that id
 * on a join route. Nothing new is minted here — the same pending invitation,
 * reachable as a URL.
 */
export function AnalyticsUsersPage({ isAdmin }: { isAdmin: boolean }) {
  const t = useT();
  return (
    <div className="space-y-8">
      <p className="text-sm text-muted-foreground">
        {t(
          isAdmin
            ? "analytics.settings.users.adminDescription"
            : "analytics.settings.users.description",
        )}
      </p>
      {isAdmin ? (
        <>
          <InviteLinks />
          <RoleRequestQueue />
        </>
      ) : (
        <RoleRequestControl />
      )}
      <AnalyticsMemberDetails />
      <OrgMembersPage />
    </div>
  );
}

export function InviteLinks() {
  return (
    <AppSettingsSections
      sections={useAnalyticsUsersPageSections()}
      hints={{ frame: "stack" }}
    />
  );
}
