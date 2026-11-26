export const THEME_FAMILY_PENDING_ATTRIBUTE = "data-theme-family-pending";

export function themeFamilyPrepaintScript(): string {
  return `(function(){var root=document.documentElement;if(root.hasAttribute('data-theme-family-status'))root.setAttribute(${JSON.stringify(THEME_FAMILY_PENDING_ATTRIBUTE)},'true')})();`;
}

export const THEME_FAMILY_PREPAINT_STYLE = `html[${THEME_FAMILY_PENDING_ATTRIBUTE}="true"] body{visibility:hidden}`;
