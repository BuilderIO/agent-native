// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sharesQuery = {
  data: {
    ownerEmail: "owner@example.test",
    orgId: "org-1",
    visibility: "private" as const,
    role: "owner" as const,
    shares: [],
  },
  refetch: vi.fn(),
};

vi.mock("../use-action.js", () => ({
  useActionQuery: () => sharesQuery,
  useActionMutation: () => ({ mutate: vi.fn() }),
}));
vi.mock("../i18n.js", () => ({
  useT: () => (key: string, values?: Record<string, string>) =>
    values?.title ?? values?.type ?? key,
}));

import { ShareDialog } from "./ShareDialog.js";

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ members: [] }),
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  queryClient.clear();
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function renderDialog(onClose = vi.fn()) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ShareDialog
          open
          onClose={onClose}
          resourceType="document"
          resourceId="doc-1"
          resourceTitle="Quarterly plan"
        />
      </QueryClientProvider>,
    );
    await Promise.resolve();
  });
  return onClose;
}

describe("ShareDialog primitive normalization", () => {
  const source = readFileSync(resolve("src/client/sharing/ShareDialog.tsx"), {
    encoding: "utf8",
  });

  it("routes sharing controls through the registered design system", () => {
    expect(source).toContain('from "@agent-native/toolkit/design-system"');
    expect(source).toContain("<DesignSystemDialog");
    expect(source).toContain("<Picker");
    expect(source).toContain("<TextField");
    expect(source).toContain("<DesignSystemAvatar");
    expect(source).toContain("<Status");
    expect(source).toContain("<ActionButton");
  });

  it("does not bypass Toolkit with raw portal or Radix select imports", () => {
    expect(source).not.toContain('from "react-dom"');
    expect(source).not.toContain('from "@agent-native/toolkit/ui/select"');
  });

  it("moves focus into the modal and closes on Escape", async () => {
    const onClose = await renderDialog();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');

    expect(dialog).not.toBeNull();
    expect(dialog?.contains(document.activeElement)).toBe(true);

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the overlay is pressed", async () => {
    const onClose = await renderDialog();
    const overlay = document.querySelector<HTMLElement>(
      '[data-state="open"].fixed.inset-0',
    );
    expect(overlay).not.toBeNull();

    act(() => {
      overlay?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
      );
      overlay?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
