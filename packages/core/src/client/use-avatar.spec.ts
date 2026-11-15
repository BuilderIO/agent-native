// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { removeAvatar, useAvatarUrl } from "./use-avatar.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const roots: Root[] = [];

async function mountAvatar(email: string): Promise<{ current: string | null }> {
  const seen = { current: null as string | null };
  function Probe() {
    seen.current = useAvatarUrl(email);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  await act(async () => {
    root.render(React.createElement(Probe));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return seen;
}

describe("removeAvatar", () => {
  afterEach(async () => {
    await act(async () => {
      while (roots.length) roots.pop()!.unmount();
    });
    vi.unstubAllGlobals();
  });

  it("deletes the photo and shows the initials fallback to mounted readers", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "DELETE"
        ? new Response(null, { status: 204 })
        : jsonResponse({ image: "data:image/jpeg;base64,abc" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const email = "remove-ok@example.test";
    const mounted = await mountAvatar(email);
    expect(mounted.current).toBe("data:image/jpeg;base64,abc");

    await act(() => removeAvatar(email));

    expect(mounted.current).toBeNull();
    const deleteCalls = fetchMock.mock.calls.filter(
      ([, init]) => init?.method === "DELETE",
    );
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]![0]).toMatch(/\/_agent-native\/avatar$/);

    // A later reader is served the cleared photo without asking again.
    const before = fetchMock.mock.calls.length;
    const later = await mountAvatar(email);
    expect(later.current).toBeNull();
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it("throws with the status and keeps the photo when the server refuses", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "DELETE"
        ? new Response(null, { status: 403 })
        : jsonResponse({ image: "data:image/png;base64,keep" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const email = "remove-refused@example.test";
    const mounted = await mountAvatar(email);
    expect(mounted.current).toBe("data:image/png;base64,keep");

    await expect(removeAvatar(email)).rejects.toThrow(
      "Avatar removal failed: 403",
    );
    expect(mounted.current).toBe("data:image/png;base64,keep");
  });
});
