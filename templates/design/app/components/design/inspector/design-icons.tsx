/**
 * Inspector icon vocabulary.
 *
 * Keep these semantic aliases backed by Tabler so every caller inherits the
 * same 24px canvas, 2px stroke, and round cap/join geometry. Product-specific
 * diagrams (alignment matrices, constraints, gradients) live with the control
 * that renders them; ordinary actions and properties must come from Tabler.
 */
export {
  IconTextSize as IconText,
  IconSpacingHorizontal as IconGap,
  IconSpacingHorizontal as IconPaddingHorizontal,
  IconSpacingVertical as IconPaddingVertical,
  IconLayoutColumns as IconFlowHorizontal,
  IconLayoutRows as IconFlowVertical,
  IconBoxMultiple as IconFlowNormal,
  IconLayoutGrid as IconFlowGrid,
  IconAdjustmentsHorizontal as IconLayoutSettings,
  IconArrowAutofitWidth as IconSizingFixed,
  IconArrowsMinimize as IconSizingHug,
  IconArrowsMaximize as IconSizingFill,
  IconViewportNarrow as IconSizingMin,
  IconViewportWide as IconSizingMax,
  IconVariable as IconSizingVariable,
  IconX as IconSizingRemove,
} from "@tabler/icons-react";
