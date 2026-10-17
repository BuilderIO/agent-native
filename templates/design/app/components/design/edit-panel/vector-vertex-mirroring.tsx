import { useT } from "@agent-native/core/client/i18n";
import type { PenMirroring } from "@shared/pen-path";
import {
  IconVectorBezier,
  IconVectorBezier2,
  IconVectorSpline,
} from "@tabler/icons-react";

import { ScrubStyleInput } from "./field-primitives";
import { SectionIconToggle } from "./inspector-controls";
import {
  INSPECTOR_GRID_PAIR_GUTTER_SPAN,
  INSPECTOR_GRID_PAIR_SPAN,
  InspectorGrid,
  InspectorGridCell,
} from "./inspector-grid";
import { PanelSection } from "./panel-primitives";

export function VectorVertexMirroring({
  mirroring,
  onChange,
  point,
  onPointChange,
}: {
  mirroring: PenMirroring;
  onChange: (mirroring: PenMirroring) => void;
  point: { x: number; y: number };
  onPointChange: (point: { x: number; y: number }) => void;
}) {
  const t = useT();
  const options = [
    {
      value: "none",
      label: t("editPanel.labels.noMirroring"),
      Icon: IconVectorSpline,
    },
    {
      value: "angle",
      label: t("editPanel.labels.mirrorAngle"),
      Icon: IconVectorBezier,
    },
    {
      value: "angleAndLength",
      label: t("editPanel.labels.mirrorAngleAndLength"),
      Icon: IconVectorBezier2,
    },
  ] as const;
  return (
    <div data-vector-vertex-mirroring>
      <PanelSection title={t("editPanel.labels.vector")}>
        <div className="space-y-2 px-2 pb-2">
          <InspectorGrid className="items-center" layout="pair">
            <InspectorGridCell span={INSPECTOR_GRID_PAIR_SPAN}>
              <ScrubStyleInput
                label="X"
                ariaLabel="Point X"
                precision={2}
                value={String(point.x)}
                inputClassName="h-6"
                onChange={(x) => onPointChange({ x, y: point.y })}
              />
            </InspectorGridCell>
            <InspectorGridCell
              span={INSPECTOR_GRID_PAIR_GUTTER_SPAN}
              ariaHidden
            />
            <InspectorGridCell span={INSPECTOR_GRID_PAIR_SPAN}>
              <ScrubStyleInput
                label="Y"
                ariaLabel="Point Y"
                precision={2}
                value={String(point.y)}
                inputClassName="h-6"
                onChange={(y) => onPointChange({ x: point.x, y })}
              />
            </InspectorGridCell>
          </InspectorGrid>
          <div className="flex items-center gap-1">
            {options.map(({ value, label, Icon }) => (
              <SectionIconToggle
                key={value}
                label={label}
                active={mirroring === value}
                onClick={() => onChange(value)}
              >
                <Icon className="size-3.5" />
              </SectionIconToggle>
            ))}
          </div>
        </div>
      </PanelSection>
    </div>
  );
}
