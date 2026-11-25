export interface CssInputDefinition {
  readonly fallback: string;
  readonly description: string;
}

export type CssInputs = Readonly<Record<`--${string}`, CssInputDefinition>>;

const designFilePanelInset = {
  fallback: "var(--space-4)",
  description: "Inline spacing shared by the panel and its rows.",
};
const insetPaddingLeft = {
  fallback: "0px",
  description:
    "Distance to the containing surface’s left edge, excluding its border.",
};
const insetPaddingRight = {
  fallback: "0px",
  description:
    "Distance to the containing surface’s right edge, excluding its border.",
};
const inspectorActionWidth = {
  fallback: "var(--size-4)",
  description: "Width reserved for a trailing property action.",
};
const inspectorGap = {
  fallback: "var(--space-2)",
  description: "Spacing between controls in an inspector row.",
};
const inspectorInsetEnd = {
  fallback: "var(--space-2)",
  description: "Space at the inline end of each section.",
};
const inspectorInsetStart = {
  fallback: "var(--space-4)",
  description: "Space at the inline start of each section.",
};
const inspectorSectionHeaderHeight = {
  fallback: "var(--size-5)",
  description: "Minimum height of a section heading.",
};
const layerTreeRowHeight = {
  fallback: "var(--control-height-4)",
  description: "Height of each layer row, including virtualized rows.",
};
const menuMinWidth = {
  fallback: "10rem",
  description: "Minimum popup width within the available space.",
};
const menuRowHeight = {
  fallback: "var(--size-4)",
  description: "Height of a standard option row.",
};
const tabsFrameRail = {
  fallback: "var(--gray-4)",
  description: "Background of the framed tab strip.",
};

export const checkboxCardsCssInputs = {
  "--checkbox-cards-columns": {
    fallback: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))",
    description: "Column tracks for the checkbox card grid.",
  },
  "--checkbox-cards-gap": {
    fallback: "var(--space-4)",
    description: "Spacing between checkbox cards.",
  },
} as const satisfies CssInputs;

export const designFilePanelCssInputs = {
  "--design-file-panel-header-height": {
    fallback: "var(--size-6)",
    description: "Minimum height of the file header.",
  },
  "--design-file-panel-inset": designFilePanelInset,
  "--design-file-panel-pages-max-height": {
    fallback: "50%",
    description: "Maximum height of the scrollable pages section.",
  },
  "--design-file-panel-section-height": {
    fallback: "var(--size-5)",
    description: "Minimum height of page and section headers.",
  },
  "--design-file-panel-surface": {
    fallback: "var(--surface-nav)",
    description: "Background of the file panel and its tab strip.",
  },
  "--layer-tree-row-height": layerTreeRowHeight,
} as const satisfies CssInputs;

export const designPropertyInspectorCssInputs = {
  "--design-property-inspector-component-color": {
    fallback: "var(--fg-brand)",
    description: "Color of the component indicator.",
  },
  "--inspector-action-width": inspectorActionWidth,
  "--inspector-gap": inspectorGap,
  "--inspector-inset-end": inspectorInsetEnd,
  "--inspector-inset-start": inspectorInsetStart,
  "--inspector-rule-width": {
    fallback: "11rem",
    description: "Maximum width of the responsive rule selector.",
  },
  "--inspector-section-header-height": inspectorSectionHeaderHeight,
} as const satisfies CssInputs;

export const dockWorkspaceCssInputs = {
  "--tabs-frame-rail": tabsFrameRail,
} as const satisfies CssInputs;

export const insetCssInputs = {
  "--inset-border-radius": {
    fallback: "0px",
    description: "Corner radius supplied by the containing surface.",
  },
  "--inset-border-width": {
    fallback: "0px",
    description: "Border thickness supplied by the containing surface.",
  },
  "--inset-padding-bottom": {
    fallback: "0px",
    description:
      "Distance to the containing surface’s bottom edge, excluding its border.",
  },
  "--inset-padding-left": insetPaddingLeft,
  "--inset-padding-right": insetPaddingRight,
  "--inset-padding-top": {
    fallback: "0px",
    description:
      "Distance to the containing surface’s top edge, excluding its border.",
  },
} as const satisfies CssInputs;

export const inspectorCssInputs = {
  "--inspector-action-width": inspectorActionWidth,
  "--inspector-gap": inspectorGap,
  "--inspector-header-height": {
    fallback: "var(--size-4)",
    description: "Minimum height of the inspector header.",
  },
  "--inspector-inset-end": inspectorInsetEnd,
  "--inspector-inset-start": inspectorInsetStart,
  "--inspector-label-line-height": {
    fallback: "var(--size-1)",
    description: "Line height of a property label.",
  },
  "--inspector-label-size": {
    fallback: "var(--font-size-1)",
    description: "Font size of a property label.",
  },
  "--inspector-section-header-height": inspectorSectionHeaderHeight,
  "--inspector-section-padding": {
    fallback: "var(--space-4)",
    description: "Space below a section’s controls.",
  },
} as const satisfies CssInputs;

export const layerTreeCssInputs = {
  "--design-file-panel-inset": designFilePanelInset,
  "--layer-tree-drop-line": {
    fallback: "var(--line-focus)",
    description: "Color of the row insertion marker.",
  },
  "--layer-tree-row-height": layerTreeRowHeight,
} as const satisfies CssInputs;

export const layoutCssInputs = {
  "--layout-columns": {
    fallback: "minmax(0, 1fr)",
    description: "Column tracks used by Grid.",
  },
  "--layout-gap": {
    fallback: "var(--space-2)",
    description: "Spacing between children in Stack, Inline and Grid.",
  },
} as const satisfies CssInputs;

export const menuCssInputs = {
  "--menu-min-width": menuMinWidth,
  "--menu-row-height": menuRowHeight,
} as const satisfies CssInputs;

export const paintEditorCssInputs = {
  "--inspector-action-width": inspectorActionWidth,
  "--inspector-gap": inspectorGap,
} as const satisfies CssInputs;

export const progressCssInputs = {
  "--progress-duration": {
    fallback: "5s",
    description: "Duration of an indeterminate sweep.",
  },
} as const satisfies CssInputs;

export const radioCardsCssInputs = {
  "--radio-cards-columns": {
    fallback: "repeat(auto-fit, minmax(min(100%, 160px), 1fr))",
    description: "Column tracks for the radio card grid.",
  },
  "--radio-cards-gap": {
    fallback: "var(--space-4)",
    description: "Spacing between radio cards.",
  },
} as const satisfies CssInputs;

export const selectCssInputs = {
  "--menu-compact-row-height": {
    fallback: "var(--size-3)",
    description: "Height of a compact option row.",
  },
  "--menu-min-width": menuMinWidth,
  "--menu-row-height": menuRowHeight,
} as const satisfies CssInputs;

export const splitPaneCssInputs = {
  "--split-pane-handle-size": {
    fallback: "var(--space-2)",
    description: "Thickness of the interactive resize handle.",
  },
  "--split-pane-line": {
    fallback: "var(--line-default)",
    description: "Color of the divider.",
  },
} as const satisfies CssInputs;

export const tableCssInputs = {
  "--inset-padding-left": {
    ...insetPaddingLeft,
    fallback: "var(--_table-cell-padding-x)",
  },
  "--inset-padding-right": {
    ...insetPaddingRight,
    fallback: "var(--_table-cell-padding-x)",
  },
} as const satisfies CssInputs;

export const tabsCssInputs = {
  "--tabs-frame-rail": tabsFrameRail,
  "--tabs-frame-surface": {
    fallback: "var(--_tabs-default-frame, var(--surface-raised))",
    description: "Background of the active framed tab and panel.",
  },
} as const satisfies CssInputs;

export const toastCssInputs = {
  "--toast-inset-bottom": {
    fallback: "0px",
    description: "Additional bottom clearance for an anchored toast stack.",
  },
  "--toast-offset": {
    fallback: "var(--space-4)",
    description: "Space between the stack and the viewport edge.",
  },
} as const satisfies CssInputs;
