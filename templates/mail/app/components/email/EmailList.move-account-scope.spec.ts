import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function emailListSource(): string {
  return readFileSync(new URL("./EmailList.tsx", import.meta.url), "utf8");
}

describe("EmailList Move action routing", () => {
  // oracle-change: move provenance now lives in useApplyLabel; LabelPicker.apply-label.test.ts checks it by calling the hook
  it("keeps trash on non-inbox rows and importance feedback on inbox rows", () => {
    const source = emailListSource();

    expect(source).toContain(
      'const canTrashInView = view !== "inbox" && view !== "trash";',
    );
    expect(source).toContain("onTrash={handleTrashThread}");
    expect(source).toMatch(/onImportanceFeedback=\{\s*view === "inbox"\s*\?/);
  });
});
