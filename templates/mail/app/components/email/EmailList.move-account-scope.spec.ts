import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function emailListSource(): string {
  return readFileSync(new URL("./EmailList.tsx", import.meta.url), "utf8");
}

describe("EmailList Move action routing", () => {
  it("passes selected account and thread provenance for every moved row", () => {
    const source = emailListSource();
    const start = source.indexOf("const moveFocusedToLabel");
    const end = source.indexOf("const getThreadMessagesForKey", start);
    const moveHandler = source.slice(start, end);

    expect(moveHandler).toContain("accountEmails: targets");
    expect(moveHandler).toContain("target.latestMessage.accountEmail");
    expect(moveHandler).toContain("threadIds: targets");
    expect(moveHandler).toContain("target.latestMessage.threadId");
  });

  it("keeps trash on non-inbox rows and importance feedback on inbox rows", () => {
    const source = emailListSource();

    expect(source).toContain(
      'const canTrashInView = view !== "inbox" && view !== "trash";',
    );
    expect(source).toContain("onTrash={handleTrashThread}");
    expect(source).toMatch(/onImportanceFeedback=\{\s*view === "inbox"\s*\?/);
  });
});
