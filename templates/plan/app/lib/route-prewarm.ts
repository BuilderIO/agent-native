const prewarmPromises = new Map<string, Promise<unknown>>();

type Importer = () => Promise<unknown>;

function prewarm(key: string, importer: Importer) {
  let promise = prewarmPromises.get(key);
  if (!promise) {
    promise = importer().catch(() => null);
    prewarmPromises.set(key, promise);
  }
  return promise;
}

function parsePath(path: string): string {
  try {
    return new URL(path, "http://localhost").pathname;
  } catch {
    return path;
  }
}

export function prewarmPlanRoutePath(path: string) {
  const pathname = parsePath(path);
  const jobs: Promise<unknown>[] = [];

  if (pathname === "/plans") {
    jobs.push(prewarm("plans", () => import("@/routes/plans")));
  } else if (/^\/plans\/[^/]+\/?$/.test(pathname)) {
    jobs.push(prewarm("plan-detail", () => import("@/routes/plans.$id")));
  }

  if (pathname === "/recaps") {
    jobs.push(prewarm("recaps", () => import("@/routes/recaps")));
  } else if (/^\/recaps\/[^/]+\/?$/.test(pathname)) {
    jobs.push(prewarm("recap-detail", () => import("@/routes/recaps.$id")));
  }

  if (/^\/local-plans\/[^/]+\/?$/.test(pathname)) {
    jobs.push(
      prewarm("local-plan-detail", () => import("@/routes/local-plans.$slug")),
    );
  }

  if (pathname.startsWith("/extensions")) {
    jobs.push(
      prewarm("extensions-layout", () => import("@/routes/extensions")),
      prewarm("extensions-index", () => import("@/routes/extensions._index")),
    );
  }

  return Promise.all(jobs);
}

export function prewarmCommonPlanRoutes() {
  return Promise.all([
    prewarmPlanRoutePath("/plans"),
    prewarmPlanRoutePath("/plans/__route_prewarm__"),
    prewarmPlanRoutePath("/recaps"),
    prewarmPlanRoutePath("/recaps/__route_prewarm__"),
    prewarmPlanRoutePath("/local-plans/__route_prewarm__"),
  ]);
}

export function schedulePlanRoutePrewarm() {
  if (typeof window === "undefined") return () => {};

  const run = () => {
    void prewarmCommonPlanRoutes();
  };

  const idleWindow = window as Window & {
    requestIdleCallback?: (
      callback: IdleRequestCallback,
      options?: IdleRequestOptions,
    ) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

  if (typeof idleWindow.requestIdleCallback === "function") {
    const handle = idleWindow.requestIdleCallback(run, { timeout: 1_500 });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }

  const handle = window.setTimeout(run, 250);
  return () => window.clearTimeout(handle);
}
