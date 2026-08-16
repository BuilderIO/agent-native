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
  });

  it("fades the green control and background in on hover", () => {
    expect(shellCss).toContain(".collapsed-mac-window-controls::before {");
    expect(shellCss).toContain("opacity: 0;");
    expect(shellCss).toContain("transition: opacity var(--ease-collapse);");
    expect(shellCss).toContain(
      ".collapsed-mac-window-controls:hover::before,\n.collapsed-mac-window-controls:focus-within::before {",
    );
    expect(shellCss).toContain(
      ".collapsed-mac-window-controls .win-btn--maximize {",
    );
    expect(shellCss).toContain("pointer-events: none;");
    expect(shellCss).toContain("transform: translateX(-7px) scale(0.86);");
    expect(shellCss).toContain(
      ".collapsed-mac-window-controls:hover .win-btn--maximize,\n.collapsed-mac-window-controls:focus-within .win-btn--maximize {",
    );
    expect(shellCss).toContain("pointer-events: auto;");
    expect(shellCss).toContain("transform: translateX(0) scale(1);");
  });

  it("shows all three controls without hover chrome in settings", () => {
    expect(shellCss).toContain(
      ".platform-darwin\n  .shell:has(.settings-overlay)\n  .collapsed-mac-window-controls::before,",
    );
    expect(shellCss).toContain(
      ".collapsed-mac-window-controls:hover::before,\n.platform-darwin\n  .shell:has(.settings-overlay)\n  .collapsed-mac-window-controls:focus-within::before {",
    );
    expect(shellCss).toContain(
      ".platform-darwin\n  .shell:has(.settings-overlay)\n  .collapsed-mac-window-controls\n  .win-btn--maximize {\n  opacity: 1;\n  pointer-events: auto;\n  transform: translateX(0) scale(1);",
    );
  });
});
