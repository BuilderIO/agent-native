// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const ensureEmbedAuthFetchInterceptor = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/host", () => ({
  ensureEmbedAuthFetchInterceptor,
}));

import { isInsidePortaledLayer, uploadPromptFiles } from "./PromptDialog";

describe("isInsidePortaledLayer", () => {
  it("matches nodes inside a Radix popper layer", () => {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-radix-popper-content-wrapper", "");
    const button = document.createElement("button");
    wrapper.append(button);
    document.body.append(wrapper);

    expect(isInsidePortaledLayer(button)).toBe(true);
    wrapper.remove();
  });

  it("ignores ordinary nodes and non-elements", () => {
    const button = document.createElement("button");
    document.body.append(button);

    expect(isInsidePortaledLayer(button)).toBe(false);
    expect(isInsidePortaledLayer(document.createTextNode("x"))).toBe(false);
    expect(isInsidePortaledLayer(null)).toBe(false);
    button.remove();
  });
});

describe("uploadPromptFiles", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    ensureEmbedAuthFetchInterceptor.mockClear();
  });

  it("uses the authenticated fetch boundary for reference uploads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await uploadPromptFiles([
      new File(["pdf"], "reference.pdf", { type: "application/pdf" }),
    ]);

    expect(ensureEmbedAuthFetchInterceptor).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/uploads"),
      expect.objectContaining({
        credentials: "include",
        method: "POST",
      }),
    );
  });
});
