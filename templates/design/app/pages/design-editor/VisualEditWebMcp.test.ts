import { describe, expect, it } from "vitest";

import { hasNativeWebMcpHost } from "./VisualEditWebMcp";

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
