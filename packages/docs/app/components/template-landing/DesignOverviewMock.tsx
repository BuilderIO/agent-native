/**
 * Static, decorative recreation of the Design editor mid-edit — one screen on
 * the canvas with its mobile breakpoint beside it, a layer tree on the left, and
 * a populated inspector on the right — used as landing-page hero art.
 *
 * All CSS lives here, scoped under `.design-mock`. The real stylesheet
 * (templates/design/app/global.css) is deliberately NOT imported: it declares
 * `:root`/`html`/`body` palette rules that would reskin the whole docs site.
 * The custom properties below mirror the editor's tokens by hand instead.
 *
 * The design being edited lives in DesignTaskerArtboards.tsx, authored at its
 * logical size and scaled by BOARD_SCALE so type and spacing shrink in the same
 * proportion a real board zoom would produce rather than being faked with tiny
 * font sizes.
 *
 * i18n-raw-literal-disable-file -- this is artwork, not UI copy. The wrapper is
 * a `role="img"` with a localized `aria-label` and the entire frame inside it is
 * `aria-hidden`, so no assistive tech ever reads these strings; they are the
 * pixels of a product screenshot (fake screen names, placeholder app content
 * inside the artboards, panel labels). Translating them across 11 catalogs would
 * add churn with nothing to show for it, since the localized alt text is what a
 * non-English reader actually gets.
 */
import {
  IconAdjustments,
  IconAngle,
  IconBorderCorners,
  IconBorderRadius,
  IconBorderStyle,
  IconChevronDown,
  IconChevronRight,
  IconCode,
  IconComponents,
  IconDeviceMobile,
  IconEye,
  IconEyeOff,
  IconFile,
  IconFileImport,
  IconFlipHorizontal,
  IconFlipVertical,
  IconFrame,
  IconGridDots,
  IconHandClick,
  IconLayersIntersect,
  IconLayoutAlignBottom,
  IconLayoutAlignCenter,
  IconLayoutAlignLeft,
  IconLayoutAlignMiddle,
  IconLayoutAlignRight,
  IconLayoutAlignTop,
  IconLayoutColumns,
  IconLayoutDistributeHorizontal,
  IconLayoutGrid,
  IconLayoutRows,
  IconLink,
  IconListTree,
  IconMessage,
  IconMinus,
  IconPlayerPlay,
  IconPlus,
  IconPointer,
  IconRotate3d,
  IconScribble,
  IconSearch,
  IconSquare,
  IconTransformPoint,
  IconTypography,
  IconVectorBezier,
  IconViewportWide,
} from "@tabler/icons-react";

import { LogoMark } from "../website-redesign/ds/logo-mark";
import {
  BOARD_SCALE,
  DESIGN_TASKER_CSS,
  DESKTOP_ARTBOARD_HEIGHT,
  DESKTOP_ARTBOARD_WIDTH,
  MOBILE_ARTBOARD_HEIGHT,
  MOBILE_ARTBOARD_WIDTH,
  TaskerDesktopArtboard,
  TaskerMobileArtboard,
} from "./DesignTaskerArtboards";

const RAIL_WIDTH = 64;
/** The real `leftSidebarWidth` minimum. Below the 280px default to buy canvas. */
const LEFT_PANEL_WIDTH = 220;
const INSPECTOR_WIDTH = 240;

const FRAME_LABEL_HEIGHT = 28;
/** The real BREAKPOINT_FRAME_GAP, not the wider gap between separate screens. */
const BREAKPOINT_FRAME_GAP = 24;

const DESKTOP_FRAME_WIDTH = Math.round(DESKTOP_ARTBOARD_WIDTH * BOARD_SCALE);
const DESKTOP_FRAME_HEIGHT = Math.round(DESKTOP_ARTBOARD_HEIGHT * BOARD_SCALE);
const MOBILE_FRAME_WIDTH = Math.round(MOBILE_ARTBOARD_WIDTH * BOARD_SCALE);
const MOBILE_FRAME_HEIGHT = Math.round(MOBILE_ARTBOARD_HEIGHT * BOARD_SCALE);
const MOBILE_FRAME_X = DESKTOP_FRAME_WIDTH + BREAKPOINT_FRAME_GAP;

// Only the three panels the default feature-flag state actually renders. The
// rest (Assets, Tools, Tokens, Code) sit behind flags that are off.
const RAIL_ITEMS = [
  { label: "File", icon: IconFile, active: true },
  { label: "Agent", icon: IconMessage },
  { label: "Import", icon: IconFileImport },
];

type LayerGlyph = "screen" | "frame" | "rows" | "columns" | "component";

const LAYER_GLYPHS = {
  screen: IconFile,
  frame: IconFrame,
  rows: IconLayoutRows,
  columns: IconLayoutColumns,
  component: IconComponents,
} satisfies Record<LayerGlyph, typeof IconFile>;

type LayerRow = {
  id: string;
  label: string;
  depth: number;
  glyph: LayerGlyph;
  /** Omitted for leaves, which still reserve the caret slot. */
  disclosure?: "expanded" | "collapsed";
  /** The active screen row, which the editor tints like a selected list item. */
  activeScreen?: boolean;
  /** Component instances take the purple selection family, not the blue one. */
  component?: boolean;
  selected?: boolean;
  /** An ancestor of the selection, tinted with the subtree color. */
  ancestor?: boolean;
};

const LAYER_ROWS: LayerRow[] = [
  {
    id: "home",
    label: "Home",
    depth: 0,
    glyph: "screen",
    disclosure: "expanded",
    activeScreen: true,
  },
  {
    id: "group-root",
    label: "Group",
    depth: 1,
    glyph: "rows",
    disclosure: "expanded",
    ancestor: true,
  },
  {
    id: "frame-a",
    label: "Frame",
    depth: 2,
    glyph: "frame",
    disclosure: "collapsed",
  },
  {
    id: "frame-b",
    label: "Frame",
    depth: 2,
    glyph: "frame",
    disclosure: "expanded",
    ancestor: true,
  },
  {
    id: "inbox",
    label: "Inbox",
    depth: 3,
    glyph: "rows",
    disclosure: "expanded",
    ancestor: true,
  },
  {
    id: "group-inbox",
    label: "Group",
    depth: 4,
    glyph: "rows",
    disclosure: "expanded",
    ancestor: true,
  },
  {
    id: "footer",
    label: "Footer",
    depth: 5,
    glyph: "columns",
    disclosure: "collapsed",
  },
  {
    id: "expression",
    label: "t.group===group &&",
    depth: 5,
    glyph: "component",
    component: true,
  },
  {
    id: "app-enter-a",
    label: "App Enter",
    depth: 5,
    glyph: "rows",
    disclosure: "collapsed",
  },
  {
    id: "app-enter-b",
    label: "App Enter",
    depth: 5,
    glyph: "rows",
    disclosure: "expanded",
    ancestor: true,
  },
  {
    id: "add-task",
    label: "+ Add task",
    depth: 6,
    glyph: "component",
    component: true,
    selected: true,
  },
  {
    id: "group-leaf",
    label: "Group",
    depth: 6,
    glyph: "rows",
    disclosure: "collapsed",
  },
  {
    id: "desktop-sidebar",
    label: "Desktop Sidebar",
    depth: 1,
    glyph: "columns",
    disclosure: "collapsed",
  },
  {
    id: "mobile-only",
    label: "Mobile Only",
    depth: 1,
    glyph: "columns",
    disclosure: "collapsed",
  },
  {
    id: "frame-root",
    label: "Frame",
    depth: 0,
    glyph: "frame",
    disclosure: "collapsed",
  },
];

const TOOLBAR_TOOLS = [
  { icon: IconPointer, active: true, hasSubTools: true },
  { icon: IconFrame, hasSubTools: true },
  { icon: IconSquare, hasSubTools: true },
  { icon: IconVectorBezier, hasSubTools: true },
  { icon: IconTypography },
  { icon: IconMessage },
];

const TOOLBAR_MODES = [
  { icon: IconScribble },
  { icon: IconTransformPoint, active: true },
  { icon: IconHandClick },
];

const EFFECT_ROWS = [
  "Drop shadow",
  "Drop shadow 2",
  "Drop shadow 3",
  "Drop shadow 4",
  "Drop shadow 5",
];

function WorkspaceRail() {
  return (
    <div className="dm-rail">
      <div className="dm-rail-project">
        <LogoMark className="dm-rail-project-mark" />
      </div>
      <div className="dm-rail-divider" />
      {RAIL_ITEMS.map(({ label, icon: Icon, active }) => (
        <div
          key={label}
          className={active ? "dm-rail-item is-active" : "dm-rail-item"}
        >
          <span className="dm-rail-icon">
            <Icon size={16} />
          </span>
          <span className="dm-rail-label">{label}</span>
        </div>
      ))}
    </div>
  );
}

function LayerTreeRow({ row }: { row: LayerRow }) {
  const Glyph = LAYER_GLYPHS[row.glyph];
  const classes = ["dm-layer"];
  if (row.selected) classes.push("is-selected");
  else if (row.activeScreen) classes.push("is-active");
  else if (row.ancestor) classes.push("is-ancestor");
  if (row.component) classes.push("is-component");

  return (
    <div className={classes.join(" ")}>
      {Array.from({ length: row.depth }, (_, index) => (
        <span key={index} className="dm-layer-indent" />
      ))}
      <span className="dm-layer-caret">
        {row.disclosure === "expanded" ? (
          <IconChevronDown size={16} />
        ) : row.disclosure === "collapsed" ? (
          <IconChevronRight size={16} />
        ) : null}
      </span>
      <Glyph size={16} className="dm-layer-glyph" />
      <span className="dm-layer-label">{row.label}</span>
    </div>
  );
}

function FilePanel() {
  return (
    <div className="dm-panel">
      <div className="dm-screens">
        <div className="dm-section-header">
          <span className="dm-section-title">Screens</span>
          <span className="dm-section-action">
            <IconPlus size={16} />
          </span>
        </div>
        <div className="dm-row">
          <IconLayoutGrid size={16} className="dm-row-glyph" />
          <span className="dm-row-label">All screens</span>
        </div>
        <div className="dm-row-divider" />
        <div className="dm-row is-active">
          <IconFile size={16} className="dm-row-glyph" />
          <span className="dm-row-label">Home</span>
        </div>
      </div>

      <div className="dm-layers">
        <div className="dm-section-header">
          <span className="dm-section-title">Layers</span>
          <span className="dm-section-actions">
            <span className="dm-section-action">
              <IconSearch size={16} />
            </span>
            <span className="dm-section-action">
              <IconListTree size={16} />
            </span>
          </span>
        </div>
        <div className="dm-layer-tree">
          {LAYER_ROWS.map((row) => (
            <LayerTreeRow key={row.id} row={row} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Inspector primitives. Sizes come from the editor's sidebar tokens: 24px
 * control height, 11px/16px control text, 10px/12px labels, 8px section
 * padding with an 8px row gap and a 4px control gap.
 * ------------------------------------------------------------------------- */

function NumField({
  label,
  glyph: Glyph,
  value,
  unit,
}: {
  label?: string;
  glyph?: typeof IconAngle;
  value: string;
  unit?: string;
}) {
  return (
    <span className="dm-num">
      {Glyph ? <Glyph size={12} className="dm-num-glyph" /> : null}
      {label ? <span className="dm-num-label">{label}</span> : null}
      <span className="dm-num-value">
        {value}
        {unit ? <span className="dm-num-unit">{unit}</span> : null}
      </span>
    </span>
  );
}

function SegmentedIcons({
  icons,
  activeIndex,
}: {
  icons: (typeof IconAngle)[];
  activeIndex: number;
}) {
  return (
    <span className="dm-seg-group">
      {icons.map((Icon, index) => (
        <span
          // Icon identity is the only distinguishing value in this static list.
          key={index}
          className={
            index === activeIndex ? "dm-seg-btn is-active" : "dm-seg-btn"
          }
        >
          <Icon size={14} />
        </span>
      ))}
    </span>
  );
}

function IconAction({
  glyph: Glyph,
  disabled,
}: {
  glyph: typeof IconAngle;
  disabled?: boolean;
}) {
  return (
    <span
      className={disabled ? "dm-icon-action is-disabled" : "dm-icon-action"}
    >
      <Glyph size={14} />
    </span>
  );
}

function Section({
  title,
  actions,
  first,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  first?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={first ? "dm-section is-first" : "dm-section"}>
      <div className="dm-section-bar">
        <IconChevronDown size={12} className="dm-section-chevron" />
        <span className="dm-section-label">{title}</span>
        {actions ? (
          <span className="dm-section-bar-actions">{actions}</span>
        ) : null}
      </div>
      <div className="dm-section-content">{children}</div>
    </div>
  );
}

function PaintRow({
  glyph: Glyph,
  swatch,
  label,
  opacity,
  hidden,
}: {
  glyph?: typeof IconAngle;
  swatch?: string;
  label: string;
  opacity?: string;
  hidden?: boolean;
}) {
  return (
    <span className="dm-paint">
      <span className="dm-paint-grip">
        <IconGridDots size={12} />
      </span>
      {swatch ? (
        <span
          className="dm-paint-swatch"
          style={{ background: `#${swatch}` }}
        />
      ) : Glyph ? (
        <Glyph size={14} className="dm-paint-glyph" />
      ) : null}
      <span className="dm-paint-label">{label}</span>
      {opacity ? <span className="dm-paint-opacity">{opacity}</span> : null}
      <IconAction glyph={hidden ? IconEyeOff : IconEye} />
      <IconAction glyph={IconMinus} />
    </span>
  );
}

function Inspector() {
  return (
    <div className="dm-inspector">
      <div className="dm-inspector-toprow">
        <div className="dm-collaborators">
          <span className="dm-avatar dm-avatar-1">PS</span>
          <span className="dm-avatar dm-avatar-2">TL</span>
          <span className="dm-avatar dm-avatar-3">ID</span>
        </div>
        <div className="dm-preview-btn">
          <IconPlayerPlay size={20} />
          <IconChevronDown size={12} />
        </div>
        <div className="dm-share-btn">Share</div>
      </div>

      <div className="dm-inspector-toprow">
        <div className="dm-segmented">
          <span className="dm-segment is-active">
            <IconViewportWide size={14} />
          </span>
          <span className="dm-segment">
            <IconDeviceMobile size={12} />
            <span>390</span>
          </span>
        </div>
        <span className="dm-section-action">
          <IconPlus size={16} />
        </span>
        <div className="dm-zoom">
          <span>40%</span>
          <IconChevronDown size={10} />
        </div>
      </div>

      <div className="dm-tabs">
        <span className="dm-tab is-active">Design</span>
        <span className="dm-tab">Comments</span>
        <span className="dm-tab">Tweaks</span>
      </div>

      <div className="dm-inspector-context">
        <IconComponents size={14} className="dm-context-glyph" />
        <span className="dm-context-title">button</span>
        <IconAction glyph={IconCode} />
      </div>

      <div className="dm-state">
        <span className="dm-state-control">
          <span className="dm-state-value">Default</span>
          <IconChevronDown size={14} className="dm-state-chevron" />
        </span>
      </div>

      <Section title="Position" first>
        <div className="dm-prop">
          <span className="dm-prop-label">Alignment</span>
          <div className="dm-prop-row">
            <SegmentedIcons
              icons={[
                IconLayoutAlignLeft,
                IconLayoutAlignCenter,
                IconLayoutAlignRight,
              ]}
              activeIndex={0}
            />
            <SegmentedIcons
              icons={[
                IconLayoutAlignTop,
                IconLayoutAlignMiddle,
                IconLayoutAlignBottom,
              ]}
              activeIndex={1}
            />
          </div>
        </div>
        <div className="dm-prop">
          <span className="dm-prop-label">Position</span>
          <div className="dm-prop-row">
            <NumField label="X" value="248" unit="px" />
            <NumField label="Y" value="235" unit="px" />
            <IconAction glyph={IconLayoutDistributeHorizontal} />
          </div>
        </div>
        <div className="dm-prop">
          <span className="dm-prop-label">Rotation</span>
          <div className="dm-prop-row">
            <NumField glyph={IconAngle} value="0" unit="deg" />
            <IconAction glyph={IconFlipHorizontal} />
            <IconAction glyph={IconFlipVertical} />
            <IconAction glyph={IconRotate3d} />
          </div>
        </div>
      </Section>

      <Section title="Layout">
        <div className="dm-prop-row">
          <NumField label="W" value="119.5" />
          <NumField label="H" value="48" unit="px" />
          <IconAction glyph={IconLink} />
        </div>
        <div className="dm-prop">
          <span className="dm-prop-label">Child</span>
          <div className="dm-prop-row">
            <NumField label="Grow" value="0" />
            <NumField label="Shrink" value="1" />
            <NumField label="Basis" value="auto" />
          </div>
        </div>
      </Section>

      <Section
        title="Appearance"
        actions={
          <>
            <IconAction glyph={IconEye} />
            <IconAction glyph={IconLayersIntersect} />
          </>
        }
      >
        <div className="dm-prop-row">
          <NumField label="Opacity" glyph={IconGridDots} value="100" unit="%" />
        </div>
        <div className="dm-prop-row">
          <NumField label="Corner radius" glyph={IconBorderRadius} value="10" />
          <IconAction glyph={IconBorderCorners} />
        </div>
      </Section>

      <Section
        title="Fill"
        actions={
          <>
            <IconAction glyph={IconLayoutGrid} />
            <IconAction glyph={IconPlus} />
          </>
        }
      >
        <PaintRow swatch="24221E" label="24221E" opacity="100%" />
      </Section>

      <Section
        title="Stroke"
        actions={
          <>
            <IconAction glyph={IconAdjustments} disabled />
            <IconAction glyph={IconSquare} disabled />
          </>
        }
      >
        <PaintRow swatch="7D4B13" label="7D4B13" opacity="100%" hidden />
        <div className="dm-prop-row">
          <NumField label="Position" value="Outside" />
          <NumField label="Weight" glyph={IconBorderStyle} value="2.9" />
        </div>
      </Section>

      <Section
        title="Effects"
        actions={
          <>
            <IconAction glyph={IconLayoutGrid} />
            <IconAction glyph={IconPlus} />
          </>
        }
      >
        <div className="dm-effects">
          {EFFECT_ROWS.map((effect) => (
            <PaintRow key={effect} glyph={IconSquare} label={effect} hidden />
          ))}
        </div>
      </Section>
    </div>
  );
}

function BottomToolbar() {
  return (
    <div className="dm-toolbar">
      {TOOLBAR_TOOLS.map(({ icon: Icon, active, hasSubTools }, index) => (
        <span
          // Icon identity is the only distinguishing value in this static list.
          key={index}
          className={active ? "dm-tool is-active" : "dm-tool"}
        >
          <Icon size={18} />
          {hasSubTools ? (
            <IconChevronDown size={12} className="dm-tool-caret" />
          ) : null}
        </span>
      ))}
      <span className="dm-toolbar-divider" />
      <span className="dm-mode-group">
        {TOOLBAR_MODES.map(({ icon: Icon, active }, index) => (
          <span
            key={index}
            className={active ? "dm-mode is-active" : "dm-mode"}
          >
            <Icon size={18} />
          </span>
        ))}
      </span>
    </div>
  );
}

function Canvas() {
  return (
    <div className="dm-canvas">
      <div className="dm-board">
        <div className="dm-frame dm-frame-desktop">
          <div className="dm-frame-label">
            <span className="dm-frame-label-text">Home</span>
            <span className="dm-interact-btn">
              <IconHandClick size={12} />
              Interact
            </span>
          </div>
          <div className="dm-frame-body">
            <div className="dm-artboard dm-artboard-desktop">
              <TaskerDesktopArtboard />
            </div>
          </div>
        </div>

        <div className="dm-frame dm-frame-mobile">
          <div className="dm-frame-label">
            <span className="dm-breakpoint-dot" />
            <span className="dm-frame-label-text">Mobile</span>
            <span className="dm-frame-label-width">390px</span>
          </div>
          <div className="dm-frame-body">
            <div className="dm-artboard dm-artboard-mobile">
              <TaskerMobileArtboard />
            </div>
          </div>
        </div>
      </div>
      <BottomToolbar />
    </div>
  );
}

const DESIGN_MOCK_CSS = [
  // Shell. The hero container sets the height; the window fills the padded box.
  ".design-mock { position: relative; width: 100%; padding: 0 40px 28px; overflow: hidden; }",
  ".design-mock, .design-mock * { box-sizing: border-box; }",
  ".design-mock-frame { position: relative; height: 100%; }",

  // Palette, mirroring templates/design/app/global.css. Dark by default; the
  // `html.light` block below swaps the whole mock when the docs shell is light.
  ".design-mock { --dm-panel-bg: hsl(0 0% 13%); --dm-panel-raised: hsl(0 0% 18%); --dm-divider: hsl(0 0% 22%); --dm-border: hsl(0 0% 24%); --dm-canvas-bg: hsl(0 0% 10%); --dm-fg: hsl(0 0% 90%); --dm-fg-muted: hsl(0 0% 60%); --dm-control-bg: hsl(0 0% 18%); --dm-active-row: hsl(0 0% 20%); --dm-selection: rgba(10, 154, 255, 0.24); --dm-accent: hsl(205 100% 53%); --dm-accent-contrast: #ffffff; --dm-component: hsl(263 88% 74%); --dm-component-selection: rgba(167, 116, 250, 0.28); --dm-component-subtree: rgba(167, 116, 250, 0.18); --dm-avatar-border: hsl(0 0% 13%); }",

  // Window
  ".design-mock .dm-window { position: absolute; inset: 0; display: flex; overflow: hidden; border-radius: 12px; border: 1px solid var(--dm-divider); background: var(--dm-panel-bg); color: var(--dm-fg); font-family: 'Inter Variable', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }",

  // Left icon rail — 64px, 48px buttons with a label under the glyph.
  `.design-mock .dm-rail { display: flex; width: ${RAIL_WIDTH}px; flex-shrink: 0; flex-direction: column; align-items: center; gap: 8px; padding: 8px 0; border-right: 1px solid var(--dm-divider); background: var(--dm-panel-bg); }`,
  ".design-mock .dm-rail-project { display: flex; width: 32px; height: 32px; align-items: center; justify-content: center; border-radius: 8px; background: var(--dm-control-bg); color: var(--dm-fg); }",
  ".design-mock .dm-rail-project-mark { width: 18px; height: auto; }",
  ".design-mock .dm-rail-divider { width: 32px; height: 1px; background: var(--dm-border); }",
  ".design-mock .dm-rail-item { display: flex; width: 48px; height: 48px; flex-direction: column; align-items: center; justify-content: center; gap: 4px; border-radius: 8px; color: var(--dm-fg-muted); }",
  ".design-mock .dm-rail-item.is-active { background: var(--dm-selection); color: var(--dm-fg); }",
  ".design-mock .dm-rail-item.is-active .dm-rail-icon { color: var(--dm-accent); }",
  ".design-mock .dm-rail-icon { display: flex; width: 24px; height: 24px; align-items: center; justify-content: center; }",
  ".design-mock .dm-rail-label { max-width: 100%; overflow: hidden; padding: 0 4px; font-size: 11px; font-weight: 450; line-height: 1; text-overflow: ellipsis; white-space: nowrap; }",

  // File panel — Screens above, Layers filling the rest.
  `.design-mock .dm-panel { display: flex; width: ${LEFT_PANEL_WIDTH}px; flex-shrink: 0; flex-direction: column; border-right: 1px solid var(--dm-divider); background: var(--dm-panel-bg); }`,
  ".design-mock .dm-screens { flex-shrink: 0; padding-bottom: 8px; border-bottom: 1px solid var(--dm-border); }",
  ".design-mock .dm-layers { display: flex; flex: 1; min-height: 0; flex-direction: column; }",
  ".design-mock .dm-section-header { display: flex; height: 40px; flex-shrink: 0; align-items: center; justify-content: space-between; padding: 0 12px; }",
  ".design-mock .dm-section-title { font-size: 12px; font-weight: 600; }",
  ".design-mock .dm-section-actions { display: flex; align-items: center; gap: 2px; }",
  ".design-mock .dm-section-action { display: flex; width: 24px; height: 24px; align-items: center; justify-content: center; color: var(--dm-fg-muted); }",
  ".design-mock .dm-row { display: flex; height: 32px; align-items: center; gap: 8px; margin: 0 8px; padding: 0 8px; border-radius: 5px; font-size: 12px; font-weight: 600; color: var(--dm-fg); }",
  ".design-mock .dm-row.is-active { background: var(--dm-active-row); }",
  ".design-mock .dm-row-glyph { flex-shrink: 0; color: var(--dm-fg-muted); }",
  ".design-mock .dm-row-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
  ".design-mock .dm-row-divider { margin: 8px 12px; border-top: 1px solid var(--dm-border); }",

  // Layer tree. Indentation is real 16px slots, so the deepest rows truncate
  // their label exactly the way the real panel does at this width.
  ".design-mock .dm-layer-tree { flex: 1; min-height: 0; overflow: hidden; padding: 8px; }",
  ".design-mock .dm-layer { display: flex; height: 32px; align-items: center; gap: 8px; padding-right: 4px; border-radius: 5px; color: var(--dm-fg); }",
  ".design-mock .dm-layer.is-active { background: var(--dm-active-row); }",
  ".design-mock .dm-layer.is-ancestor { background: var(--dm-component-subtree); }",
  ".design-mock .dm-layer.is-selected { background: var(--dm-component-selection); }",
  ".design-mock .dm-layer.is-component .dm-layer-glyph, .design-mock .dm-layer.is-component .dm-layer-label { color: var(--dm-component); }",
  ".design-mock .dm-layer.is-selected .dm-layer-label { color: var(--dm-fg); }",
  ".design-mock .dm-layer-indent { width: 16px; flex-shrink: 0; }",
  ".design-mock .dm-layer-indent + .dm-layer-indent { margin-left: -8px; }",
  ".design-mock .dm-layer-caret { display: flex; width: 16px; flex-shrink: 0; align-items: center; justify-content: center; color: var(--dm-fg-muted); }",
  ".design-mock .dm-layer-glyph { flex-shrink: 0; color: var(--dm-fg-muted); }",
  ".design-mock .dm-layer-label { min-width: 0; overflow: hidden; font-size: 12px; font-weight: 400; line-height: 16px; text-overflow: ellipsis; white-space: nowrap; }",

  // Canvas
  ".design-mock .dm-canvas { position: relative; flex: 1; min-width: 0; overflow: hidden; background: var(--dm-canvas-bg); }",
  `.design-mock .dm-board { position: absolute; left: 16px; top: 24px; width: ${MOBILE_FRAME_X + MOBILE_FRAME_WIDTH}px; }`,

  // Screen frames. Square corners are intentional: the real editor avoids a
  // card radius because it would read as a document corner radius.
  ".design-mock .dm-frame { position: absolute; top: 0; }",
  `.design-mock .dm-frame-desktop { left: 0; width: ${DESKTOP_FRAME_WIDTH}px; }`,
  `.design-mock .dm-frame-mobile { left: ${MOBILE_FRAME_X}px; width: ${MOBILE_FRAME_WIDTH}px; }`,
  `.design-mock .dm-frame-label { position: relative; display: flex; height: ${FRAME_LABEL_HEIGHT}px; align-items: center; gap: 6px; padding-left: 4px; color: var(--dm-fg-muted); }`,
  ".design-mock .dm-frame-label-text { min-width: 0; overflow: hidden; font-size: 11px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }",
  ".design-mock .dm-frame-label-width { flex-shrink: 0; font-size: 10px; font-variant-numeric: tabular-nums; opacity: 0.5; }",
  ".design-mock .dm-breakpoint-dot { width: 6px; height: 6px; flex-shrink: 0; border-radius: 999px; background: currentColor; }",
  ".design-mock .dm-interact-btn { position: absolute; right: 4px; top: 50%; display: flex; height: 20px; align-items: center; gap: 4px; transform: translateY(-50%); padding: 0 6px; border: 1px solid var(--dm-border); border-radius: 6px; background: var(--dm-panel-bg); color: var(--dm-fg); font-size: 10px; font-weight: 500; }",
  ".design-mock .dm-frame-body { position: relative; overflow: hidden; background: #ffffff; box-shadow: inset 0 0 0 1px var(--dm-border); }",
  `.design-mock .dm-frame-desktop .dm-frame-body { height: ${DESKTOP_FRAME_HEIGHT}px; }`,
  `.design-mock .dm-frame-mobile .dm-frame-body { height: ${MOBILE_FRAME_HEIGHT}px; }`,
  `.design-mock .dm-artboard { transform: scale(${BOARD_SCALE}); transform-origin: top left; }`,
  `.design-mock .dm-artboard-desktop { width: ${DESKTOP_ARTBOARD_WIDTH}px; height: ${DESKTOP_ARTBOARD_HEIGHT}px; }`,
  `.design-mock .dm-artboard-mobile { width: ${MOBILE_ARTBOARD_WIDTH}px; height: ${MOBILE_ARTBOARD_HEIGHT}px; }`,

  // Right inspector — 240px. Overflow is hidden so the tail of the property
  // list crops mid-section, the way a real scrolled panel reads.
  `.design-mock .dm-inspector { display: flex; width: ${INSPECTOR_WIDTH}px; flex-shrink: 0; flex-direction: column; overflow: hidden; border-left: 1px solid var(--dm-divider); background: var(--dm-panel-bg); }`,
  ".design-mock .dm-inspector-toprow { display: flex; height: 40px; flex-shrink: 0; align-items: center; gap: 6px; padding: 0 8px; }",
  ".design-mock .dm-collaborators { display: flex; height: 32px; align-items: center; padding-right: 4px; }",
  ".design-mock .dm-avatar { display: flex; width: 28px; height: 28px; align-items: center; justify-content: center; border: 2px solid var(--dm-avatar-border); border-radius: 999px; color: #ffffff; font-size: 10px; font-weight: 600; }",
  ".design-mock .dm-avatar + .dm-avatar { margin-left: -8px; }",
  ".design-mock .dm-avatar-1 { background: #7c6ff0; }",
  ".design-mock .dm-avatar-2 { background: #2f9e6d; }",
  ".design-mock .dm-avatar-3 { background: #c9613f; }",
  ".design-mock .dm-preview-btn { display: flex; height: 32px; align-items: center; gap: 2px; margin-left: auto; padding: 0 8px; border-radius: 6px; color: var(--dm-fg); }",
  ".design-mock .dm-share-btn { display: flex; height: 32px; align-items: center; padding: 0 12px; border-radius: 6px; background: var(--dm-accent); color: var(--dm-accent-contrast); font-size: 14px; font-weight: 500; }",
  ".design-mock .dm-segmented { display: flex; align-items: center; gap: 2px; padding: 2px; border-radius: 6px; background: var(--dm-control-bg); }",
  ".design-mock .dm-segment { display: flex; height: 24px; align-items: center; gap: 4px; padding: 0 6px; border-radius: 5px; color: var(--dm-fg-muted); font-size: 11px; font-weight: 500; font-variant-numeric: tabular-nums; }",
  ".design-mock .dm-segment.is-active { background: var(--dm-panel-bg); color: var(--dm-accent); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18); }",
  ".design-mock .dm-zoom { display: flex; height: 24px; align-items: center; gap: 2px; margin-left: auto; padding: 0 4px; color: var(--dm-fg-muted); font-size: 10px; font-variant-numeric: tabular-nums; }",

  // Inspector tabs. The real control is a pill row, not an underline.
  ".design-mock .dm-tabs { display: flex; height: 32px; flex-shrink: 0; align-items: center; gap: 2px; padding: 0 8px; border-bottom: 1px solid var(--dm-border); }",
  ".design-mock .dm-tab { display: flex; height: 24px; align-items: center; padding: 0 8px; border-radius: 6px; color: var(--dm-fg-muted); font-size: 11px; font-weight: 600; }",
  ".design-mock .dm-tab.is-active { background: var(--dm-panel-raised); color: var(--dm-fg); }",

  ".design-mock .dm-inspector-context { display: flex; min-height: 32px; flex-shrink: 0; align-items: center; gap: 6px; padding: 0 8px 0 12px; border-bottom: 1px solid var(--dm-border); }",
  ".design-mock .dm-context-glyph { flex-shrink: 0; color: var(--dm-component); }",
  ".design-mock .dm-context-title { flex: 1; min-width: 0; overflow: hidden; font-size: 13px; font-weight: 600; line-height: 16px; text-overflow: ellipsis; white-space: nowrap; }",

  ".design-mock .dm-state { flex-shrink: 0; padding: 4px 8px; }",
  ".design-mock .dm-state-control { display: flex; height: 28px; align-items: center; justify-content: space-between; padding: 0 8px; border: 1px solid var(--dm-border); border-radius: 6px; background: var(--dm-control-bg); }",
  ".design-mock .dm-state-value { font-size: 11px; font-weight: 600; }",
  ".design-mock .dm-state-chevron { flex-shrink: 0; opacity: 0.7; }",

  // Property sections. The top shadow is the divider, matching
  // `.design-sidebar-section` in the editor stylesheet.
  ".design-mock .dm-section { flex-shrink: 0; box-shadow: inset 0 1px var(--dm-border); }",
  ".design-mock .dm-section.is-first { box-shadow: none; }",
  ".design-mock .dm-section-bar { display: flex; height: 32px; align-items: center; gap: 4px; padding: 0 8px; }",
  ".design-mock .dm-section-chevron { flex-shrink: 0; color: var(--dm-fg-muted); }",
  ".design-mock .dm-section-label { flex: 1; min-width: 0; font-size: 11px; font-weight: 600; }",
  ".design-mock .dm-section-bar-actions { display: flex; flex-shrink: 0; align-items: center; gap: 2px; }",
  ".design-mock .dm-section-content { display: flex; flex-direction: column; gap: 6px; padding: 0 8px 8px; }",
  ".design-mock .dm-prop { display: flex; min-width: 0; flex-direction: column; gap: 4px; }",
  ".design-mock .dm-prop-label { color: var(--dm-fg-muted); font-size: 10px; font-weight: 400; line-height: 12px; }",
  ".design-mock .dm-prop-row { display: flex; min-width: 0; align-items: center; gap: 4px; }",

  ".design-mock .dm-num { display: flex; height: 24px; min-width: 0; flex: 1; align-items: center; gap: 4px; padding: 0 6px; border: 1px solid var(--dm-border); border-radius: 6px; background: var(--dm-control-bg); }",
  ".design-mock .dm-num-glyph { flex-shrink: 0; color: var(--dm-fg-muted); }",
  ".design-mock .dm-num-label { flex-shrink: 0; overflow: hidden; color: var(--dm-fg-muted); font-size: 10px; line-height: 12px; text-overflow: ellipsis; white-space: nowrap; }",
  ".design-mock .dm-num-value { min-width: 0; overflow: hidden; font-size: 11px; line-height: 16px; font-variant-numeric: tabular-nums; text-overflow: ellipsis; white-space: nowrap; }",
  ".design-mock .dm-num-unit { color: var(--dm-fg-muted); }",

  ".design-mock .dm-seg-group { display: flex; flex: 1; min-width: 0; align-items: center; gap: 2px; padding: 2px; border-radius: 6px; background: var(--dm-control-bg); }",
  ".design-mock .dm-seg-btn { display: flex; height: 24px; flex: 1; align-items: center; justify-content: center; border-radius: 5px; color: var(--dm-fg-muted); }",
  ".design-mock .dm-seg-btn.is-active { background: var(--dm-panel-raised); color: var(--dm-fg); }",
  ".design-mock .dm-icon-action { display: flex; width: 24px; height: 24px; flex-shrink: 0; align-items: center; justify-content: center; border-radius: 6px; color: var(--dm-fg-muted); }",
  ".design-mock .dm-icon-action.is-disabled { opacity: 0.35; }",

  ".design-mock .dm-paint { display: flex; height: 24px; align-items: center; gap: 4px; }",
  ".design-mock .dm-paint-grip { display: flex; width: 24px; height: 24px; flex-shrink: 0; align-items: center; justify-content: center; color: var(--dm-fg-muted); opacity: 0.6; }",
  ".design-mock .dm-paint-swatch { width: 16px; height: 16px; flex-shrink: 0; border-radius: 3px; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12); }",
  ".design-mock .dm-paint-glyph { flex-shrink: 0; color: var(--dm-fg-muted); }",
  ".design-mock .dm-paint-label { flex: 1; min-width: 0; overflow: hidden; font-size: 11px; font-weight: 500; line-height: 16px; text-overflow: ellipsis; white-space: nowrap; }",
  ".design-mock .dm-paint-opacity { flex-shrink: 0; color: var(--dm-fg-muted); font-size: 11px; font-variant-numeric: tabular-nums; }",
  ".design-mock .dm-effects { display: flex; flex-direction: column; gap: 6px; }",

  // Floating bottom toolbar. Pinned to the dark palette in both themes, exactly
  // like the real toolbar.
  ".design-mock .dm-toolbar { position: absolute; bottom: 16px; left: 50%; z-index: 3; display: flex; max-width: calc(100% - 32px); transform: translateX(-50%); align-items: center; gap: 4px; padding: 6px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; background: rgba(44, 44, 44, 0.95); color: #f5f5f5; box-shadow: 0 22px 55px -24px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(0, 0, 0, 0.25); backdrop-filter: blur(8px); }",
  ".design-mock .dm-tool { display: flex; height: 32px; flex-shrink: 0; align-items: center; justify-content: center; gap: 1px; padding: 0 4px; border-radius: 6px; color: #e5e5e5; }",
  ".design-mock .dm-tool.is-active { background: var(--dm-accent); color: #ffffff; }",
  ".design-mock .dm-tool-caret { opacity: 0.7; }",
  ".design-mock .dm-toolbar-divider { width: 1px; height: 36px; flex-shrink: 0; margin: 0 2px; background: rgba(255, 255, 255, 0.15); }",
  ".design-mock .dm-mode-group { display: flex; flex-shrink: 0; align-items: center; gap: 2px; padding: 2px; border-radius: 6px; background: rgba(255, 255, 255, 0.1); }",
  ".design-mock .dm-mode { display: flex; width: 32px; height: 32px; align-items: center; justify-content: center; border-radius: 6px; color: #d4d4d4; }",
  ".design-mock .dm-mode.is-active { background: rgba(3, 3, 3, 0.7); color: #38bdf8; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08), 0 8px 18px -12px rgba(0, 0, 0, 0.95); }",

  DESIGN_TASKER_CSS,

  // Light mode. The docs shell puts `light`/`dark` on <html>, so the mock
  // follows the visitor's theme instead of staying pinned to the dark art.
  "html.light .design-mock { --dm-panel-bg: hsl(0 0% 100%); --dm-panel-raised: hsl(0 0% 95%); --dm-divider: hsl(0 0% 90%); --dm-border: hsl(0 0% 90%); --dm-canvas-bg: hsl(0 0% 92%); --dm-fg: hsl(0 0% 10%); --dm-fg-muted: hsl(0 0% 45%); --dm-control-bg: hsl(0 0% 95%); --dm-active-row: rgba(38, 38, 38, 0.08); --dm-selection: rgba(10, 154, 255, 0.14); --dm-component: hsl(263 84% 64%); --dm-component-selection: rgba(124, 77, 240, 0.16); --dm-component-subtree: rgba(124, 77, 240, 0.1); --dm-avatar-border: hsl(0 0% 100%); }",
  "html.light .design-mock .dm-paint-swatch { box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12); }",

  // Narrow screens. The window is a fixed-width layout, so the whole mock
  // scales down and anchors to the left edge rather than letting the canvas
  // collapse to nothing. This block stays last: it has the same specificity as
  // the base rules above and would otherwise lose to them on source order.
  "@media (max-width: 860px) { .design-mock { padding: 0 16px 18px; } .design-mock .dm-window { width: 1180px; height: 660px; inset: auto; transform: scale(0.52); transform-origin: top left; } }",
].join("\n");

export function DesignOverviewMock({
  className = "",
  label,
}: {
  className?: string;
  label?: string;
}) {
  return (
    <div className={`design-mock ${className}`} role="img" aria-label={label}>
      <style>{DESIGN_MOCK_CSS}</style>
      <div className="design-mock-frame" aria-hidden="true">
        <div className="dm-window">
          <WorkspaceRail />
          <FilePanel />
          <Canvas />
          <Inspector />
        </div>
      </div>
    </div>
  );
}
