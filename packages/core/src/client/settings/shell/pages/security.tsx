import { AccountSettingsCard } from "../../AccountSettingsCard.js";
import type { SettingsPageProps } from "../registry.js";

// Bridge: password, two-factor, and data requests still live in the account
// card until the Security page splits them out.
export default function SecuritySettingsPage({ bridge }: SettingsPageProps) {
  return <>{bridge.account ?? <AccountSettingsCard />}</>;
}
