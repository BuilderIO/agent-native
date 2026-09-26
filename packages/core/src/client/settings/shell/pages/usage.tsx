import { UsagePage } from "../../usage/UsagePage.js";
import type { SettingsPageProps } from "../registry.js";

export default function UsageSettingsPage({ context }: SettingsPageProps) {
  return <UsagePage context={context} />;
}
