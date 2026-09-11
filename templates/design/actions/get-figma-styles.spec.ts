import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeProviderApiRequest: vi.fn(),
}));

vi.mock("../server/lib/provider-api.js", () => ({
  executeProviderApiRequest: mocks.executeProviderApiRequest,
}));

import action from "./get-figma-styles.js";

function jsonEnvelope(json: unknown) {
  return { response: { ok: true, status: 200, json } };
}

describe("get-figma-styles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("summarizes styles by type from a fileUrl", async () => {
    mocks.executeProviderApiRequest.mockResolvedValue(
      jsonEnvelope({
        meta: {
          styles: [
            {
              key: "k1",
              node_id: "1:1",
              style_type: "FILL",
              name: "Brand/Primary",
              description: "Primary brand color",
            },
            {
              key: "k2",
              node_id: "1:2",
              style_type: "TEXT",
              name: "Heading/H1",
              description: "",
            },
            {
              key: "k3",
              node_id: "1:3",
              style_type: "FILL",
              name: "Brand/Secondary",
              description: null,
            },
          ],
        },
      }),
    );

    const result = await action.run({
      fileUrl: "https://www.figma.com/design/abcDEF12345/System",
    } as any);

    expect(mocks.executeProviderApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "figma",
        method: "GET",
        path: "/files/abcDEF12345/styles",
      }),
    );
    expect(result.fileKey).toBe("abcDEF12345");
    expect(result.total).toBe(3);
    expect(result.byType).toEqual({ FILL: 2, TEXT: 1 });
    expect(result.styles[0]).toEqual({
      key: "k1",
      nodeId: "1:1",
      styleType: "FILL",
      name: "Brand/Primary",
      description: "Primary brand color",
    });
    expect(result.guidance).toMatch(/Enterprise Variables API/);
  });

  it("throws when neither fileUrl nor fileKey resolves to a valid key", async () => {
    await expect(
      action.run({ fileUrl: "https://example.com/not-figma" } as any),
    ).rejects.toThrow(/Could not find a Figma file key/);
    expect(mocks.executeProviderApiRequest).not.toHaveBeenCalled();
  });

  it("throws a clear error when the provider request fails", async () => {
    mocks.executeProviderApiRequest.mockResolvedValue({
      response: { ok: false, status: 403, statusText: "Forbidden", text: "" },
    });

    await expect(action.run({ fileKey: "abcDEF12345" } as any)).rejects.toThrow(
      /Forbidden/,
    );
  });
});
