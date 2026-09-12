import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("chat-first macOS window controls", () => {
  const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  const hubSource = readFileSync(
    new URL("./components/CodeAgentsHub.tsx", import.meta.url),
    "utf8",
  );
  const shellCss = readFileSync(
    new URL("./shell.css", import.meta.url),
    "utf8",
  );

  it("keeps the collapsed control cluster above the settings surface", () => {
    expect(appSource).toContain(
      'className="desktop-chat-first-mac-window-controls"',
    );
    expect(appSource).toContain("<CollapsedMacWindowControls");
    expect(hubSource).not.toContain("railWindowControlsSlot={");
    expect(shellCss).toContain(
      ".platform-darwin\n  .shell:has(.code-agents-surface--rail-collapsed)\n  .desktop-chat-first-mac-window-controls",
    );
    expect(shellCss).toContain("display: block;");
    expect(shellCss).toContain("z-index: 200;");
    expect(hubSource).toContain(
      "setNativeTrafficLightsVisible(!chatFirstRailCollapsed);",
    );
  });

  it("shows all three collapsed controls without hover chrome", () => {
    expect(shellCss).not.toContain(".collapsed-mac-window-controls::before");
    expect(shellCss).not.toContain(".collapsed-mac-window-controls:hover");
    expect(shellCss).not.toContain(
      ".collapsed-mac-window-controls:focus-within",
    );
    expect(shellCss).toContain(
      ".collapsed-mac-window-controls .win-btn--maximize {",
    );
    expect(shellCss).not.toContain("translateX(-4px) scale(0.8)");
  });
});
