import { SNAPSHOT_ADOPTION_MAP as CORE_MARKER } from "@agent-native/core/collab/live-copy-tasks";
import { SNAPSHOT_ADOPTION_MAP as EDITOR_MARKER } from "@agent-native/toolkit/editor";
import { expect, it } from "vitest";

// The toolkit may not import core, so the editor names the server's adoption
// marker itself; Content uses both and keeps them the same.
it("reads the adoption marker under the name the server writes it", () => {
  expect(EDITOR_MARKER).toBe(CORE_MARKER);
});
