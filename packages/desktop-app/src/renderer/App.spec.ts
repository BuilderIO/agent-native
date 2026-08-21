import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("desktop chat-first shell", () => {
  it("renders chat-first as the only primary desktop surface", () => {
    const appSource = readFileSync(
      new URL("./App.tsx", import.meta.url),
      "utf8",
    );

    expect(appSource).toContain("content-area content-area--chat-first");
    expect(appSource).toContain("<CodeAgentsHub");
    expect(appSource).not.toContain("chatFirstMode");
    expect(appSource).not.toContain("Sidebar");
    expect(appSource).not.toContain("TabBar");
  });
});
