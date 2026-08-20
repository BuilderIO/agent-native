import { describe, expect, it } from "vitest";

import {
  BETA_OPT_OUT_PERSISTENCE_MARKER,
  injectBetaOptOutPersistence,
} from "./beta-opt-out-html.js";

describe("injectBetaOptOutPersistence", () => {
  it("injects the opt-out handoff into custom auth HTML before authentication", () => {
    const html = injectBetaOptOutPersistence(
      "<!doctype html><html><head></head><body><form>Sign in</form></body></html>",
    );

    expect(html).toContain(BETA_OPT_OUT_PERSISTENCE_MARKER);
    expect(html).toContain("agentNativeBetaOptOut");
    expect(html).toContain("agent-native:beta-opt-out-until");
    expect(html).toContain("window.localStorage.setItem");
    expect(html).toContain("window.history.replaceState");
    expect(html).toContain('id="environment-switcher"');
    expect(html).toContain('id="environment-production-link"');
    expect(html).toContain("__anInitEnvironmentBadge");
    expect(html).toContain("betaHosts");
    expect(html).toContain("agent-native-environment-switcher-style");
    expect(html).toContain(
      "if (!productionHost || betaHosts[productionHost] !== hostname) return;",
    );
    expect(html.indexOf("data-agent-native-beta-opt-out")).toBeLessThan(
      html.indexOf("</body>"),
    );
  });

  it("does not duplicate the handoff on a second auth response pass", () => {
    const html = injectBetaOptOutPersistence(
      "<html><body>Sign in</body></html>",
    );
    const reinjected = injectBetaOptOutPersistence(html);

    expect(reinjected).toBe(html);
    expect(reinjected.match(/data-agent-native-beta-opt-out/g)).toHaveLength(1);
    expect(
      reinjected.match(/data-agent-native-environment-switcher/g),
    ).toHaveLength(3);
    expect(reinjected.match(/id="environment-switcher"/g)).toHaveLength(1);
    expect(reinjected.match(/id="environment-production-link"/g)).toHaveLength(
      1,
    );
    expect(reinjected.match(/__anInitEnvironmentBadge/g)).toHaveLength(1);
  });
});
