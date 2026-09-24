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

import { describe, expect, it } from "vitest";

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
      "mountApplicationStateRoutes(nitroApp, P,",
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
 * The Builder connect trampoline is the other route a brand-new signup hits
 * within seconds of a cold start, so it reads like the identity-callback 404
 * the readiness gate opened. It is not the same failure: `/builder/connect`
 * and `/connection-status/builder` are NOT gate-excluded, so `trackPluginInit`
 * holds those requests until init finishes rather than dispatching them into
 * an unmounted router.
 *
 * That is only true while they stay out of `excludedPaths`. Adding either one
 * there without also hoisting its registration above the plugin's first
 * `await` would reintroduce exactly the cold-start 404 on the provider-linking
 * path, which is why this is asserted rather than assumed.
 */
describe("Builder connect routes are gated, not hoisted", () => {
  it("keeps provider-linking routes out of the readiness-gate exclusion list", () => {
    const source = pluginSource();
    const excludedBlock = source.slice(
      source.indexOf("excludedPaths: ["),
      source.indexOf("});", source.indexOf("excludedPaths: [")),
    );
    expect(excludedBlock).not.toContain("builder/connect");
    expect(excludedBlock).not.toContain("connection-status");
    expect(excludedBlock).not.toContain("builder/status");
  });

  it("registers the Builder connect and status routes after awaitBootstrap", () => {
    const source = pluginSource();
    const [awaitBootstrapCall, statusAliases, builderConnect] = indexOfAll(
      source,
      [
        "await awaitBootstrap(nitroApp);",
        "mountBuilderStatusRouteAliases(",
        "`${P}/builder/connect`,",
      ],
    );
    expect(statusAliases).toBeGreaterThan(awaitBootstrapCall);
    expect(builderConnect).toBeGreaterThan(awaitBootstrapCall);
  });
});
