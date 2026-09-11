import { describe, expect, it } from "vitest";

import {
  isBetaLaneEmail,
  resolveDesktopEnvironmentLane,
  withDesktopEnvironmentLane,
} from "./environment-lane";

describe("resolveDesktopEnvironmentLane", () => {
  it("follows a Builder account on auto", () => {
    expect(
      resolveDesktopEnvironmentLane({
        preference: "auto",
        email: "steve@builder.io",
      }),
    ).toBe("beta");
  });

  it("keeps everyone else on production on auto", () => {
    expect(
      resolveDesktopEnvironmentLane({
        preference: "auto",
        email: "someone@example.com",
      }),
    ).toBe("production");
    expect(
      resolveDesktopEnvironmentLane({ preference: "auto", email: null }),
    ).toBe("production");
  });

  it("lets an explicit production preference override the email", () => {
    expect(
      resolveDesktopEnvironmentLane({
        preference: "production",
        email: "steve@builder.io",
      }),
    ).toBe("production");
  });

  it("never resolves an ineligible account onto beta", () => {
    // The stored preference outlives sign-out and the Settings control is
    // hidden for an ineligible account, so honoring a stale "beta" would pin
    // the next account on this profile to beta with no way back.
    expect(
      resolveDesktopEnvironmentLane({
        preference: "beta",
        email: "someone@example.com",
      }),
    ).toBe("production");
    expect(
      resolveDesktopEnvironmentLane({ preference: "beta", email: null }),
    ).toBe("production");
    expect(
      resolveDesktopEnvironmentLane({
        preference: "beta",
        email: "steve@builder.io",
      }),
    ).toBe("beta");
  });

  it("does not treat a lookalike domain as Builder", () => {
    expect(isBetaLaneEmail("steve@notbuilder.io")).toBe(false);
    expect(isBetaLaneEmail("steve@builder.io.example.com")).toBe(false);
    expect(isBetaLaneEmail("  Steve@Builder.IO  ")).toBe(true);
  });
});

describe("withDesktopEnvironmentLane", () => {
  it("swaps a known first-party host onto beta and back", () => {
    expect(
      withDesktopEnvironmentLane("https://mail.agent-native.com/inbox", "beta"),
    ).toBe("https://beta.mail.agent-native.com/inbox");
    expect(
      withDesktopEnvironmentLane(
        "https://beta.mail.agent-native.com/inbox",
        "production",
      ),
    ).toBe("https://mail.agent-native.com/inbox");
  });

  it("leaves an app with no beta site on production", () => {
    // tasks/videos are shipped apps that are absent from ENVIRONMENT_BETA_HOSTS.
    // Deriving "beta." by pattern would send them to a hostname nothing serves.
    const tasks = "https://tasks.agent-native.com/";
    expect(withDesktopEnvironmentLane(tasks, "beta")).toBe(tasks);
  });

  it("leaves local, custom, and malformed targets alone", () => {
    expect(withDesktopEnvironmentLane("http://localhost:3000", "beta")).toBe(
      "http://localhost:3000",
    );
    expect(
      withDesktopEnvironmentLane("https://custom.example.com/", "beta"),
    ).toBe("https://custom.example.com/");
    expect(withDesktopEnvironmentLane("about:blank", "beta")).toBe(
      "about:blank",
    );
  });

  it("preserves path and query when swapping", () => {
    expect(
      withDesktopEnvironmentLane(
        "https://design.agent-native.com/d/1?embedded=1",
        "beta",
      ),
    ).toBe("https://beta.design.agent-native.com/d/1?embedded=1");
  });
});
