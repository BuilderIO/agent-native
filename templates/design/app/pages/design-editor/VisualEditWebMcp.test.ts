import { describe, expect, it } from "vitest";

import {
  createVisualEditWebMcpActions,
  hasNativeWebMcpHost,
} from "./VisualEditWebMcp";

describe("hasNativeWebMcpHost", () => {
  it("recognizes a modelContext supplied by the document prototype", () => {
    const documentHost = Object.create({ modelContext: {} }) as Document;
    expect(hasNativeWebMcpHost(documentHost)).toBe(true);
  });

  it("does not treat an app-owned modelContext property as native", () => {
    const documentHost = { modelContext: {} } as unknown as Document;
    expect(hasNativeWebMcpHost(documentHost)).toBe(false);
  });
});

describe("createVisualEditWebMcpActions", () => {
  it("labels the page-local tool as the primary visual handoff", () => {
    const [action] = createVisualEditWebMcpActions({
      getPrompt: () => ({
        designId: "design_public",
        pendingEditCount: 1,
        status: "ready",
        prompt: "Apply the visual changes.",
      }),
    }) as Array<{ title?: string; description?: string }>;

    expect(action.title).toBe("Pull visual edits from Design");
    expect(action.description).toContain("before asking the user to copy");
  });
});
