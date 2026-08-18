import { describe, expect, it } from "vitest";

import { resolveDeckIdFromCollabDocId } from "./plugins/collab.js";

describe("resolveDeckIdFromCollabDocId", () => {
  it("extracts the deck id before an agent-created slide id", () => {
    expect(
      resolveDeckIdFromCollabDocId(
        "deck-QySuylj_pv-slide-slide-1786096602620-8kymu",
      ),
    ).toBe("QySuylj_pv");
  });

  it("keeps a legacy deck id containing the marker intact", () => {
    expect(
      resolveDeckIdFromCollabDocId(
        "deck-deck-slide-archive-slide-slide-1786096602620-8kymu",
      ),
    ).toBe("deck-slide-archive");
  });

  it("supports deck-level collab documents", () => {
    expect(resolveDeckIdFromCollabDocId("deck-QySuylj_pv")).toBe("QySuylj_pv");
  });

  it("leaves non-prefixed legacy document ids unchanged", () => {
    expect(resolveDeckIdFromCollabDocId("legacy-deck")).toBe("legacy-deck");
  });
});
