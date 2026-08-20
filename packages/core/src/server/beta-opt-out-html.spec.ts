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
  });
});
