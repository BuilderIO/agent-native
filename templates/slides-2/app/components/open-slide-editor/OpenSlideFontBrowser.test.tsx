// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  mutateAsync: vi.fn(),
  storageConfigured: true,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (...args: unknown[]) => mocks.query(...args),
  useActionMutation: () => ({ mutateAsync: mocks.mutateAsync }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    ({
      "openSlideFonts.browse": "Browse fonts",
      "openSlideFonts.title": "Google Fonts",
      "openSlideFonts.searchPlaceholder": "Search font families",
      "openSlideFonts.search": "Search",
      "openSlideFonts.searchHint": "Search the catalog",
      "openSlideFonts.noResults": "No fonts found",
      "openSlideFonts.searchFailed": "Search failed",
      "openSlideFonts.variant": "Variant",
      "openSlideFonts.previewVariant": "Preview variant",
      "openSlideFonts.previewed": "Preview ready",
      "openSlideFonts.previewSample": "Aa Bb Cc 123",
      "openSlideFonts.useForHeadings": "Use for headings",
      "openSlideFonts.useForBody": "Use for body",
      "openSlideFonts.importFailed": "Font import failed",
      "openSlideFonts.chooseFont": "Choose a font",
      "raw.uploading": "Loading",
    })[key] ?? key,
}));

vi.mock("@/hooks/use-slide-file-storage-status", () => ({
  useSlideFileStorageStatus: () => ({
    data: { configured: mocks.storageConfigured },
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/components/editor/UploadStorageGate", () => ({
  UploadStorageGate: () => null,
}));

vi.mock("@/components/ui/dialog", async () => {
  const React = await import("react");
  return {
    Dialog: ({
      open,
      children,
    }: {
      open: boolean;
      children: React.ReactNode;
    }) =>
      open ? React.createElement("div", { role: "dialog" }, children) : null,
    DialogContent: ({ children }: { children: React.ReactNode }) =>
      React.createElement("section", null, children),
    DialogHeader: ({ children }: { children: React.ReactNode }) =>
      React.createElement("header", null, children),
    DialogTitle: ({ children }: { children: React.ReactNode }) =>
      React.createElement("h2", null, children),
  };
});

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const SelectContent = ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  const SelectItem = ({
    value,
    children,
  }: {
    value: string;
    children: React.ReactNode;
  }) => React.createElement("option", { value }, children);
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value: string;
      onValueChange: (value: string) => void;
      children: React.ReactNode;
    }) =>
      (() => {
        const elements = React.Children.toArray(children).filter(
          React.isValidElement,
        );
        const content = elements.find(
          (element) => element.type === SelectContent,
        );
        return React.createElement(
          "select",
          {
            value,
            "aria-label": "Variant",
            onChange: (event: React.ChangeEvent<HTMLSelectElement>) =>
              onValueChange(event.currentTarget.value),
          },
          React.isValidElement(content)
            ? (content as React.ReactElement<{ children?: React.ReactNode }>)
                .props.children
            : null,
        );
      })(),
    SelectContent,
    SelectItem,
    SelectTrigger: () => null,
    SelectValue: () => null,
  };
});

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <div data-testid="skeleton" />,
}));

import { MemoryRouter, Route, Routes } from "react-router";

import { OpenSlideFontBrowser } from "./OpenSlideFontBrowser";

const fontsDescriptor = Object.getOwnPropertyDescriptor(document, "fonts");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (fontsDescriptor) {
    Object.defineProperty(document, "fonts", fontsDescriptor);
  } else {
    Reflect.deleteProperty(document, "fonts");
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.storageConfigured = true;
  mocks.query.mockImplementation((_action: string, args: { q: string }) => ({
    data: args.q
      ? [
          {
            family: "Inter",
            category: "sans-serif",
            variants: ["regular", "500italic"],
          },
        ]
      : [],
    isLoading: false,
    isError: false,
    error: null,
  }));
  mocks.mutateAsync.mockResolvedValue({
    id: "font-1",
    assetId: "font-1",
    family: "Inter",
    variant: "500italic",
    mimeType: "font/woff2",
    url: "https://assets.example.test/fonts/inter-500-italic.woff2",
  });
  class FontFaceMock {
    constructor(
      readonly family: string,
      readonly source: string,
      readonly descriptors: FontFaceDescriptors,
    ) {}
    load() {
      return Promise.resolve(this as unknown as FontFace);
    }
  }
  vi.stubGlobal("FontFace", FontFaceMock);
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { add: vi.fn(), delete: vi.fn() },
  });
});

describe("OpenSlideFontBrowser", () => {
  it("searches, previews an imported variant, and applies its registered handle", async () => {
    const onApply = vi.fn();
    render(
      <MemoryRouter initialEntries={["/deck/deck-2"]}>
        <Routes>
          <Route
            path="/deck/:id"
            element={
              <OpenSlideFontBrowser
                open
                onOpenChange={vi.fn()}
                disabled={false}
                onApply={onApply}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(
      screen.getByRole("textbox", { name: "Search font families" }),
      {
        target: { value: "Inter" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByRole("button", { name: /Inter/ });
    fireEvent.click(screen.getByRole("button", { name: /Inter/ }));
    fireEvent.change(screen.getByLabelText("Variant"), {
      target: { value: "500italic" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview variant" }));

    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        deckId: "deck-2",
        family: "Inter",
        variant: "500italic",
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Use for headings" }),
    );

    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: "font-1", family: "Inter" }),
      "display",
    );
  });
});
