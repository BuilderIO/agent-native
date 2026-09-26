import { describe, expect, it } from "vitest";

import { shouldRetirePendingLocalFileContent } from "./editor-state";

/**
 * Board primitive vanishing until reload (draw-then-drag was impossible).
 *
 * Drawing a primitive in empty overview space writes it into the reserved
 * board file, which DesignEditor creates lazily on open through
 * migrate-board-objects-to-file — and that migration invalidates get-design
 * on success, so a refetch is almost always in flight the first time a user
 * draws. The insert mirrored its content into the cached get-design payload
 * but recorded no `baseUpdatedAt`, so this reconcile read the editor's own
 * optimistic echo as a server acknowledgement and retired the pending write.
 * The in-flight refetch then landed with pre-insert board content, the board
 * surface unmounted (empty board renders no iframe), and the primitive was
 * gone from the canvas and the layers panel until a full page reload — even
 * though the row had been saved.
 */
describe("shouldRetirePendingLocalFileContent", () => {
  const pending = { content: "<body>drawn</body>", baseUpdatedAt: "T1" };

  it("keeps the overlay when only our own optimistic cache echo came back", () => {
    expect(
      shouldRetirePendingLocalFileContent(pending, {
        content: "<body>drawn</body>",
        updatedAt: "T1",
      }),
    ).toBe(false);
  });

  it("keeps the overlay when a stale response reverts the content", () => {
    expect(
      shouldRetirePendingLocalFileContent(pending, {
        content: "<body></body>",
        updatedAt: "T1",
      }),
    ).toBe(false);
  });

  it("retires the overlay once the server row actually advances", () => {
    expect(
      shouldRetirePendingLocalFileContent(pending, {
        content: "<body>drawn</body>",
        updatedAt: "T2",
      }),
    ).toBe(true);
  });

  it("retires a base-less write on content match, as before", () => {
    expect(
      shouldRetirePendingLocalFileContent(
        { content: "<body>drawn</body>" },
        { content: "<body>drawn</body>", updatedAt: "T1" },
      ),
    ).toBe(true);
  });

  it("ignores files with no pending write", () => {
    expect(
      shouldRetirePendingLocalFileContent(undefined, {
        content: "<body></body>",
        updatedAt: "T1",
      }),
    ).toBe(false);
  });
});
