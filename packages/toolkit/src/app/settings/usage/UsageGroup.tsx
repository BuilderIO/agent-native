import type { ModelRow } from "@agent-native/design-system/model";
import type { ReactNode } from "react";

import {
  ModelSurface,
  type ModelSurfaceProps,
} from "../../../design-system/parts.js";

/**
 * A titled Usage section, drawn from the model as a `settings.report`: its
 * `rows` in a card, or `raw` content (a chart that brings its own card), with
 * an `action` beside the title (the chart's grouping control). `children`
 * draw after the rows; the row id is `settings.usage.` plus the anchor's
 * name.
 */
export function UsageGroup({
  id,
  title,
  action,
  raw = false,
  rows,
  actions,
  slots,
  children,
}: {
  id: `usage-${string}`;
  title: string;
  action?: ReactNode;
  raw?: boolean;
  rows?: readonly ModelRow[];
  actions?: ModelSurfaceProps["actions"];
  slots?: ModelSurfaceProps["slots"];
  children?: ReactNode;
}) {
  const regions: Record<string, string> = {};
  if (action !== undefined) regions.action = "usage-group-action";
  if (raw) regions.body = "usage-group-content";
  const row: ModelRow = {
    id: `settings.usage.${id.slice("usage-".length)}`,
    part: "settings.report",
    label: title,
    anchor: id,
    regions,
    ...(!raw && children !== undefined ? { slot: "usage-group-content" } : {}),
    rows,
  };
  return (
    <ModelSurface
      model={{ id: "settings", rows: [row] }}
      actions={actions}
      slots={{
        ...slots,
        "usage-group-action": action,
        "usage-group-content": children,
      }}
    />
  );
}

/** The bordered surface a chart and its legend sit on. */
export function UsageChartCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card px-5 py-5 sm:px-6">
      {children}
    </div>
  );
}
