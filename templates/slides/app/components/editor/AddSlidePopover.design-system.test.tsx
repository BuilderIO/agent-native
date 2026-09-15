// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCallAction = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
  appBasePath: () => "",
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: (...args: unknown[]) => mockCallAction(...args),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/composer", () => ({
  useEagerFileUploads: () => ({
    commitFiles: vi.fn(),
    discardFiles: vi.fn(),
    retainFiles: vi.fn(),
    syncFiles: vi.fn(),
    uploadFiles: vi.fn(() => Promise.resolve([])),
    uploading: false,
    reset: vi.fn(),
  }),
  PromptComposer: ({
    onSubmit,
  }: {
    onSubmit: (text: string, files: File[]) => void;
  }) => (
    <button
      type="button"
      onClick={() => onSubmit("a slide about Apollo 11", [])}
    >
      submit-prompt
    </button>
  ),
}));

vi.mock("@/components/editor/GoogleDocImportHint", () => ({
  GoogleDocImportHint: () => null,
}));

vi.mock("@/components/editor/PromptDialog", () => ({
  isInsidePortaledLayer: () => false,
  uploadPromptFiles: vi.fn(),
}));

import { AddSlidePopover } from "./AddSlidePopover";

// get-design-system states the color mode; this is what it hands back.
const DARK_SYSTEM = {
  agentContext: [
    "## Selected Design System Context",
    'Use "Midnight" (id: ds-dark).',
    "",
    "Color mode: DARK (background token #0B0E14, text token #F7F8FA).",
  ].join("\n"),
};

function renderPopover(designSystemId: string | null) {
  const agentSubmit = vi.fn<
    (message: string, context: string) => Promise<boolean>
  >(async () => true);
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  const anchorRef = createRef<HTMLElement>() as {
    current: HTMLElement | null;
  };
  anchorRef.current = anchor;

  render(
    <AddSlidePopover
      open
      onOpenChange={vi.fn()}
      anchorRef={anchorRef}
      deckId="deck-1"
      deckTitle="Moon Landing"
      designSystemId={designSystemId}
      activeSlideId="slide-1"
      slideCount={3}
      activeSlideIndex={0}
      agentSubmit={agentSubmit}
    />,
  );

  return agentSubmit;
}

beforeEach(() => {
  mockCallAction.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("AddSlidePopover design-system propagation", () => {
  it("sends the linked dark design system with the new-slide request", async () => {
    mockCallAction.mockResolvedValue(DARK_SYSTEM);
    const agentSubmit = renderPopover("ds-dark");

    await act(async () => {
      screen.getByText("submit-prompt").click();
    });

    expect(agentSubmit).toHaveBeenCalledTimes(1);
    const context = agentSubmit.mock.calls[0]![1];
    expect(context).toContain("ds-dark");
    expect(context).toContain("Color mode: DARK");
    expect(context).toContain("#0B0E14");
    expect(context).toContain("do not apply the no-design-system");
  });

  it("still tells an unlinked deck to match its own slides", async () => {
    const agentSubmit = renderPopover(null);

    await act(async () => {
      screen.getByText("submit-prompt").click();
    });

    const context = agentSubmit.mock.calls[0]![1];
    expect(mockCallAction).not.toHaveBeenCalled();
    expect(context).toContain("no linked design system");
    expect(context).toContain("representativeSlideId");
  });
});
