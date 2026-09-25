import type { SettingsPageProps } from "../registry.js";
import { BridgedOrganizationContent } from "./organization-content.js";

export default function MembersSettingsPage({ bridge }: SettingsPageProps) {
  return <BridgedOrganizationContent bridge={bridge} />;
}
