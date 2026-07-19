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
          createVault: vi.fn(async () => ({
            ok: false,
            error: "unavailable",
          })),
          resumeVaultSetup: vi.fn(async () => ({
            ok: false,
            error: "unavailable",
          })),
          recoverVault: vi.fn(async () => ({
            ok: false,
            error: "unavailable",
          })),
          enrollPersonalBroker: vi.fn(async () => ({
            ok: false,
            error: "unavailable",
          })),
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
    expect(container.textContent).toContain(
      "Recovery words never enter this renderer or the hosted Content app.",
    );
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
            value: {
              brokerState: "offline",
              broker: {
                state: "offline",
                processing: false,
                lastOutcome: "retry_wait",
                retryAt: "2026-07-18T12:00:02.000Z",
              },
            },
          })),
          list: vi.fn(async () => ({ ok: true, value: { documents: [] } })),
          listGrants,
          listMembers: vi.fn(async () => ({
            ok: true,
            value: {
              members: [
                {
                  endpointId: "33".repeat(16),
                  role: "endpoint",
                  unattended: false,
                  current: true,
                },
              ],
            },
          })),
          revokeGrant,
          enrollPersonalBroker: vi.fn(async () => ({
            ok: true,
            state: "active",
            vaultId: "44".repeat(16),
          })),
        },
      },
    });

    await act(async () => {
      root.render(<PrivateContentSurface onClose={vi.fn()} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const summary = [...container.querySelectorAll("summary")].find(
      (candidate) => candidate.textContent === "Who can read?",
    );
    expect(summary).not.toBeNull();
    await act(async () => {
      (summary as HTMLElement | null)?.click();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("Agent 222222…222222");
    expect(container.textContent).toContain("This Mac");
    expect(container.textContent).toContain("Enroll personal agent");
    expect(container.textContent).toContain(
      "Broker offline; hosted ciphertext may be waiting",
    );

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

  it("requires attended confirmation and keeps plaintext cleanup separate from migration", async () => {
    const migrate = vi.fn(async () => ({
      ok: true as const,
      value: { state: "cutover", migrationId: "31".repeat(16) },
    }));
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        privateContent: {
          health: vi.fn(async () => ({
            ok: true,
            value: { brokerState: "offline", broker: null },
          })),
          list: vi.fn(async () => ({ ok: true, value: { documents: [] } })),
          listGrants: vi.fn(async () => ({
            ok: true,
            value: { grants: [] },
          })),
          listMembers: vi.fn(async () => ({
            ok: true,
            value: { members: [] },
          })),
          migrationCandidates: vi.fn(async () => ({
            ok: true,
            value: ["legacy-root", "legacy-child"],
          })),
          migrate,
        },
      },
    });
    await act(async () => {
      root.render(<PrivateContentSurface onClose={vi.fn()} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const summary = [...container.querySelectorAll("summary")].find(
      (candidate) => candidate.textContent === "Move from Standard Cloud",
    );
    await act(async () => {
      summary?.click();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain(
      "2 documents ready for an encrypted copy.",
    );
    const review = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Review migration",
    );
    await act(async () => review?.click());
    expect(document.body.textContent).toContain(
      "No plaintext is deleted in this step.",
    );
    const confirm = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Encrypt and verify",
    );
    await act(async () => {
      confirm?.click();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(migrate).toHaveBeenCalledWith({
      mode: "start",
      sourceDocumentIds: ["legacy-root", "legacy-child"],
    });
    expect(JSON.stringify(migrate.mock.calls)).not.toContain("vaultId");
    expect(container.textContent).toContain(
      "Standard Cloud originals remain until export and recovery are proven.",
    );
  });
});
