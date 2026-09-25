import type { SettingsPageProps } from "../registry.js";
import { BridgedOrganizationContent } from "./organization-content.js";

export default function OrganizationGeneralSettingsPage({
  bridge,
}: SettingsPageProps) {
  return <BridgedOrganizationContent bridge={bridge} />;
}
