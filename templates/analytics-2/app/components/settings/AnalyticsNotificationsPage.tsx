import { AppSettingsSections } from "@/skins/app-settings-sections";

import { useAnalyticsNotificationsPageSections } from "./useAnalyticsNotificationsPageSections";

/**
 * ACCOUNT > Notifications.
 *
 * The source's rail lists Notifications between Preferences and Connected apps,
 * and its first item is "Desktop notifications" (settings item catalogue, five
 * chunk 298c12dc3434 lines 788-799 with the rail order at 1243-1248). Only the
 * item this app can back is shown: the switch is stored in the person's own
 * settings resource, so flipping it survives a reload. The source's "Notify me
 * about" and "Contacts" items need the option lists and contact store they read
 * from, so they are not listed here yet rather than rendered empty.
 */
export function AnalyticsNotificationsPage() {
  return (
    <AppSettingsSections
      sections={useAnalyticsNotificationsPageSections()}
      hints={{ frame: "group" }}
    />
  );
}
