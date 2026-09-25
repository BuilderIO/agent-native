import { lazy, Suspense } from "react";

import type { ResourceView } from "../../../resources/ResourcesPanel.js";
import { SettingsSkeleton } from "../../SettingsSkeleton.js";

const ResourcesPanel = lazy(() =>
  import("../../../resources/ResourcesPanel.js").then((module) => ({
    default: module.ResourcesPanel,
  })),
);

/** Today's Resources view for one collection, without the pill row. */
export function ResourceCollection({ view }: { view: ResourceView }) {
  return (
    <Suspense fallback={<SettingsSkeleton lines={3} />}>
      <ResourcesPanel
        key={view}
        showMcpServers={false}
        resourceFilter={view}
        resourceTreeVariant="collection"
        scope="personal"
      />
    </Suspense>
  );
}
