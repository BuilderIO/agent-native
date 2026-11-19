import {
  COLLAPSED_SIDEBAR_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  SIDEBAR_COLLAPSED_KEY,
  SIDEBAR_WIDTH_KEY,
  STARTUP_SIDEBAR_COLLAPSED_ATTRIBUTE,
  STARTUP_SIDEBAR_DRAWER_ATTRIBUTE,
  STARTUP_SIDEBAR_WIDTH_PROPERTY,
} from "./sidebar-preferences";

// How Content shares the window between the left sidebar, the page with its
// comments, and the panel beside it. The page keeps a readable text column:
// the sidebar gives way first (docked, then the rail, then a drawer), then
// comments leave the margin for cards on the text. Off a document page the
// agent docks when the rest of the window can hold that column; otherwise the
// toolkit draws it over the page. On a document page the agent shares the
// page's own panel, which never moves the sidebar: it docks in what the page
// has left, or covers the page.

// The text column, padding included, that every layout keeps.
export const CONTENT_TEXT_MIN_WIDTH = 560;
// The comment lane is `w-80`.
export const CONTENT_COMMENT_SURFACE_WIDTH = 320;
// A document page's panel, and the window that gets the wider one.
export const CONTENT_PANEL_WIDTH = 380;
export const CONTENT_PANEL_WIDE_WIDTH = 400;
export const CONTENT_PANEL_WIDE_VIEWPORT = 1440;
// Under this window the panel is a full-width sheet.
export const CONTENT_SHEET_MAX_WIDTH = 599;
// The toolkit's `(max-width: 767px)` agent panel overlay.
export const CONTENT_PHONE_MAX_WIDTH = 767;
// A mode already on screen holds this far past its threshold, so a window
// dragged across one settles instead of flickering.
export const CONTENT_LAYOUT_HYSTERESIS = 24;

export type ContentSidebarMode = "docked" | "rail" | "drawer";
export type ContentAgentPanelMode = "closed" | "docked" | "overlay";
export type ContentCommentMargin = "lane" | "anchored";
export type ContentPanelMode = "dock" | "over" | "sheet";

export interface ContentCommentSurfaces {
  /** Open threads beside the text: the margin lane, or a card on the text. */
  margin: ContentCommentMargin;
}

export interface ContentPanelLayout {
  mode: ContentPanelMode;
  width: number;
}

export interface ContentLayout {
  sidebar: ContentSidebarMode;
  /** The sidebar is narrower than the user chose. Space decides this; it is never saved. */
  sidebarAutoCollapsed: boolean;
  agentPanel: ContentAgentPanelMode;
  comments: ContentCommentSurfaces;
}

export interface ContentLayoutInput {
  viewportWidth: number;
  /** The user's saved sidebar preference. */
  sidebar: { collapsed: boolean; width: number };
  /** `width` is the panel's target width, not its animated one. */
  agentPanel: { open: boolean; width: number };
  previous?: ContentLayout | null;
}

function fits(space: number, needed: number, held: boolean) {
  return space >= needed - (held ? CONTENT_LAYOUT_HYSTERESIS : 0);
}

export function contentAgentPanelMode(
  input: Pick<ContentLayoutInput, "viewportWidth" | "agentPanel">,
): ContentAgentPanelMode {
  if (!input.agentPanel.open) return "closed";
  return input.viewportWidth > CONTENT_PHONE_MAX_WIDTH &&
    input.viewportWidth - input.agentPanel.width >= CONTENT_TEXT_MIN_WIDTH
    ? "docked"
    : "overlay";
}

/** The width left for Content's sidebar and page beside a docked agent panel. */
export function contentAvailableWidth(
  input: Pick<ContentLayoutInput, "viewportWidth" | "agentPanel">,
) {
  return contentAgentPanelMode(input) === "docked"
    ? input.viewportWidth - input.agentPanel.width
    : input.viewportWidth;
}

export function contentSidebarWidth(
  mode: ContentSidebarMode,
  sidebar: ContentLayoutInput["sidebar"],
) {
  if (mode === "docked") return sidebar.width;
  return mode === "rail" ? COLLAPSED_SIDEBAR_WIDTH : 0;
}

/** The target width of the page beside the sidebar and a docked agent panel. */
export function contentPageWidth(
  input: Pick<ContentLayoutInput, "viewportWidth" | "agentPanel" | "sidebar">,
  sidebar: ContentSidebarMode,
) {
  return (
    contentAvailableWidth(input) - contentSidebarWidth(sidebar, input.sidebar)
  );
}

export function resolveContentSidebar(
  availableWidth: number,
  sidebar: ContentLayoutInput["sidebar"],
  previous?: ContentSidebarMode | null,
): ContentSidebarMode {
  if (
    !sidebar.collapsed &&
    fits(
      availableWidth - sidebar.width,
      CONTENT_TEXT_MIN_WIDTH,
      previous === "docked",
    )
  ) {
    return "docked";
  }
  return fits(
    availableWidth - COLLAPSED_SIDEBAR_WIDTH,
    CONTENT_TEXT_MIN_WIDTH,
    previous === "docked" || previous === "rail",
  )
    ? "rail"
    : "drawer";
}

/**
 * Comment surfaces for a page of `pageWidth`. The editor row measures this
 * itself when it is not the app's page, as in a database row preview.
 */
export function resolveCommentSurfaces({
  pageWidth,
  previous,
}: {
  pageWidth: number;
  previous?: ContentCommentSurfaces | null;
}): ContentCommentSurfaces {
  const needed = CONTENT_TEXT_MIN_WIDTH + CONTENT_COMMENT_SURFACE_WIDTH;
  return {
    margin: fits(pageWidth, needed, previous?.margin === "lane")
      ? "lane"
      : "anchored",
  };
}

/**
 * The panel for a page row `rowWidth` wide. Every width has exactly one mode,
 * with no hold past a threshold: opening is a choice, not a window dragged
 * across one, and the panel's mode must not depend on how the window got here.
 */
export function resolveContentPanel({
  rowWidth,
  viewportWidth,
}: {
  rowWidth: number;
  viewportWidth: number;
}): ContentPanelLayout {
  const width =
    viewportWidth >= CONTENT_PANEL_WIDE_VIEWPORT
      ? CONTENT_PANEL_WIDE_WIDTH
      : CONTENT_PANEL_WIDTH;
  if (viewportWidth <= CONTENT_SHEET_MAX_WIDTH) {
    return { mode: "sheet", width };
  }
  return {
    mode: rowWidth - width >= CONTENT_TEXT_MIN_WIDTH ? "dock" : "over",
    width,
  };
}

export function sameContentPanelLayout(
  left: ContentPanelLayout,
  right: ContentPanelLayout,
) {
  return left.mode === right.mode && left.width === right.width;
}

export function resolveContentLayout(input: ContentLayoutInput): ContentLayout {
  const agentPanel = contentAgentPanelMode(input);
  const sidebar = resolveContentSidebar(
    contentAvailableWidth(input),
    input.sidebar,
    input.previous?.sidebar,
  );
  return {
    sidebar,
    sidebarAutoCollapsed:
      sidebar === "drawer" || (sidebar === "rail" && !input.sidebar.collapsed),
    agentPanel,
    comments: resolveCommentSurfaces({
      pageWidth:
        contentPageWidth(input, sidebar) -
        (agentPanel === "overlay" ? input.agentPanel.width : 0),
      previous: input.previous?.comments,
    }),
  };
}

export function sameContentCommentSurfaces(
  left: ContentCommentSurfaces,
  right: ContentCommentSurfaces,
) {
  return left.margin === right.margin;
}

export function sameContentLayout(left: ContentLayout, right: ContentLayout) {
  return (
    left.sidebar === right.sidebar &&
    left.sidebarAutoCollapsed === right.sidebarAutoCollapsed &&
    left.agentPanel === right.agentPanel &&
    sameContentCommentSurfaces(left.comments, right.comments)
  );
}

// Runs in <head> before the first paint and marks <html> with the sidebar
// `resolveContentSidebar` draws beside a closed agent panel: the saved width,
// the rail, or a drawer. The startup shell has no agent panel, so it is the
// sidebar the app draws when the panel starts closed.
export const CONTENT_STARTUP_SIDEBAR_SCRIPT = `(function(){var r=document.documentElement,c=false,w=NaN;try{var s=window.localStorage;c=s.getItem(${JSON.stringify(
  SIDEBAR_COLLAPSED_KEY,
)})==="true";w=Number(s.getItem(${JSON.stringify(
  SIDEBAR_WIDTH_KEY,
  // coercion-ok: without storage the shell draws the default expanded sidebar.
)}))}catch(e){}if(!(w>=${MIN_SIDEBAR_WIDTH}&&w<=${MAX_SIDEBAR_WIDTH}))w=${DEFAULT_SIDEBAR_WIDTH};var v=window.innerWidth;if(!c&&v-w>=${CONTENT_TEXT_MIN_WIDTH}){r.style.setProperty(${JSON.stringify(
  STARTUP_SIDEBAR_WIDTH_PROPERTY,
)},w+"px");return}if(v-${COLLAPSED_SIDEBAR_WIDTH}>=${CONTENT_TEXT_MIN_WIDTH}){r.setAttribute(${JSON.stringify(
  STARTUP_SIDEBAR_COLLAPSED_ATTRIBUTE,
)},"");r.style.setProperty(${JSON.stringify(
  STARTUP_SIDEBAR_WIDTH_PROPERTY,
)},"${COLLAPSED_SIDEBAR_WIDTH}px");return}r.setAttribute(${JSON.stringify(
  STARTUP_SIDEBAR_DRAWER_ATTRIBUTE,
)},"")})();`;
