import { describe, expect, it } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import { runtimeMultiplicityForElementProvenance } from "./editor-helpers";

describe("runtime provenance multiplicity", () => {
  it("counts only nodes at the selected element's own source site", () => {
    const snapshots = {
      "screen-1": {
        html: `<!doctype html><html><body>
          <h1 data-source-file="src/AuthPage.tsx" data-source-line="12" data-source-column="7" data-component-name="AuthPage">A</h1>
          <h1 data-source-file="src/AuthPage.tsx" data-source-line="12" data-source-column="7" data-component-name="AuthPage">B</h1>
          <section data-source-file="src/MarketingHome.tsx" data-source-line="163" data-source-column="41" data-component-name="MarketingHome"><h1>Ancestor site</h1></section>
        </body></html>`,
        nodeCount: 4,
      },
    };

    expect(
      runtimeMultiplicityForElementProvenance(snapshots, {
        provenance: {
          sourceFile: "src/AuthPage.tsx",
          line: 12,
          column: 7,
          component: "AuthPage",
        },
      } as ElementInfo),
    ).toBe(2);
    expect(
      runtimeMultiplicityForElementProvenance(snapshots, {
        provenance: {
          sourceFile: "src/MarketingHome.tsx",
          line: 163,
          column: 41,
          component: "MarketingHome",
        },
      } as ElementInfo),
    ).toBe(1);
  });
});
