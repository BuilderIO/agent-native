import { SettingsGroup } from "@agent-native/toolkit/app/settings";
import { ProfileSettings } from "@agent-native/toolkit/app/settings/account/ProfileSettings";

import { RoleRequestControl } from "./RoleRequests";

/**
 * Settings → Profile.
 *
 * The account surface the reference settings rail carries under Account: the
 * photo, name and email rows. It renders the settings kit's own ProfileSettings
 * group, which is what mounts the profile-photo and change-email controls; the
 * rebuilt settings shell has to host it or those rows are unreachable.
 */
export function AnalyticsProfilePage() {
  return (
    <>
      <ProfileSettings />
      <SettingsGroup title="Workspace access">
        <section className="px-5 py-4" aria-label="Workspace access">
          <RoleRequestControl />
        </section>
      </SettingsGroup>
    </>
  );
}
