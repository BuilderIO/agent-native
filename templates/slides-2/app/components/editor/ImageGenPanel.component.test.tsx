// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  agentSubmit: vi.fn(),
  promptText: "",
  styleReferenceUrls: [
    "https://cdn.example.com/style-1.png",
    "https://cdn.example.com/style-2.png",
  ],
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/toolkit/app/chat/composer/index", async () => {
  const React = await import("react");
  return {
    PromptComposer: (props: {
      actionButton?: ReactNode;
      composerRef?: {
        current: { submit?: () => Promise<boolean> } | null;
      };
      onEmptySubmit?: () => void | Promise<void>;
      onSubmit: (
        text: string,
        files: File[],
        references: unknown[],
        options: Record<string, unknown>,
      ) => void | Promise<void>;
      placeholder?: string;
    }) => {
      if (props.composerRef) {
        props.composerRef.current = {
          submit: async () => {
            if (mocks.promptText.trim()) {
              await props.onSubmit(mocks.promptText, [], [], {});
            } else {
              await props.onEmptySubmit?.();
            }
            return true;
          },
        };
      }
      return React.createElement(
        React.Fragment,
        null,
        React.createElement("textarea", {
          placeholder: props.placeholder,
          onChange: (event: Event) => {
            mocks.promptText = (
              event.currentTarget as HTMLTextAreaElement
            ).value;
          },
        }),
        props.actionButton,
      );
    },
  };
});
vi.mock("@shared/api", () => ({
  DEFAULT_STYLE_REFERENCE_URLS: mocks.styleReferenceUrls,
  normalizeReferenceUrls: (urls: string[]) => [
    ...new Set(urls.map((url) => url.trim()).filter(Boolean)),
  ],
}));
vi.mock("@/hooks/use-agent-generating", () => ({
  useAgentGenerating: () => ({ submit: mocks.agentSubmit }),
}));
vi.mock("@/components/ui/popover", async () => {
  const React = await import("react");
  return {
    Popover: ({ children, open }: { children: ReactNode; open: boolean }) =>
      open ? React.createElement("div", null, children) : null,
    PopoverAnchor: () => null,
    PopoverContent: ({ children }: { children: ReactNode }) =>
      React.createElement("div", null, children),
  };
});

import { DEFAULT_STYLE_REFERENCE_URLS } from "@shared/api";

import ImageGenPanel from "./ImageGenPanel";

describe("<ImageGenPanel>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.promptText = "";
  });

  afterEach(cleanup);

  it("submits the prompt, slide context, and enabled style references", () => {
    const onOpenChange = vi.fn();
    const referenceImageUrl = "https://cdn.example.com/reference.png";
    render(
      <ImageGenPanel
        open
        onOpenChange={onOpenChange}
        referenceImageUrls={[referenceImageUrl]}
        slideContext={{
          slideId: "slide-1",
          slideIndex: 0,
          slideContent: "<h1>Headline</h1>",
          slideLayout: "title",
          deckId: "deck-1",
          deckTitle: "Launch deck",
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "editorToolbar.generateImage 1",
      }),
    );
    fireEvent.change(
      screen.getByPlaceholderText("raw.describeImagePlaceholder"),
      {
        target: { value: "A warm editorial hero image" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "raw.generate" }));

    expect(mocks.agentSubmit).toHaveBeenCalledOnce();
    const [label, context] = mocks.agentSubmit.mock.calls[0] as [
      string,
      string,
    ];
    expect(label).toBe("A warm editorial hero image");
    expect(context).toContain("A warm editorial hero image");
    expect(context).toContain("id: slide-1");
    expect(context).toContain(referenceImageUrl);
    expect(context).not.toContain(DEFAULT_STYLE_REFERENCE_URLS[0]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps empty prompt generation available for the active slide", () => {
    const onOpenChange = vi.fn();
    render(
      <ImageGenPanel
        open
        onOpenChange={onOpenChange}
        slideContext={{
          slideId: "slide-2",
          slideIndex: 1,
          slideContent: "<h1>Second slide</h1>",
          slideLayout: "title",
          deckId: "deck-1",
          deckTitle: "Launch deck",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "raw.generate" }));

    expect(mocks.agentSubmit).toHaveBeenCalledWith(
      "Generate image for slide 2",
      expect.stringContaining("Second slide"),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
