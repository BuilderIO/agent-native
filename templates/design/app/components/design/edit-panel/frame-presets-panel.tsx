import { useT } from "@agent-native/core/client";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { useState } from "react";

import {
  FRAME_SIZE_PRESET_CATEGORIES,
  type FrameSizePreset,
  type FrameSizePresetCategoryKey,
} from "../inspector";

/**
 * One collapsible category group in the frame-tool presets panel — e.g.
 * "Phone" or "Tablet". Unlike {@link PanelSection} (used for property
 * sections, which shows no chevron), this renders a leading chevron like
 * Figma's own preset list and LayersPanel's disclosure triangles.
 */
function FramePresetCategoryGroup({
  title,
  presets,
  defaultOpen = false,
  onPick,
}: {
  title: string;
  presets: FrameSizePreset[];
  defaultOpen?: boolean;
  onPick: (preset: FrameSizePreset) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="shrink-0 border-t border-[var(--design-editor-control-border)] first:border-t-0">
      <button
        type="button"
        className="flex h-9 w-full min-w-0 cursor-pointer items-center gap-1.5 px-3 text-left"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        {open ? (
          <IconChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <IconChevronRight className="size-3.5 shrink-0 text-muted-foreground rtl:-scale-x-100" />
        )}
        <h3 className="min-w-0 flex-1 truncate !text-[11px] font-semibold text-foreground">
          {title}
        </h3>
      </button>
      {open ? (
        <div className="pb-1.5">
          {presets.map((preset) => (
            <button
              key={preset.name}
              type="button"
              className="flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 px-3 pl-8 text-left hover:bg-[var(--design-editor-control-hover-bg)]"
              onClick={() => onPick(preset)}
            >
              <span className="min-w-0 flex-1 truncate !text-[11px] text-foreground">
                {preset.name}
              </span>
              <span className="shrink-0 !text-[11px] tabular-nums text-muted-foreground">
                {preset.width}
                {"×" /* × */}
                {preset.height}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

const FRAME_PRESET_CATEGORY_LABEL_KEYS: Record<
  FrameSizePresetCategoryKey,
  string
> = {
  phone: "editPanel.framePresets.categories.phone",
  tablet: "editPanel.framePresets.categories.tablet",
  desktop: "editPanel.framePresets.categories.desktop",
  presentation: "editPanel.framePresets.categories.presentation",
  watch: "editPanel.framePresets.categories.watch",
  paper: "editPanel.framePresets.categories.paper",
  socialMedia: "editPanel.framePresets.categories.socialMedia",
};

/**
 * Figma-parity frame-tool panel: replaces the whole inspector body with a
 * scrollable, categorized list of screen-size presets while the Frame tool
 * is armed. Clicking a row calls `onCreateScreenFromPreset` with the exact
 * size — see the `activeTool`/`onCreateScreenFromPreset` doc comments on
 * `EditPanelProps` for the parent-side creation/tool-revert contract.
 */
export function FramePresetsPanel({
  onPick,
}: {
  onPick: (preset: FrameSizePreset) => void;
}) {
  const t = useT();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-10 shrink-0 items-center border-b border-border/90 px-3">
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
          {t("editPanel.framePresets.title")}
        </h3>
      </div>
      <div className="design-inspector-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {FRAME_SIZE_PRESET_CATEGORIES.map((category, index) => (
          <FramePresetCategoryGroup
            key={category.key}
            title={t(FRAME_PRESET_CATEGORY_LABEL_KEYS[category.key])}
            presets={category.presets}
            defaultOpen={index === 0}
            onPick={onPick}
          />
        ))}
      </div>
    </div>
  );
}
