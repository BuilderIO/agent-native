import type { SettingsPageProps } from "../registry.js";
import { BridgedOrganizationContent } from "./organization-content.js";

export default function AppsSettingsPage({ bridge }: SettingsPageProps) {
  return <BridgedOrganizationContent bridge={bridge} />;
}
