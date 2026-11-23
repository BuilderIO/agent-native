export type PageRouteClass =
  | "/data"
  | "/home/data"
  | "/home"
  | "/sign-in"
  | "unknown";
export type PlaywrightFailureClass =
  | "intercepted-pointer"
  | "locator-unavailable"
  | "closed"
  | "other";
export type DataBrowserState =
  | {
      outcome: "observed";
      route: PageRouteClass;
      tabs: string[];
      loader: boolean;
      alert: boolean;
      dialogCount: number;
    }
  | { outcome: "timeout" | "unreadable"; route: PageRouteClass };

export interface DataBrowserPage {
  url(): string;
  evaluate<T>(fn: () => T): Promise<T>;
}

const knownTabs = [
  "Recommended",
  "Warehouse",
  "Data models",
  "Recents",
  "Favorites",
  "Curation",
];
const knownRoutes = ["/data", "/home/data", "/home", "/sign-in"] as const;
const captureBudgetMs = 2000;
const dialogCountCap = 9;

export type AppMount = "mounted" | "unmounted";
export const appMountPath = "/analytics-2";

export function pageRouteClass(url: string, mount: AppMount): PageRouteClass {
  let path: string;
  try {
    path = new URL(url).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return "unknown";
  }
  const prefix = mount === "mounted" ? appMountPath : "";
  return knownRoutes.find((known) => `${prefix}${known}` === path) ?? "unknown";
}

interface DataBrowserDom {
  tabs: string[];
  loader: boolean;
  alert: boolean;
  dialogCount: number;
}

export function readDataBrowserDom(): DataBrowserDom {
  const shown = [
    ...document.querySelectorAll(
      '[role="tab"], [role="status"], [role="alert"], [role="dialog"], [role="alertdialog"]',
    ),
  ].filter((element) => element.checkVisibility({ visibilityProperty: true }));
  const roles = shown.map((element) => element.getAttribute("role"));
  return {
    tabs: shown
      .filter((_, index) => roles[index] === "tab")
      .map((tab) => tab.textContent.trim()),
    loader: shown.some(
      (element, index) =>
        roles[index] === "status" &&
        element.getAttribute("aria-label") === "Loading data browser",
    ),
    alert: roles.includes("alert"),
    dialogCount: roles.filter((r) => r === "dialog" || r === "alertdialog")
      .length,
  };
}

function parseDom(value: unknown): DataBrowserDom | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { tabs, loader, alert, dialogCount } = value as Record<string, unknown>;
  if (
    !Array.isArray(tabs) ||
    !tabs.every((tab) => typeof tab === "string") ||
    typeof loader !== "boolean" ||
    typeof alert !== "boolean" ||
    typeof dialogCount !== "number" ||
    !Number.isInteger(dialogCount) ||
    dialogCount < 0
  )
    return undefined;
  return { tabs, loader, alert, dialogCount };
}

export function classifyPlaywrightFailure(
  error: unknown,
): PlaywrightFailureClass {
  const text = error instanceof Error ? error.message : "";
  if (/intercepts pointer events/i.test(text)) return "intercepted-pointer";
  if (/Target (?:page, context or browser|closed)|has been closed/i.test(text))
    return "closed";
  if (
    /waiting for (?:getBy|locator)|strict mode violation|element\(s\) not found/i.test(
      text,
    )
  )
    return "locator-unavailable";
  return "other";
}

export async function captureDataBrowserState(
  page: DataBrowserPage,
  mount: AppMount,
): Promise<DataBrowserState> {
  const route = pageRouteClass(page.url(), mount);
  let timer: NodeJS.Timeout | undefined;
  try {
    const raced = await Promise.race([
      page.evaluate(readDataBrowserDom),
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), captureBudgetMs);
      }),
    ]);
    if (raced === "timeout") return { outcome: "timeout", route };
    const dom = parseDom(raced);
    if (!dom) return { outcome: "unreadable", route };
    return {
      outcome: "observed",
      route,
      tabs: knownTabs.filter((name) => dom.tabs.includes(name)),
      loader: dom.loader,
      alert: dom.alert,
      dialogCount: Math.min(dom.dialogCount, dialogCountCap),
    };
  } catch {
    return { outcome: "unreadable", route };
  } finally {
    clearTimeout(timer);
  }
}

export function selectWarehouseDiagnostic(
  state: DataBrowserState,
  error: unknown,
): string {
  const cause = classifyPlaywrightFailure(error);
  if (state.outcome !== "observed")
    return `select-warehouse state=${state.outcome} route=${state.route} cause=${cause}`;
  return `select-warehouse state=observed route=${state.route} tabs=${state.tabs.join("|") || "none"} loader=${state.loader} alert=${state.alert} dialog-count=${state.dialogCount} cause=${cause}`;
}
