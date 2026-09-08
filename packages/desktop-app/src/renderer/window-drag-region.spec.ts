import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("chat-first desktop window drag region", () => {
  it("keeps the full top rail strip draggable beside native controls", () => {
    const appSource = readFileSync(
      new URL("../../../code-agents-ui/src/CodeAgentsApp.tsx", import.meta.url),
      "utf8",
    );
    const shellCss = readFileSync(
      new URL("./shell.css", import.meta.url),
      "utf8",
    );

    expect(appSource).toContain('className="code-agents-window-drag-region"');
    expect(shellCss).toMatch(
      /\.desktop-chat-first-hub \.code-agents-rail\s*\{[\s\S]*?position: relative;[\s\S]*?padding-top: 36px;[\s\S]*?\}/,
    );
    expect(shellCss).toMatch(
      /\.desktop-chat-first-hub \.code-agents-window-drag-region\s*\{[\s\S]*?top: 0;[\s\S]*?left: var\(--macos-traffic-light-safe-area\);[\s\S]*?height: 36px;[\s\S]*?-webkit-app-region: drag;/,
    );
  });
});
