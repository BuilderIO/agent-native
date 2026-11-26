import { useEffect } from "react";

// A page that writes its own `<title>` pins whatever string it was given, often a placeholder
// ("App", "Workspace"), so two open tabs cannot be told apart and the tab never names the
// signed-in workspace. `documentTitle` builds "<Page> - <workspace>" (and
// "<Object> | <View> - <workspace>" for a view), or the workspace name alone with no page name.
// Each app keeps its own route -> page-name map; the workspace half is the identity the person is
// signed into, never a hardcoded brand.
const TITLE_SEQUENCE = " | ";
const TITLE_SUFFIX = " - ";

export function documentTitle(
  parts: (string | null | undefined)[],
  workspaceName: string | null | undefined,
): string {
  const named = parts
    .map((part) => (part ?? "").trim())
    .filter((part) => part.length > 0);
  const head = named.join(TITLE_SEQUENCE);
  const suffix = (workspaceName ?? "").trim();
  if (!head) return suffix;
  return suffix ? `${head}${TITLE_SUFFIX}${suffix}` : head;
}

export function useDocumentTitle(
  parts: (string | null | undefined)[],
  workspaceName: string | null | undefined,
  // A record page names itself once its view resolves, so the shell must not claim the tab with a
  // bare suffix in the meantime: on mount the parent's effect runs last and would overwrite the
  // record page's own title. `false` leaves the tab to the child that owns it.
  enabled = true,
) {
  const title = enabled ? documentTitle(parts, workspaceName) : "";
  useEffect(() => {
    if (title && document.title !== title) document.title = title;
  }, [title]);
}
