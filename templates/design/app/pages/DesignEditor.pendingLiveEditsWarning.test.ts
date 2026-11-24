import { describe, expect, it, vi } from "vitest";

import { discardPendingLiveEditCollections } from "./design-editor/pending-edits";

// oracle-change: removed DesignEditor source greps; the discardPendingLiveEditCollections case remains

describe("DesignEditor pending live edits", () => {
  it("clears the pending state after Apply and explicit discard", () => {
    const stylesRef = { current: [{ id: "style-1" }, { id: "style-2" }] };
    const liveRef = { current: [{ id: "live-1" }] };
    const clearState = vi.fn();

    discardPendingLiveEditCollections({ stylesRef, liveRef, clearState });

    expect(stylesRef.current).toEqual([]);
    expect(liveRef.current).toEqual([]);
    expect(clearState).toHaveBeenCalledOnce();
  });
});
