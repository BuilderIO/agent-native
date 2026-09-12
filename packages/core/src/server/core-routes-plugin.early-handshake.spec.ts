/**
 * Pre-bootstrap registration order for the workspace-app handshake routes.
 *
 * `/_agent-native/identity` and `/_agent-native/embed/start` used to be
 * registered late in `createCoreRoutesPlugin`'s sequential init chain, so a
 * cold function made the desktop/mobile shell's embed handshake wait 4-5s for
 * unrelated bootstrap work (migrations, provider registration, etc.) before
 * first paint. `core-routes-plugin.health-auth.spec.ts` already solves the
 * "assert on a deeply-nested handler without booting the real plugin" problem
 * by slicing the source text; this file follows that precedent for the
 * ordering guarantee — h3 dispatches middleware in registration order, so the
 * source order IS the runtime contract.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

function pluginSource(): string {
  return readFileSync(
    new URL("./core-routes-plugin.ts", import.meta.url),
    "utf8",
  );
}

function indexOfAll(source: string, needles: string[]): number[] {
  return needles.map((needle) => {
    const index = source.indexOf(needle);
    expect(index, `expected to find ${JSON.stringify(needle)}`).toBeGreaterThan(
      -1,
    );
    return index;
  });
}

describe("core-routes-plugin pre-bootstrap registration order", () => {
  it("registers security headers, application state, and handshake routes before awaitBootstrap", () => {
    const source = pluginSource();
    const [securityHeaders, cors, identity, embedStart, awaitBootstrapCall] =
      indexOfAll(source, [
        "createSecurityHeadersMiddleware()",
        "CORS for framework routes.",
        // Matches the handler body, not the excludedPaths/early-paths array
        // entries above (which also contain the literal route path).
        "return handleIdentitySso(event, subpath);",
        "createEmbedStartRouteHandler({ getExistingSession: getSession })",
        "await awaitBootstrap(nitroApp);",
      ]);
    const pluginStart = source.indexOf(
      "export function createCoreRoutesPlugin(",
    );
    const appState = source.indexOf(
      "mountApplicationStateRoutes(nitroApp, P);",
      source.indexOf("ensureS3FileUploadProvider();", pluginStart),
    );
    expect(appState).toBeGreaterThan(-1);

    expect(appState).toBeLessThan(securityHeaders);
    expect(appState).toBeLessThan(cors);
    expect(appState).toBeLessThan(identity);
    expect(identity).toBeLessThan(embedStart);
    expect(embedStart).toBeLessThan(awaitBootstrapCall);
  });

  it("keeps the /embed/start registration guarded by disableEmbedRoute in its new location", () => {
    const source = pluginSource();
    const embedStartIndex = source.indexOf("`${P}/embed/start`,");
    const guardIndex = source.lastIndexOf(
      "if (!options.disableEmbedRoute) {",
      embedStartIndex,
    );
    const awaitBootstrapIndex = source.indexOf(
      "await awaitBootstrap(nitroApp);",
    );

    expect(guardIndex).toBeGreaterThan(-1);
    // The guard immediately preceding /embed/start's pre-bootstrap
    // registration must be the one wrapping it, not a stray later match —
    // both must land before awaitBootstrap.
    expect(guardIndex).toBeLessThan(embedStartIndex);
    expect(embedStartIndex).toBeLessThan(awaitBootstrapIndex);
  });

  it("excludes both handshake paths from the tracked-init readiness wait", () => {
    const source = pluginSource();
    const excludedPathsStart = source.indexOf("excludedPaths: [");
    const excludedPathsEnd = source.indexOf("],", excludedPathsStart);
    const excludedPaths = source.slice(excludedPathsStart, excludedPathsEnd);

    expect(excludedPaths).toContain("${FRAMEWORK_ROUTE_PREFIX}/identity");
    expect(excludedPaths).toContain("${FRAMEWORK_ROUTE_PREFIX}/embed/start");
    expect(excludedPaths).toContain(
      "${FRAMEWORK_ROUTE_PREFIX}/application-state",
    );
  });

  it("marks both handshake paths ready before bootstrap", () => {
    const source = pluginSource();
    const markStart = source.indexOf(
      "markFrameworkRoutesReadyBeforeBootstrap(nitroApp, [",
    );
    const markEnd = source.indexOf("]);", markStart);
    const markedPaths = source.slice(markStart, markEnd);

    expect(markedPaths).toContain("`${P}/identity`");
    expect(markedPaths).toContain("`${P}/embed/start`");
    expect(markedPaths).toContain("`${P}/application-state`");
    // Respects the same disableEmbedRoute guard as the actual registration —
    // marking a route "ready" that was never mounted would be a lie, even if
    // a harmless one (h3 just 404s).
    expect(markedPaths).toContain("options.disableEmbedRoute");
  });
});

describe("/_agent-native/health alerts block", () => {
  it("reports whether the chat-health Slack webhook is configured, additively", () => {
    const source = pluginSource();
    const healthStart = source.indexOf("`${P}/health`,");
    const healthEnd = source.indexOf(
      "await awaitBootstrap(nitroApp);",
      healthStart,
    );
    const body = source.slice(healthStart, healthEnd);

    expect(body).toContain(
      "chatHealthSlackWebhookConfigured: isSlackWebhookConfigured()",
    );
    // Must never gate the response status — an unconfigured webhook is
    // informational, not an outage.
    const alertsIndex = body.indexOf("alerts:");
    const statusIndex = body.indexOf("setResponseStatus(event, 503)");
    expect(statusIndex).toBeGreaterThan(-1);
    expect(statusIndex).toBeLessThan(alertsIndex);
  });
});

/**
 * "Mounted before `awaitBootstrap`" is not the contract the readiness gate
 * relies on — "mounted before the plugin's FIRST await" is.
 *
 * `trackPluginInit`'s `excludedPaths` releases a request to these paths
 * without waiting for plugin init, on the promise that their handlers are
 * already registered. Any `await` between the plugin's first statement and
 * those registrations opens a window on every cold serverless start where the
 * gate lets the request through and nothing is mounted yet, so the server
 * answers a bare 404. Two `await import("./app-url.js")` calls and one
 * `await import("./security-headers.js")` sat in that window and made
 * `/_agent-native/identity/callback` 404 for the cross-app SSO return trip.
 */
describe("core-routes-plugin cold-start route availability", () => {
  it(
    "mounts every gate-excluded framework path before the plugin's first await",
    { timeout: 60_000 },
    async () => {
      const mounted: string[] = [];
      const declaredEarly: string[] = [];
      let excludedPaths: string[] = [];

      vi.resetModules();
      vi.doMock("./framework-request-handler.js", async () => {
        const actual = await vi.importActual<
          typeof import("./framework-request-handler.js")
        >("./framework-request-handler.js");
        return {
          ...actual,
          getH3App: () => ({
            use: (arg1: unknown, arg2?: unknown) => {
              if (typeof arg1 === "string") mounted.push(arg1);
              void arg2;
            },
          }),
          markDefaultPluginProvided: () => {},
          markFrameworkRoutesReadyBeforeBootstrap: (
            _nitroApp: unknown,
            paths: readonly string[],
          ) => {
            declaredEarly.push(...paths);
          },
          trackPluginInit: (
            _nitroApp: unknown,
            promise: Promise<void>,
            options: { excludedPaths?: string[] } = {},
          ) => {
            promise.catch(() => {});
            excludedPaths = options.excludedPaths ?? [];
          },
          // Never resolves: everything after it is bootstrap-dependent and is
          // explicitly allowed to mount late.
          awaitBootstrap: () => new Promise<void>(() => {}),
        };
      });

      const { createCoreRoutesPlugin } =
        await import("./core-routes-plugin.js");
      const { FRAMEWORK_AUTH_EARLY_PATHS } =
        await import("./framework-request-handler.js");

      // Deliberately NOT awaited: the assertion is about what exists at the
      // instant the plugin first yields, which is when a cold-start request can
      // be dispatched.
      void (createCoreRoutesPlugin()({
        h3: { "~middleware": [] },
      }) as Promise<void> | void);

      const authOwned = new Set<string>(FRAMEWORK_AUTH_EARLY_PATHS);
      const mustBeMounted = [
        ...new Set([...declaredEarly, ...excludedPaths]),
      ].filter((path) => !authOwned.has(path));

      expect(mustBeMounted.length).toBeGreaterThan(0);
      for (const path of mustBeMounted) {
        expect(
          mounted,
          `${path} is excluded from the plugin-init readiness gate, so it must be mounted before the plugin's first await`,
        ).toContain(path);
      }

      vi.doUnmock("./framework-request-handler.js");
      vi.resetModules();
    },
  );
});
