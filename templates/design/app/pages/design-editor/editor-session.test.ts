import { describe, expect, it } from "vitest";

import { createEditorSaveOperationSource } from "./editor-session";

describe("createEditorSaveOperationSource", () => {
  it("changes across editor remounts while retaining the browser-tab prefix", () => {
    const firstMount = createEditorSaveOperationSource("tab-a", "editor-1");
    const secondMount = createEditorSaveOperationSource("tab-a", "editor-2");

    expect(firstMount).toBe("tab-a:save:editor-1");
    expect(secondMount).toBe("tab-a:save:editor-2");
    expect(secondMount).not.toBe(firstMount);
  });
});
