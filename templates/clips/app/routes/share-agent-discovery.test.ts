import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function readRoute(name: string): string {
  return readFileSync(resolve(process.cwd(), "app/routes", name), "utf8");
}

describe("share page agent discovery", () => {
  // Agents overwhelmingly read a page as rendered text or an accessibility
  // tree, both of which keep the anchor's text and drop href and every data
  // attribute. Keep the URL as a standalone whitespace-delimited token.
  it("puts the context URL and instructions in the anchor text", () => {
    const route = readRoute("share.$shareId.tsx");
    expect(route).toContain(
      '{`${t("sharePage.agentReadableContext")}: ${agentContextUrl} ${t("sharePage.agentInstructions")}`}',
    );
  });
});
