// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { i18nCatalog } from "@/i18n";

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

  async function renderCard() {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          catalog={i18nCatalog}
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <PrivateVaultSettingsCard />
        </AgentNativeI18nProvider>,
      );
      await Promise.resolve();
    });
  }

  it("honestly presents desktop-only setup without collecting secrets", async () => {
    await renderCard();
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
    await renderCard();
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
    await renderCard();
    expect(container.textContent).toContain("Encrypted vault ready");
    expect(container.textContent).toContain("cannot read titles");
    expect(container.textContent).toContain("Open Agent Native Desktop");
  });

  it("starts broker enrollment with only the active vault id and shows a public invitation", async () => {
    const vaultId = "11".repeat(16);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              version: 1,
              suite: "anc/v1",
              state: "active",
              vaultId,
              head: { sequence: 4, hash: "22".repeat(32) },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    const beginBrokerEnrollment = vi.fn(async () => ({
      ok: true as const,
      state: "awaiting-authorizer" as const,
      invitation: "public_invitation_123",
    }));
    (
      window as typeof window & { agentNativeDesktop?: unknown }
    ).agentNativeDesktop = {
      privateVault: {
        createGenesis: vi.fn(),
        resumeGenesis: vi.fn(),
        recover: vi.fn(),
        beginBrokerEnrollment,
        advanceBrokerCandidate: vi.fn(),
        advanceBrokerAuthorizer: vi.fn(),
      },
    };
    await renderCard();
    const existing = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Already have a vault"),
    );
    await act(async () => {
      existing?.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      );
      await Promise.resolve();
    });
    const addThisMac = Array.from(
      document.body.querySelectorAll<HTMLElement>("[role=menuitem]"),
    ).find((item) => item.textContent?.includes("Add this Mac as a broker"));
    expect(addThisMac).toBeDefined();
    await act(async () => addThisMac?.click());

    expect(beginBrokerEnrollment).toHaveBeenCalledWith({ vaultId });
    expect(document.body.textContent).toContain(
      "Add this Mac to your private vault",
    );
    const invitation = document.body.querySelector("textarea");
    expect(invitation?.value).toBe("public_invitation_123");
    expect(invitation?.readOnly).toBe(true);
    expect(document.body.textContent).not.toMatch(/private key|sas code/i);
  });
});
