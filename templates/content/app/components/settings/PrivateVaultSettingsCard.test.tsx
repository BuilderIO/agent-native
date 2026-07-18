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
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    delete (window as typeof window & { agentNativeDesktop?: unknown })
      .agentNativeDesktop;
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
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
});
