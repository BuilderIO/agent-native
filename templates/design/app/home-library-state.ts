export type DesignHomeLibraryTab = "templates" | "recent";

export interface DesignHomeLibraryInitialState {
  tab: DesignHomeLibraryTab;
  userSelected: boolean;
}

const HOME_LIBRARY_HAS_RECENTS_STORAGE_KEY = "design-home-has-recents";
const HOME_LIBRARY_TAB_ATTRIBUTE = "data-design-home-library-tab";
const HOME_LIBRARY_TAB_CHANGE_EVENT = "design-home-library-tab-change";

export const DESIGN_HOME_LIBRARY_TAB_HANDOFF_INIT_SCRIPT = `document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const tab = event.target.closest("[data-design-home-library-tab]")?.getAttribute("data-design-home-library-tab");
  if (tab === "templates" || tab === "recent") {
    document.documentElement.setAttribute("${HOME_LIBRARY_TAB_ATTRIBUTE}", tab);
  }
}, true);`;

export function readHomeLibraryHasRecents():
  | { status: "available"; value: boolean | null }
  | { status: "unavailable" } {
  if (typeof window === "undefined") return { status: "unavailable" };

  try {
    const value = window.localStorage.getItem(
      HOME_LIBRARY_HAS_RECENTS_STORAGE_KEY,
    );
    return {
      status: "available",
      value: value === "true" ? true : value === "false" ? false : null,
    };
  } catch {
    return { status: "unavailable" };
  }
}

export function writeHomeLibraryHasRecents(
  value: boolean,
): { status: "available" } | { status: "unavailable" } {
  if (typeof window === "undefined") return { status: "unavailable" };
  try {
    window.localStorage.setItem(
      HOME_LIBRARY_HAS_RECENTS_STORAGE_KEY,
      String(value),
    );
    return { status: "available" };
  } catch {
    return { status: "unavailable" };
  }
}

export function readDesignHomeLibraryInitialState(
  isSaveTemplateGettingStarted: boolean,
): DesignHomeLibraryInitialState {
  if (isSaveTemplateGettingStarted) {
    return { tab: "recent", userSelected: false };
  }

  if (typeof document !== "undefined") {
    const shellSelection = document.documentElement.getAttribute(
      HOME_LIBRARY_TAB_ATTRIBUTE,
    );
    if (shellSelection === "templates" || shellSelection === "recent") {
      return { tab: shellSelection, userSelected: true };
    }
  }

  const storedHasAccessibleDesigns = readHomeLibraryHasRecents();
  return {
    tab:
      storedHasAccessibleDesigns.status === "available" &&
      storedHasAccessibleDesigns.value === true
        ? "recent"
        : "templates",
    userSelected: false,
  };
}

export function setDesignHomeLibraryTab(tab: DesignHomeLibraryTab): void {
  if (typeof document === "undefined" || typeof window === "undefined") return;

  document.documentElement.setAttribute(HOME_LIBRARY_TAB_ATTRIBUTE, tab);
  window.dispatchEvent(
    new CustomEvent<DesignHomeLibraryTab>(HOME_LIBRARY_TAB_CHANGE_EVENT, {
      detail: tab,
    }),
  );
}

export function clearDesignHomeLibraryTabSelection(): void {
  if (typeof document === "undefined") return;
  document.documentElement.removeAttribute(HOME_LIBRARY_TAB_ATTRIBUTE);
}

export function subscribeToDesignHomeLibraryTab(
  onChange: (tab: DesignHomeLibraryTab) => void,
): () => void {
  const handleChange = (event: Event) => {
    const tab: unknown = (event as CustomEvent<unknown>).detail;
    if (tab === "templates" || tab === "recent") onChange(tab);
  };

  window.addEventListener(HOME_LIBRARY_TAB_CHANGE_EVENT, handleChange);
  return () =>
    window.removeEventListener(HOME_LIBRARY_TAB_CHANGE_EVENT, handleChange);
}
