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

  it("reveals the green control when the collapsed cluster is hovered or focused", () => {
    expect(shellCss).not.toContain(".collapsed-mac-window-controls::before");
    expect(shellCss).toContain(
      ".collapsed-mac-window-controls .win-btn--maximize {\n  left: 34px;\n  opacity: 0;\n  pointer-events: none;",
    );
    expect(shellCss).toContain(
      ".collapsed-mac-window-controls:hover .win-btn--maximize,\n.collapsed-mac-window-controls:focus-within .win-btn--maximize {\n  opacity: 1;\n  pointer-events: auto;",
    );
  });

  it("keeps the collapsed controls inside the narrow rail", () => {
    expect(shellCss).toContain("left: 8px;\n  width: 48px;");
    expect(shellCss).toContain(
      ".collapsed-mac-window-controls .win-btn--maximize {\n  left: 34px;",
    );
  });
});
