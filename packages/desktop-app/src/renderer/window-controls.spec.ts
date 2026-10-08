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

  it("reveals the hover pill and green control within the collapsed cluster", () => {
    expect(shellCss).toContain(
      '.collapsed-mac-window-controls::before {\n  position: absolute;\n  z-index: 0;\n  top: -3px;\n  left: 0;\n  width: 48px;\n  height: 28px;\n  border: 1px solid hsl(var(--sidebar-foreground) / 0.14);\n  border-radius: 999px;\n  background-color: hsl(var(--sidebar-background));\n  box-shadow: 0 4px 14px hsl(var(--sidebar-background) / 0.42);\n  content: "";\n  opacity: 0;',
    );
    expect(shellCss).toContain(
      ".collapsed-mac-window-controls:hover::before,\n.collapsed-mac-window-controls:focus-within::before {\n  opacity: 1;",
    );
    expect(shellCss).toContain(
      ".collapsed-mac-window-controls .win-btn--maximize {\n  left: 34px;\n  opacity: 0;\n  pointer-events: none;",
    );
    expect(shellCss).toContain(
      ".collapsed-mac-window-controls:hover .win-btn--maximize,\n.collapsed-mac-window-controls:focus-within .win-btn--maximize {\n  opacity: 1;\n  pointer-events: auto;",
    );
  });

  it("hides the hover pill and reveals maximize controls over settings", () => {
    expect(shellCss).toContain(
      ".platform-darwin\n  .shell:has(.settings-overlay)",
    );
    expect(shellCss).not.toContain(".platform-darwin:has(.settings-overlay)");
    expect(shellCss).toContain(
      ".platform-darwin\n  .shell:has(.settings-overlay)\n  .collapsed-mac-window-controls:hover::before,\n.platform-darwin\n  .shell:has(.settings-overlay)\n  .collapsed-mac-window-controls:focus-within::before {\n  opacity: 0;",
    );
    expect(shellCss).toContain(
      ".platform-darwin\n  .shell:has(.settings-overlay)\n  .collapsed-mac-window-controls\n  .win-btn--maximize {\n  opacity: 1;\n  pointer-events: auto;",
    );
  });

  it("keeps the collapsed controls inside the narrow rail", () => {
    expect(shellCss).toContain("left: 8px;\n  width: 48px;");
    expect(shellCss).toContain(
      ".collapsed-mac-window-controls .win-btn--maximize {\n  left: 34px;",
    );
  });
});
