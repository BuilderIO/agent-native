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

export function prewarmFormsRoutePath(path: string) {
  const pathname = parsePath(path);
  const jobs: Promise<unknown>[] = [];

  if (pathname === "/" || pathname === "/ask") {
    jobs.push(
      prewarm("layout", () => import("@/routes/_app")),
      prewarm("ask", () => import("@/routes/_app.ask")),
    );
  }

  if (pathname === "/forms") {
    jobs.push(
      prewarm("layout", () => import("@/routes/_app")),
      prewarm("forms-index", () => import("@/routes/_app.forms._index")),
    );
  }

  if (/^\/forms\/[^/]+\/responses\/?$/.test(pathname)) {
    jobs.push(
      prewarm("layout", () => import("@/routes/_app")),
      prewarm("responses", () => import("@/routes/_app.forms.$id_.responses")),
    );
  } else if (/^\/forms\/[^/]+\/?$/.test(pathname)) {
    jobs.push(
      prewarm("layout", () => import("@/routes/_app")),
      prewarm("form-builder", () => import("@/routes/_app.forms.$id")),
    );
  }

  if (pathname === "/response-insights") {
    jobs.push(
      prewarm("layout", () => import("@/routes/_app")),
      prewarm(
        "response-insights",
        () => import("@/routes/_app.response-insights"),
      ),
    );
  }

  if (pathname.startsWith("/extensions")) {
    jobs.push(
      prewarm("layout", () => import("@/routes/_app")),
      prewarm("extensions-layout", () => import("@/routes/_app.extensions")),
    );
    if (/^\/extensions\/[^/]+\/?$/.test(pathname)) {
      jobs.push(
        prewarm(
          "extension-detail",
          () => import("@/routes/_app.extensions.$id"),
        ),
      );
    } else {
      jobs.push(
        prewarm(
          "extensions-index",
          () => import("@/routes/_app.extensions._index"),
        ),
      );
    }
  }

  return Promise.all(jobs);
}

export function prewarmCommonFormsRoutes() {
  return Promise.all([
    prewarmFormsRoutePath("/ask"),
    prewarmFormsRoutePath("/forms"),
    prewarmFormsRoutePath("/forms/__route_prewarm__?tab=edit"),
    prewarmFormsRoutePath("/forms/__route_prewarm__/responses"),
    prewarmFormsRoutePath("/response-insights"),
  ]);
}

export function scheduleFormsRoutePrewarm() {
  if (typeof window === "undefined") return () => {};

  const run = () => {
    void prewarmCommonFormsRoutes();
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
