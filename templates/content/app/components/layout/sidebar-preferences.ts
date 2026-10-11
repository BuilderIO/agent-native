// Where the desktop sidebar keeps its width and collapsed state. The startup
// shell reads the same keys before the app loads so the sidebar it draws is
// the one the app will draw.

export const SIDEBAR_WIDTH_KEY = "sidebar-width";
export const SIDEBAR_COLLAPSED_KEY = "content.sidebar.collapsed";
export const DEFAULT_SIDEBAR_WIDTH = 240;
export const MIN_SIDEBAR_WIDTH = 240;
export const MAX_SIDEBAR_WIDTH = 480;
// The collapsed sidebar's `w-14`.
export const COLLAPSED_SIDEBAR_WIDTH = 56;

export const STARTUP_SIDEBAR_WIDTH_PROPERTY = "--content-startup-sidebar-width";
export const STARTUP_SIDEBAR_COLLAPSED_ATTRIBUTE =
  "data-content-sidebar-collapsed";
export const STARTUP_SIDEBAR_DRAWER_ATTRIBUTE = "data-content-sidebar-drawer";
