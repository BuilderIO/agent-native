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

// Runs in <head> before the first paint, so the server-rendered shell takes
// the saved width, or the collapsed rail, without waiting for the app.
export const CONTENT_STARTUP_SIDEBAR_SCRIPT = `(function(){try{var r=document.documentElement,s=window.localStorage,w=Number(s.getItem(${JSON.stringify(
  SIDEBAR_WIDTH_KEY,
)}));if(s.getItem(${JSON.stringify(
  SIDEBAR_COLLAPSED_KEY,
)})==="true"){r.setAttribute(${JSON.stringify(
  STARTUP_SIDEBAR_COLLAPSED_ATTRIBUTE,
)},"");w=${COLLAPSED_SIDEBAR_WIDTH}}else if(!(w>=${MIN_SIDEBAR_WIDTH}&&w<=${MAX_SIDEBAR_WIDTH})){return}r.style.setProperty(${JSON.stringify(
  STARTUP_SIDEBAR_WIDTH_PROPERTY,
)},w+"px")}catch(e){}})();`;
