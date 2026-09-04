import { afterEach, describe, expect, it, vi } from "vitest";

import { SSR_BETA_REDIRECT_MARKER } from "../shared/ssr-beta-redirect.js";
import {
  BETA_OPT_OUT_PERSISTENCE_MARKER,
  injectBetaOptOutPersistence,
} from "./beta-opt-out-html.js";

describe("injectBetaOptOutPersistence", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("injects the opt-out handoff into custom auth HTML before authentication", () => {
    const html = injectBetaOptOutPersistence(
      "<!doctype html><html><head></head><body><form>Sign in</form></body></html>",
    );

    expect(html).toContain(BETA_OPT_OUT_PERSISTENCE_MARKER);
    expect(html).toContain(SSR_BETA_REDIRECT_MARKER);
    expect(html.indexOf(SSR_BETA_REDIRECT_MARKER)).toBeLessThan(
      html.indexOf("</head>"),
    );
    expect(html.indexOf(SSR_BETA_REDIRECT_MARKER)).toBeLessThan(
      html.indexOf("data-agent-native-beta-opt-out"),
    );
    expect(html).toContain("agentNativeBetaOptOut");
    expect(html).toContain("agent-native:beta-opt-out-until");
    expect(html).toContain("agent-native:beta-redirect-until");
    expect(html).toContain("window.localStorage.setItem");
    expect(html).toContain("window.history.replaceState");
    expect(html).toContain('id="environment-switcher"');
    expect(html).toContain('id="environment-production-link"');
    expect(html).toContain('id="environment-hide-badge"');
    expect(html).toContain("__anInitEnvironmentBadge");
    expect(html).toContain("agent-native:force-production");
    expect(html).toContain("switcher.hidden = true");
    expect(html).toContain("betaHosts");
    expect(html).toContain("agent-native-environment-switcher-style");
    expect(html).toContain("left: max(0.75rem, env(safe-area-inset-left));");
    expect(html).toContain("left: 0;");
    expect(html).toContain(
      "width: 100%;\n    min-height: 2rem;\n    margin-top: 0.5rem;\n    margin-bottom: -0.5rem;",
    );
    expect(html).toContain(
      "width: min(17.5rem, calc(100vw - 1.5rem));\n    box-sizing: border-box;\n    padding: 1.25rem;",
    );
    expect(html).not.toContain("safe-area-inset-right");
    expect(html).toContain(
      "if (!productionHost || betaHosts[productionHost] !== hostname) return;",
    );
    expect(html.indexOf("data-agent-native-beta-opt-out")).toBeLessThan(
      html.indexOf("</body>"),
    );
  });

  it("opens the switcher stylesheet with a rule, so the badge keeps position: fixed", () => {
    const html = injectBetaOptOutPersistence(
      "<html><head></head><body>Sign in</body></html>",
    );
    const css = html.slice(
      html.indexOf("agent-native-environment-switcher-style"),
    );
    const stylesheet = css.slice(css.indexOf(">") + 1, css.indexOf("</style>"));

    // A declaration before the first rule is not a contained parse error: the
    // following rule's prelude absorbs it and that rule is dropped, which
    // silently unpins the badge.
    expect(stylesheet.trimStart()).toMatch(/^[.#a-zA-Z@:*]/);
    expect(stylesheet.trimStart()).not.toMatch(/^[a-z-]+\s*:/);
    expect(stylesheet).toContain(".environment-switcher {");
  });

  it("does not duplicate the handoff on a second auth response pass", () => {
    const html = injectBetaOptOutPersistence(
      "<html><body>Sign in</body></html>",
    );
    const reinjected = injectBetaOptOutPersistence(html);

    expect(reinjected).toBe(html);
    expect(reinjected.match(/data-agent-native-beta-redirect/g)).toHaveLength(
      1,
    );
    expect(reinjected.match(/data-agent-native-beta-opt-out/g)).toHaveLength(1);
    expect(
      reinjected.match(/data-agent-native-environment-switcher/g),
    ).toHaveLength(3);
    expect(reinjected.match(/id="environment-switcher"/g)).toHaveLength(1);
    expect(reinjected.match(/id="environment-production-link"/g)).toHaveLength(
      1,
    );
    expect(reinjected.match(/id="environment-hide-badge"/g)).toHaveLength(1);
    expect(reinjected.match(/__anInitEnvironmentBadge/g)).toHaveLength(1);
  });

  it("uses the Vite SSR base path for the auth session probe", () => {
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;
    vi.stubEnv("VITE_APP_BASE_PATH", "/starter/");

    const html = injectBetaOptOutPersistence(
      "<html><head></head><body>Sign in</body></html>",
    );

    expect(html).toContain("/starter/_agent-native/auth/session");
  });

  it("uses the mounted workspace path when no build-time base exists", () => {
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv(
      "AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "plan" }]),
    );

    const html = injectBetaOptOutPersistence(
      "<html><head></head><body>Sign in</body></html>",
      "/plan/login",
    );

    expect(html).toContain("/plan/_agent-native/auth/session");
  });

  it("prefers the request mount over a stale build-time base", () => {
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv("VITE_APP_BASE_PATH", "/dispatch");
    vi.stubEnv(
      "AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "dispatch" }, { id: "diagrams" }]),
    );

    const html = injectBetaOptOutPersistence(
      "<html><head></head><body>Sign in</body></html>",
      "/diagrams/login",
    );

    expect(html).toContain("/diagrams/_agent-native/auth/session");
    expect(html).not.toContain("/dispatch/_agent-native/auth/session");
  });

  it("escapes a request-derived session probe path in the inline script", () => {
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv(
      "AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ path: "/<script>alert(1)" }]),
    );

    const html = injectBetaOptOutPersistence(
      "<html><head></head><body>Sign in</body></html>",
      "/<script>alert(1)/login",
    );

    expect(html).toContain("\\u003cscript\\u003ealert(1)");
    expect(html).not.toContain("<script>alert(1)");
  });

  it("keeps the root session path for an unlisted workspace login route", () => {
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");

    const html = injectBetaOptOutPersistence(
      "<html><head></head><body>Sign in</body></html>",
      "/settings/login",
    );

    expect(html).toContain("/_agent-native/auth/session");
    expect(html).not.toContain("/settings/_agent-native/auth/session");
  });

  it("keeps the existing onboarding switcher instead of injecting a second one", () => {
    const html = injectBetaOptOutPersistence(`
      <html><head></head><body>
        <div class="environment-switcher" id="environment-switcher" hidden>
          <a id="environment-production-link" href="">Switch to production</a>
          <button id="environment-hide-badge" type="button">Hide badge</button>
        </div>
        <script>function __anInitEnvironmentBadge() {}</script>
      </body></html>
    `);

    expect(html).toContain(BETA_OPT_OUT_PERSISTENCE_MARKER);
    expect(html).toContain(SSR_BETA_REDIRECT_MARKER);
    expect(html.match(/id="environment-switcher"/g)).toHaveLength(1);
    expect(html.match(/id="environment-production-link"/g)).toHaveLength(1);
    expect(html.match(/id="environment-hide-badge"/g)).toHaveLength(1);
    expect(html.match(/__anInitEnvironmentBadge/g)).toHaveLength(1);
    expect(html).not.toContain(
      'data-agent-native-environment-switcher-style="1"',
    );
    expect(html).not.toContain('data-agent-native-environment-switcher="1"');
  });
});
