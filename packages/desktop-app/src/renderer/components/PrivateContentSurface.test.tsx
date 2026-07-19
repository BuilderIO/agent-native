// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PrivateContentSurface from "./PrivateContentSurface.js";

describe("PrivateContentSurface privacy disclosure", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        privateContent: {
          health: vi.fn(async () => ({ ok: false, error: "locked" })),
          list: vi.fn(async () => ({ ok: true, value: { documents: [] } })),
        },
      },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("names both intentional readers and visible hosted metadata", async () => {
    await act(async () => {
      root.render(<PrivateContentSurface onClose={vi.fn()} />);
      await Promise.resolve();
    });
    expect(container.textContent).toContain(
      "Hosted Content cannot read your pages.",
    );
    expect(container.textContent).toContain(
      "Ciphertext sizes, timing, and access patterns remain visible.",
    );
    expect(container.textContent).toContain(
      "Your chosen agent can read what you ask it to use.",
    );
    expect(container.textContent).toContain(
      "The model provider you choose can read that specific text.",
    );
    expect(container.textContent).not.toMatch(/zero.knowledge/i);
  });

  it("shows standing agent grants and requires an accessible revoke confirmation", async () => {
    const grantRef = "ab".repeat(32);
    const revokeGrant = vi.fn(async () => ({
      ok: true as const,
      value: { state: "revoked", grantRef },
    }));
    const listGrants = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: {
          grants: [
            {
              grantRef,
              subjectEndpointId: "11".repeat(16),
              subjectAgentId: "22".repeat(16),
              issuedAt: 1_721_111_111,
              expiresAt: 2_021_114_711,
              revoked: false,
              pendingRevocation: false,
            },
          ],
        },
      })
      .mockResolvedValue({ ok: true, value: { grants: [] } });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        privateContent: {
          health: vi.fn(async () => ({
            ok: true,
            value: { brokerState: "offline", broker: null },
          })),
          list: vi.fn(async () => ({ ok: true, value: { documents: [] } })),
          listGrants,
          revokeGrant,
        },
      },
    });

    await act(async () => {
      root.render(<PrivateContentSurface onClose={vi.fn()} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const summary = container.querySelector("summary");
    expect(summary).not.toBeNull();
    await act(async () => {
      (summary as HTMLElement | null)?.click();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("Agent 222222…222222");

    const revoke = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Revoke",
    );
    await act(async () => revoke?.click());
    expect(document.body.textContent).toContain("Revoke this agent’s access?");
    const confirm = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Revoke access",
    );
    await act(async () => {
      confirm?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(revokeGrant).toHaveBeenCalledWith(grantRef);
  });
});
