// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
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
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function renderDialog(onClose = vi.fn()) {
  await act(async () => {
    root.render(
      <ShareDialog
        open
        onClose={onClose}
        resourceType="document"
        resourceId="doc-1"
        resourceTitle="Quarterly plan"
      />,
    );
    await Promise.resolve();
  });
  return onClose;
}

describe("ShareDialog primitive normalization", () => {
  const source = readFileSync(resolve("src/client/sharing/ShareDialog.tsx"), {
    encoding: "utf8",
  });

  it("uses Toolkit dialog, select, and button primitives", () => {
    expect(source).toContain('from "@agent-native/toolkit/ui/dialog"');
    expect(source).toContain('from "@agent-native/toolkit/ui/select"');
    expect(source).toContain('from "@agent-native/toolkit/ui/button"');
    expect(source).toContain("<DialogContent");
    expect(source.match(/\[&_svg\]:!size-auto/g)).toHaveLength(4);
    expect(source).toContain("data-[state=open]:!animate-none");
  });

  it("does not bypass Toolkit with raw portal or Radix select imports", () => {
    expect(source).not.toContain('from "react-dom"');
    expect(source).not.toContain('from "@radix-ui/react-select"');
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
