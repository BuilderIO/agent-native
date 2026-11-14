import { useContext } from "react";
import { UNSAFE_DataRouterStateContext } from "react-router";

/**
 * The languages the current page exists in, when its route lists them (a
 * translated use-case page). Undefined for every other page, and outside the
 * site's data router (component tests), where no route has loaded data.
 */
export function usePageLocales(): readonly string[] | undefined {
  const state = useContext(UNSAFE_DataRouterStateContext);
  if (!state) return undefined;
  for (const match of [...state.matches].reverse()) {
    const locales = (
      state.loaderData[match.route.id] as { locales?: unknown } | undefined
    )?.locales;
    if (Array.isArray(locales)) return locales as string[];
  }
  return undefined;
}
