import type { RoutePageProps } from "@/components/workspace/types";
import { AppSettingsSections } from "@/skins/app-settings-sections";

import { useAnalyticsAssetLabelsSettingsSections } from "./useAnalyticsAssetLabelsSettingsSections";

export function AnalyticsAssetLabelsSettings({ route }: RoutePageProps) {
  return (
    <AppSettingsSections
      sections={useAnalyticsAssetLabelsSettingsSections(route.view)}
      hints={{ frame: "catalog" }}
    />
  );
}
