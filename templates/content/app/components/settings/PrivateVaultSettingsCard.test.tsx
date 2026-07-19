// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PrivateVaultSettingsCard } from "./PrivateVaultSettingsCard";

describe("PrivateVaultSettingsCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    delete (window as typeof window & { agentNativeDesktop?: unknown })
      .agentNativeDesktop;
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
    vi.unstubAllGlobals();
  });

  it("honestly presents desktop-only setup without collecting secrets", () => {
    act(() => root.render(<PrivateVaultSettingsCard />));
    const button = container.querySelector("button");
    expect(button?.textContent).toContain("Open desktop app to set up");
    expect(button?.disabled).toBe(true);
    expect(container.querySelectorAll("input, textarea")).toHaveLength(0);
    expect(container.textContent).not.toMatch(/enter.*(?:word|phrase)/i);
  });

  it("invokes the fixed no-argument native creation ceremony", async () => {
    const createGenesis = vi.fn(async () => ({
      ok: true as const,
      vaultId: "00112233445566778899aabbccddeeff",
    }));
    (
      window as typeof window & {
        agentNativeDesktop?: {
          privateVault: {
            createGenesis: typeof createGenesis;
            resumeGenesis: () => Promise<never>;
            recover: () => Promise<never>;
          };
        };
      }
    ).agentNativeDesktop = {
      privateVault: {
        createGenesis,
        resumeGenesis: async () => {
          throw new Error("not called");
        },
        recover: async () => {
          throw new Error("not called");
        },
      },
    };
    act(() => root.render(<PrivateVaultSettingsCard />));
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Create encrypted vault"),
    );
    expect(button).toBeDefined();
    await act(async () => button?.click());
    expect(createGenesis).toHaveBeenCalledOnce();
    expect(createGenesis).toHaveBeenCalledWith();
    expect(container.textContent).toContain(
      "Your encrypted vault ceremony is complete.",
    );
  });

  it("shows an existing vault as content-free and locked in the browser", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              version: 1,
              suite: "anc/v1",
              state: "active",
              vaultId: "11".repeat(16),
              head: { sequence: 4, hash: "22".repeat(32) },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    await act(async () => root.render(<PrivateVaultSettingsCard />));
    expect(container.textContent).toContain("Encrypted vault ready");
    expect(container.textContent).toContain("cannot read titles");
    expect(container.textContent).toContain("Open Agent Native Desktop");
  });
});
