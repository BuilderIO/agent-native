import { AccountSettingsCard } from "../../AccountSettingsCard.js";
import type { SettingsPageProps } from "../registry.js";

export default function ProfileSettingsPage({ bridge }: SettingsPageProps) {
  return <>{bridge.account ?? <AccountSettingsCard />}</>;
}
