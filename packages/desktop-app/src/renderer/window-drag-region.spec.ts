import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("chat-first desktop window drag region", () => {
  it("keeps the traffic-light-clear rail strip draggable", () => {
    const appSource = readFileSync(
      "../code-agents-ui/src/CodeAgentsApp.tsx",
      "utf8",
    );
    const shellCss = readFileSync("src/renderer/shell.css", "utf8");

    expect(appSource).toContain('className="code-agents-window-drag-region"');
    expect(shellCss).toMatch(
      /\.desktop-chat-first-hub \.code-agents-rail\s*\{[\s\S]*?position: relative;[\s\S]*?padding-top: 36px;[\s\S]*?\}/,
    );
    expect(shellCss).toMatch(
      /\.desktop-chat-first-hub \.code-agents-window-drag-region\s*\{[\s\S]*?left: var\(--macos-traffic-light-safe-area\);[\s\S]*?height: 36px;[\s\S]*?-webkit-app-region: drag;/,
    );
  });
});
