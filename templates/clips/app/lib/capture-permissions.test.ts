import { describe, expect, it } from "vitest";

import {
  detectCaptureHostApp,
  macPermissionGuidanceFor,
  type CaptureHostEnv,
} from "./capture-permissions";

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const SAFARI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15";

function env(overrides: Partial<CaptureHostEnv> = {}): CaptureHostEnv {
  return {
    userAgent: CHROME_UA,
    isTauri: false,
    isBrave: false,
    isArc: false,
    ...overrides,
  };
}

describe("detectCaptureHostApp", () => {
  it("names the Agent Native desktop shell", () => {
    expect(
      detectCaptureHostApp(env({ userAgent: `${CHROME_UA} Electron/41.2.2` })),
    ).toEqual({ name: "Agent Native", kind: "desktop" });
  });

  it("names the Clips desktop app", () => {
    expect(detectCaptureHostApp(env({ isTauri: true }))).toEqual({
      name: "Clips",
      kind: "desktop",
    });
  });

  it("names Chrome as macOS lists it", () => {
    expect(detectCaptureHostApp(env())).toEqual({
      name: "Google Chrome",
      kind: "browser",
    });
  });

  it("prefers Chromium derivatives over the Chrome token they carry", () => {
    expect(
      detectCaptureHostApp(env({ userAgent: `${CHROME_UA} Edg/141.0` })).name,
    ).toBe("Microsoft Edge");
    expect(
      detectCaptureHostApp(env({ userAgent: `${CHROME_UA} OPR/120.0` })).name,
    ).toBe("Opera");
    expect(
      detectCaptureHostApp(env({ userAgent: `${CHROME_UA} Vivaldi/7.5` })).name,
    ).toBe("Vivaldi");
    expect(detectCaptureHostApp(env({ isBrave: true })).name).toBe(
      "Brave Browser",
    );
    expect(detectCaptureHostApp(env({ isArc: true })).name).toBe("Arc");
  });

  it("names Safari and Firefox", () => {
    expect(detectCaptureHostApp(env({ userAgent: SAFARI_UA })).name).toBe(
      "Safari",
    );
    expect(
      detectCaptureHostApp(env({ userAgent: "Mozilla/5.0 Firefox/145.0" }))
        .name,
    ).toBe("Firefox");
  });

  it("falls back to a generic browser when the agent is unknown", () => {
    expect(detectCaptureHostApp(env({ userAgent: "" }))).toEqual({
      name: "your browser",
      kind: "browser",
    });
  });
});

describe("macPermissionGuidanceFor", () => {
  it("tells browser users Clips is not the app to look for", () => {
    const guidance = macPermissionGuidanceFor("screen", {
      name: "Google Chrome",
      kind: "browser",
    });
    expect(guidance).toContain("Clips is never listed by name");
    expect(guidance).toContain("Google Chrome");
    expect(guidance).toContain(
      "System Settings > Privacy & Security > Screen & System Audio Recording",
    );
    expect(guidance).toContain("add it with the + button");
  });

  it("names the desktop app itself when the recorder runs in it", () => {
    const guidance = macPermissionGuidanceFor("screen", {
      name: "Agent Native",
      kind: "desktop",
    });
    expect(guidance).toContain("Turn on Agent Native");
    expect(guidance).not.toContain("your browser");
  });

  it("points at the pane matching the blocked device", () => {
    expect(
      macPermissionGuidanceFor("microphone", {
        name: "Safari",
        kind: "browser",
      }),
    ).toContain("Privacy & Security > Microphone");
    expect(
      macPermissionGuidanceFor("camera", { name: "Safari", kind: "browser" }),
    ).toContain("Privacy & Security > Camera");
  });

  it("reads naturally when the browser could not be identified", () => {
    expect(
      macPermissionGuidanceFor("screen", {
        name: "your browser",
        kind: "browser",
      }),
    ).toContain("look for your browser instead. Turn it on in");
  });
});
