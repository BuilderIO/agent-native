import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("chat-first macOS window controls", () => {
  const appSource = readFileSync(
    new URL("./App.tsx", import.meta.url),
    "utf8",
  );
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
    expect(shellCss).toMatch(
      /.platform-darwins+.shell:has(.code-agents-surface--rail-collapsed)[sS]*?.desktop-chat-first-mac-window-controlss*{[sS]*?display: block;[sS]*?z-index: 200;/,
    );
  });

  it("fades the green control and background in on hover", () => {
    expect(shellCss).toMatch(
      /.collapsed-mac-window-controls::befores*{[sS]*?opacity: 0;[sS]*?transition: opacity var(--ease-collapse);/,
    );
    expect(shellCss).toMatch(
      /.collapsed-mac-window-controls:hover::before,[sS]*?.collapsed-mac-window-controls:focus-within::befores*{[sS]*?opacity: 1;/,
    );
    expect(shellCss).toMatch(
      /.collapsed-mac-window-controls .win-btn--maximizes*{[sS]*?opacity: 0;[sS]*?pointer-events: none;[sS]*?transform: translateX(-7px) scale(0.86);/,
    );
    expect(shellCss).toMatch(
      /.collapsed-mac-window-controls:hover .win-btn--maximize,[sS]*?.collapsed-mac-window-controls:focus-within .win-btn--maximizes*{[sS]*?opacity: 1;[sS]*?pointer-events: auto;[sS]*?transform: translateX(0) scale(1);/,
    );
  });
});
