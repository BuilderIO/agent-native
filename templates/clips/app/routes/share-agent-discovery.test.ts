import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function readRoute(name: string): string {
  return readFileSync(resolve(process.cwd(), "app/routes", name), "utf8");
}

describe("share page agent discovery", () => {
  it("puts the context URL and instructions in the anchor text", () => {
    const route = readRoute("share.$shareId.tsx");
    expect(route).toContain(
      '{`${t("sharePage.agentReadableContext")}: ${agentContextUrl} ${t("sharePage.agentInstructions")}`}',
    );
  });
});
