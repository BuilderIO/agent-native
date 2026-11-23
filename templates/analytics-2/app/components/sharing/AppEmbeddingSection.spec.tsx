// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/i18n/en-US";

import type { ProjectEmbeddingSettings } from "../../../shared/app-embedding";

const embeddingState = vi.hoisted(() => ({
  settings: {
    projectId: "prj_embed",
    published: true,
    allowEmbedding: false,
    canManageEmbedding: true,
    appHref: "/analytics-2/app/prj_embed/latest",
    signedEmbedActionPath:
      "/analytics-2/_agent-native/actions/create-presigned-embed-url",
  } as ProjectEmbeddingSettings,
  setMutation: vi.fn(),
  createMutation: vi.fn(),
  refetch: vi.fn(async () => ({})),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
  };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (name: string) => ({
    data: name === "get-project-embedding" ? embeddingState.settings : undefined,
    isPending: false,
    isError: false,
    refetch: embeddingState.refetch,
  }),
  useActionMutation: (name: string) => ({
    mutateAsync:
      name === "set-project-embedding"
        ? embeddingState.setMutation
        : embeddingState.createMutation,
    isPending: false,
  }),
}));

import { AppEmbeddingSection } from "./AppEmbeddingSection";

describe("AppEmbeddingSection", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let writeText: ReturnType<typeof vi.fn>;
  let clipboardSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    embeddingState.settings = {
      projectId: "prj_embed",
      published: true,
      allowEmbedding: false,
      canManageEmbedding: true,
      appHref: "/analytics-2/app/prj_embed/latest",
      signedEmbedActionPath:
        "/analytics-2/_agent-native/actions/create-presigned-embed-url",
    };
    embeddingState.setMutation.mockReset();
    embeddingState.createMutation.mockReset();
    embeddingState.refetch.mockClear();
    writeText = vi.fn(async () => {});
    clipboardSpy = vi.spyOn(navigator, "clipboard", "get").mockReturnValue({
      writeText,
    } as unknown as Clipboard);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    clipboardSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  async function renderSection() {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider catalog={{ messages }} persistPreference={false}>
          <AppEmbeddingSection projectId="prj_embed" />
        </AgentNativeI18nProvider>,
      );
    });
  }

  it("expands embedding options, copies standard embed code and link, and toggles signed embedding", async () => {
    embeddingState.setMutation.mockResolvedValue({
      ...embeddingState.settings,
      allowEmbedding: true,
    });
    await renderSection();

    const trigger = host.querySelector<HTMLButtonElement>(
      '[data-testid="share-embedding-options"]',
    );
    expect(trigger).not.toBeNull();
    await act(async () => trigger?.click());

    const copyCodeBtn = Array.from(host.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Copy embed code"),
    );
    const copyLinkBtn = Array.from(host.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Copy embeddable link"),
    );
    expect(copyCodeBtn?.disabled).toBe(false);
    expect(copyLinkBtn?.disabled).toBe(false);

    await act(async () => copyLinkBtn?.click());
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/analytics-2/app/prj_embed/latest?embedded=true`,
    );

    await act(async () => copyCodeBtn?.click());
    expect(writeText).toHaveBeenLastCalledWith(
      `<iframe width="100%" height="600" style="border:0" src="${window.location.origin}/analytics-2/app/prj_embed/latest?embedded=true"></iframe>`,
    );

    const toggle = host.querySelector<HTMLButtonElement>(
      '[data-testid="share-signed-embedding-toggle"]',
    );
    expect(toggle).not.toBeNull();
    await act(async () => toggle?.click());
    expect(embeddingState.setMutation).toHaveBeenCalledWith({
      projectId: "prj_embed",
      allowEmbedding: true,
    });
  });

  it("disables standard embed code when signed embedding is enabled and generates presigned URLs", async () => {
    embeddingState.settings = {
      ...embeddingState.settings,
      allowEmbedding: true,
    };
    embeddingState.createMutation.mockResolvedValue({
      id: "emb_1",
      projectId: "prj_embed",
      embedPath:
        "/analytics-2/app/prj_embed/latest?embedded=true&embedToken=emb_signed_token_1234567890",
      token: "emb_signed_token_1234567890",
      expiresAt: "2026-11-22T12:00:00.000Z",
      userAttributes: {},
    });
    await renderSection();

    const trigger = host.querySelector<HTMLButtonElement>(
      '[data-testid="share-embedding-options"]',
    );
    await act(async () => trigger?.click());

    expect(host.textContent).toContain(
      "Use the signed embedding API below to generate the iframe URL",
    );
    const copyCodeBtn = Array.from(host.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Copy embed code"),
    );
    expect(copyCodeBtn?.disabled).toBe(true);

    const copyApiBtn = host.querySelector<HTMLButtonElement>(
      '[data-testid="copy-signed-embed-api-url"]',
    );
    expect(copyApiBtn).not.toBeNull();
    await act(async () => copyApiBtn?.click());
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/analytics-2/_agent-native/actions/create-presigned-embed-url`,
    );

    const generateBtn = host.querySelector<HTMLButtonElement>(
      '[data-testid="generate-presigned-embed-url"]',
    );
    expect(generateBtn).not.toBeNull();
    await act(async () => generateBtn?.click());
    expect(embeddingState.createMutation).toHaveBeenCalledWith({
      projectId: "prj_embed",
      expiresInSeconds: 3600,
      userAttributes: {},
    });
    const presignedInput = host.querySelector<HTMLInputElement>(
      'input[aria-label="Presigned embeddable link"]',
    );
    expect(presignedInput?.value).toContain("emb_signed_token_1234567890");
  });

  it("shows unpublished notice and disables copy actions when not published", async () => {
    embeddingState.settings = {
      ...embeddingState.settings,
      published: false,
      appHref: null,
    };
    await renderSection();

    const trigger = host.querySelector<HTMLButtonElement>(
      '[data-testid="share-embedding-options"]',
    );
    await act(async () => trigger?.click());

    expect(host.textContent).toContain("Publish this project before embedding");
    const copyCodeBtn = Array.from(host.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Copy embed code"),
    );
    expect(copyCodeBtn?.disabled).toBe(true);
  });
});
