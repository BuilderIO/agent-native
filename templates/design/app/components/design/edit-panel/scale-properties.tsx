import { useT } from "@agent-native/core/client/i18n";
import { IconChevronDown, IconResize, IconX } from "@tabler/icons-react";
import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import type { ElementInfo } from "../types";
import { ScrubStyleInput } from "./field-primitives";
import { InspectorIconButton } from "./inspector-controls";
import {
  INSPECTOR_GRID_PAIR_GUTTER_SPAN,
  INSPECTOR_GRID_PAIR_SPAN,
  InspectorGrid,
  InspectorGridCell,
  PanelSection,
} from "./panel-primitives";

export type ScaleAnchorOffset = 0 | 0.5 | 1;

export interface ScaleAnchor {
  x: ScaleAnchorOffset;
  y: ScaleAnchorOffset;
}

export interface ScaleToolControls {
  onScale: (factor: number, anchor: ScaleAnchor) => void;
  onExit: () => void;
}

const SCALE_PRESETS = [0.25, 0.5, 0.75, 1, 2, 3, 4, 5, 10];

const ANCHORS: Array<{
  x: ScaleAnchorOffset;
  y: ScaleAnchorOffset;
  labelKey: string;
}> = [
  { x: 0, y: 0, labelKey: "topLeft" },
  { x: 0.5, y: 0, labelKey: "topCenter" },
  { x: 1, y: 0, labelKey: "topRight" },
  { x: 0, y: 0.5, labelKey: "middleLeft" },
  { x: 0.5, y: 0.5, labelKey: "center" },
  { x: 1, y: 0.5, labelKey: "middleRight" },
  { x: 0, y: 1, labelKey: "bottomLeft" },
  { x: 0.5, y: 1, labelKey: "bottomCenter" },
  { x: 1, y: 1, labelKey: "bottomRight" },
];

function roundFactor(value: number): number {
  return Math.round(value * 100) / 100;
}

export function ScaleProperties({
  element,
  controls,
}: {
  element: ElementInfo;
  controls: ScaleToolControls;
}) {
  const t = useT();
  const width = Number.parseFloat(element.computedStyles.width ?? "") || 0;
  const height = Number.parseFloat(element.computedStyles.height ?? "") || 0;
  const [baseWidth] = useState(width);
  const [anchor, setAnchor] = useState<ScaleAnchor>({ x: 0.5, y: 0.5 });
  const factor = baseWidth > 0 ? width / baseWidth : 1;
  const factorLabel = t("editPanel.scale.factor");

  const scaleTo = (targetFactor: number) => {
    if (!(targetFactor > 0) || !(factor > 0)) return;
    const relative = targetFactor / factor;
    if (Math.abs(relative - 1) < 1e-6) return;
    controls.onScale(relative, anchor);
  };

  return (
    <div
      data-design-scale-section
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        controls.onExit();
      }}
    >
      <PanelSection
        title={t("editPanel.scale.title")}
        actions={
          <InspectorIconButton
            label={t("editPanel.scale.exit")}
            onClick={controls.onExit}
          >
            <IconX className="size-3.5" />
          </InspectorIconButton>
        }
      >
        <InspectorGrid className="items-center" layout="pair">
          <InspectorGridCell span={INSPECTOR_GRID_PAIR_SPAN}>
            <ScrubStyleInput
              label="W"
              ariaLabel={t("editPanel.labels.width")}
              value={String(roundFactor(width))}
              unit=""
              min={1}
              precision={0}
              onChange={(value, meta) => {
                if (meta?.phase === "commit") scaleTo(value / baseWidth);
              }}
            />
          </InspectorGridCell>
          <InspectorGridCell
            span={INSPECTOR_GRID_PAIR_GUTTER_SPAN}
            ariaHidden
          />
          <InspectorGridCell span={INSPECTOR_GRID_PAIR_SPAN}>
            <ScrubStyleInput
              label="H"
              ariaLabel={t("editPanel.labels.height")}
              value={String(roundFactor(height))}
              unit=""
              min={1}
              precision={0}
              onChange={(value, meta) => {
                if (meta?.phase === "commit" && height > 0) {
                  scaleTo((value / height) * factor);
                }
              }}
            />
          </InspectorGridCell>
        </InspectorGrid>
        <InspectorGrid className="items-start" layout="pair">
          <InspectorGridCell
            span={INSPECTOR_GRID_PAIR_SPAN}
            className="flex items-center gap-0.5"
          >
            <div className="min-w-0 flex-1">
              <ScrubStyleInput
                label={factorLabel}
                hideIcon={false}
                icon={IconResize}
                labelClassName="[&>span]:sr-only"
                ariaLabel={factorLabel}
                value={String(roundFactor(factor))}
                unit="x"
                min={0.01}
                step={0.1}
                precision={2}
                onChange={(value, meta) => {
                  if (meta?.phase !== "commit") return;
                  scaleTo(value);
                  if (meta.source === "commit") controls.onExit();
                }}
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t("editPanel.scale.presets")}
                  className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <IconChevronDown className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {SCALE_PRESETS.map((preset) => (
                  <DropdownMenuItem
                    key={preset}
                    onSelect={() => {
                      scaleTo(preset);
                      controls.onExit();
                    }}
                  >
                    {`${preset}x`}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </InspectorGridCell>
          <InspectorGridCell
            span={INSPECTOR_GRID_PAIR_GUTTER_SPAN}
            ariaHidden
          />
          <InspectorGridCell span={INSPECTOR_GRID_PAIR_SPAN}>
            <div
              role="radiogroup"
              aria-label={t("editPanel.scale.anchor")}
              className="grid w-fit grid-cols-3 gap-1 rounded-md bg-[var(--design-editor-control-bg)] p-1"
            >
              {ANCHORS.map((option) => {
                const active = option.x === anchor.x && option.y === anchor.y;
                return (
                  <button
                    key={option.labelKey}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={t(`editPanel.scale.${option.labelKey}`)}
                    title={t(`editPanel.scale.${option.labelKey}`)}
                    className="flex size-4 items-center justify-center"
                    onClick={() => setAnchor({ x: option.x, y: option.y })}
                  >
                    <span
                      className={cn(
                        "block rounded-[1px]",
                        active
                          ? "size-2 bg-[var(--design-editor-accent-color)]"
                          : "size-[3px] bg-muted-foreground/60",
                      )}
                    />
                  </button>
                );
              })}
            </div>
          </InspectorGridCell>
        </InspectorGrid>
      </PanelSection>
    </div>
  );
}
