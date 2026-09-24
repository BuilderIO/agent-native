import { useT } from "@agent-native/core/client/i18n";
import {
  DEFAULT_LAYOUT_GRID,
  MAX_LAYOUT_GRID_SIZE,
  MIN_LAYOUT_GRID_SIZE,
  type LayoutGrid,
} from "@shared/layout-grid";
import {
  IconEye,
  IconEyeOff,
  IconGrid4x4,
  IconPlus,
  IconX,
} from "@tabler/icons-react";

import { ScrubStyleInput } from "./field-primitives";
import { SectionIconButton, SectionIconToggle } from "./inspector-controls";
import { PanelSection } from "./panel-primitives";

export function LayoutGridProperties({
  grid,
  onChange,
  readOnly = false,
}: {
  grid: LayoutGrid | null;
  onChange: (next: Partial<LayoutGrid> | null) => void;
  readOnly?: boolean;
}) {
  const t = useT();

  return (
    <PanelSection
      title={t("editPanel.sections.layoutGrid")}
      actions={
        readOnly ? null : grid ? (
          <>
            <SectionIconToggle
              label={
                grid.visible
                  ? t("editPanel.labels.hideGrid")
                  : t("editPanel.labels.showGrid")
              }
              active={!grid.visible}
              onClick={() => onChange({ ...grid, visible: !grid.visible })}
            >
              {grid.visible ? (
                <IconEye className="size-3.5" />
              ) : (
                <IconEyeOff className="size-3.5" />
              )}
            </SectionIconToggle>
            <SectionIconButton
              label={t("editPanel.labels.removeGrid")}
              onClick={() => onChange(null)}
            >
              <IconX className="size-3.5" />
            </SectionIconButton>
          </>
        ) : (
          <SectionIconButton
            label={t("editPanel.labels.addGrid")}
            onClick={() => onChange(DEFAULT_LAYOUT_GRID)}
          >
            <IconPlus className="size-3.5" />
          </SectionIconButton>
        )
      }
    >
      {grid ? (
        <div className="design-sidebar-property-group">
          <ScrubStyleInput
            label={t("editPanel.labels.size")}
            ariaLabel={t("editPanel.sections.layoutGrid")}
            icon={IconGrid4x4}
            hideIcon={false}
            value={`${grid.size}px`}
            onChange={(size) => onChange({ ...grid, size })}
            min={MIN_LAYOUT_GRID_SIZE}
            max={MAX_LAYOUT_GRID_SIZE}
            precision={0}
            disabled={readOnly}
            inputClassName="h-6"
          />
        </div>
      ) : null}
    </PanelSection>
  );
}
