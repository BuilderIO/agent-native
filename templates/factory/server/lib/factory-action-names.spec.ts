import { describe, expect, it } from "vitest";

import { renameFactoryActionMentions } from "./factory-action-names.js";

describe("renameFactoryActionMentions", () => {
  it("rewrites the retired action names without colliding on babysit-pull-request", () => {
    const repaired = renameFactoryActionMentions(
      [
        "Call start-builder-for-item with clearBug true.",
        "Call govern-agent-native-pull-request with the item id.",
        "Call babysit-agent-native-pull-request for every item.",
        "Call babysit-pull-request for a proposal.",
      ].join("\n"),
    );

    expect(repaired).toContain("dispatch-factory-item");
    expect(repaired).toContain("govern-factory-pull-request");
    expect(repaired).toContain("babysit-factory-pull-request");
    expect(repaired).toContain("propose-pr-babysit-status");
    expect(repaired).not.toContain("start-builder-for-item");
    expect(repaired).not.toContain("govern-agent-native-pull-request");
    expect(repaired).not.toContain("babysit-agent-native-pull-request");
    expect(repaired).not.toContain("babysit-pull-request");
  });
});
