import { InfrastructureSettingsPage } from "../../infra/InfrastructureSettingsPage.js";
import type { SettingsPageProps } from "../registry.js";

export default function InfraSettingsPage(props: SettingsPageProps) {
  return <InfrastructureSettingsPage {...props} />;
}
