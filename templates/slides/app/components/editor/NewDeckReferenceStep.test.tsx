// @vitest-environment happy-dom
vi.mock("@/hooks/use-design-system-workflows", () => ({
  useDesignSystemWorkflows: () => true,
}));
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render as renderWithoutQueryClient,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Deck } from "@/context/DeckContext";
import { SLIDE_FILE_STORAGE_STATUS_KEY } from "@/hooks/use-slide-file-storage-status";

vi.mock("@agent-native/core/client/setup-connections", () => ({
  FileStorageSetupCard: () => <div data-testid="file-storage-setup-card" />,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: { title?: string }) => {
    if (key === "home.referenceImportSelected") {
      return `"${options?.title ?? ""}" is now the reference deck.`;
    }
    return (
      {
        "home.chooseReferences": "Choose references",
        "home.importFrom": "Import from",
        "home.imported": "Imported",
        "home.googleSlidesImportLabel": "Slides",
        "home.googleSlidesReferenceTitle": "Google Slides",
        "home.referenceImportSuccess": "Imported successfully",
        "home.none": "None",
        "home.continue": "Continue",
        "home.continueToGenerate": "Continue to generate",
        "home.noMatchingDecks": "No matching decks found.",
        "home.addDesignSystem": "Add design system",
      }[key] ?? key
    );
  },
}));

vi.mock("./GoogleDriveConnectionCta", () => ({
  GoogleDriveConnectionCta: () => (
    <div data-testid="google-drive-connection-cta" />
  ),
}));

vi.mock("@/components/design-system/DesignSystemSetup", () => ({
  DesignSystemSetup: ({
    open,
    onComplete,
  }: {
    open: boolean;
    onClose: () => void;
    onComplete: () => void;
  }) =>
    open ? (
      <div data-testid="design-system-setup-dialog">
        <button type="button" onClick={onComplete}>
          Finish setup
        </button>
      </div>
    ) : null,
}));

import {
  NewDeckReferenceStep,
  type ImportedReference,
} from "./NewDeckReferenceStep";

function render(ui: ReactNode, configured = true) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(SLIDE_FILE_STORAGE_STATUS_KEY, { configured });
  return renderWithoutQueryClient(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

async function renderStep(
  overrides: Partial<React.ComponentProps<typeof NewDeckReferenceStep>> = {},
  storageConfigured = true,
) {
  const onSelect = vi.fn();
  const onImport =
    vi.fn<(files: File[]) => Promise<ImportedReference | null>>();
  const onImportSource =
    vi.fn<
      (source: {
        kind: "google-docs" | "website" | "figma";
        value: string;
      }) => Promise<ImportedReference | null>
    >();
  const onOpenChange = vi.fn();
  const onDesignSystemsChanged = vi.fn();

  const props = {
    open: true,
    designSystems: [{ id: "ds-1", title: "Builder" }],
    decks: [] as Deck[],
    defaultDesignSystemId: "ds-1",
    defaultReferenceDeckId: null,
    onSelect,
    onImport,
    onImportSource,
    onSkip: vi.fn(),
    onOpenChange,
    onDesignSystemsChanged,
    title: "New presentation",
    designSystemLabel: "Design system",
    referenceDeckLabel: "Reference deck",
    chooseDeckLabel: "Match the style of an existing deck",
    importingLabel: "Importing...",
    skipLabel: "Skip",
    searchDecksLabel: "Search decks",
    ...overrides,
  };
  const view = render(<NewDeckReferenceStep {...props} />, storageConfigured);
  await act(async () => {
    await Promise.resolve();
  });

  return {
    onSelect,
    onImport,
    onImportSource,
    onOpenChange,
    onDesignSystemsChanged,
    rerender: (
      nextOverrides: Partial<
        React.ComponentProps<typeof NewDeckReferenceStep>
      > = {},
    ) => view.rerender(<NewDeckReferenceStep {...props} {...nextOverrides} />),
  };
}

describe("<NewDeckReferenceStep>", () => {
  afterEach(() => cleanup());

  it("confirms a PPTX import and keeps it selected until generation continues", async () => {
    const imported: ImportedReference = {
      id: "deck-pptx",
      title: "Reference PPT",
      source: "pptx",
      referenceFilePaths: ["/uploads/reference.pptx"],
    };
    const { onSelect, onImport } = await renderStep();
    onImport.mockResolvedValue(imported);

    const input = document.querySelector('input[accept=".pptx"]');
    expect(input).toBeTruthy();

    await act(async () => {
      fireEvent.change(input!, {
        target: {
          files: [new File(["pptx"], "reference.pptx")],
        },
      });
    });

    expect(screen.getByRole("status").textContent).toContain(
      "Imported successfully",
    );
    expect(screen.getByLabelText("PPT - Imported")).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: "Reference deck" }).textContent,
    ).toContain("Reference PPT");
    expect(
      screen.getByRole("button", { name: "Continue to generate" }),
    ).toBeTruthy();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Continue to generate" }),
      );
    });

    expect(onSelect).toHaveBeenCalledWith({
      designSystemId: null,
      referenceDeckId: "deck-pptx",
      referenceSource: null,
      referenceFilePaths: ["/uploads/reference.pptx"],
    });
  });

  it("confirms a PDF import as the selected reference deck", async () => {
    const imported: ImportedReference = {
      id: "deck-pdf",
      title: "Reference PDF",
      source: "pdf",
    };
    const { onImport } = await renderStep();
    onImport.mockResolvedValue(imported);

    const input = document.querySelector('input[accept=".pdf"]');
    expect(input).toBeTruthy();

    await act(async () => {
      fireEvent.change(input!, {
        target: {
          files: [
            new File(["pdf"], "reference.pdf", { type: "application/pdf" }),
          ],
        },
      });
    });

    expect(screen.getByRole("status").textContent).toContain("Reference PDF");
    expect(screen.getByLabelText("PDF - Imported")).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: "Reference deck" }).textContent,
    ).toContain("Reference PDF");
  });

  it("blocks file imports and explains when private storage is unavailable", async () => {
    const { onImport } = await renderStep({}, false);

    expect(document.querySelector('input[accept=".pdf"]')).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByTestId("file-storage-setup-card")).toBeTruthy();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("only labels the selected file option while importing", async () => {
    let resolveImport!: (reference: ImportedReference) => void;
    const { onImport } = await renderStep({ importing: true });
    onImport.mockReturnValue(
      new Promise((resolve) => {
        resolveImport = resolve;
      }),
    );

    await act(async () => {
      fireEvent.change(document.querySelector('input[accept=".pdf"]')!, {
        target: {
          files: [
            new File(["pdf"], "reference.pdf", { type: "application/pdf" }),
          ],
        },
      });
      await Promise.resolve();
    });

    expect(
      document.querySelector('label[aria-label="PDF - Importing..."]')
        ?.textContent,
    ).toContain("Importing...");
    expect(
      document.querySelector('label[aria-label="PPT"]')?.textContent,
    ).toContain("PPT");
    expect(
      document.querySelector('label[aria-label="DOCX"]')?.textContent,
    ).toContain("DOCX");

    await act(async () => {
      resolveImport({ id: "deck-pdf", title: "Reference PDF", source: "pdf" });
    });
  });

  it("confirms a DOCX import as the selected reference deck", async () => {
    const imported: ImportedReference = {
      id: "deck-docx",
      title: "Reference DOCX",
      source: "docx",
    };
    const { onImport } = await renderStep();
    onImport.mockResolvedValue(imported);

    const input = document.querySelector('input[accept=".docx"]');
    expect(input).toBeTruthy();

    await act(async () => {
      fireEvent.change(input!, {
        target: {
          files: [
            new File(["docx"], "reference.docx", {
              type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            }),
          ],
        },
      });
    });

    expect(screen.getByRole("status").textContent).toContain("Reference DOCX");
    expect(screen.getByLabelText("DOCX - Imported")).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: "Reference deck" }).textContent,
    ).toContain("Reference DOCX");
  });

  it("imports a Google Slides URL before showing the success state", async () => {
    const imported: ImportedReference = {
      id: "deck-google",
      title: "Quarterly plan",
      source: "google-slides",
    };
    const { onSelect, onImportSource } = await renderStep();
    onImportSource.mockResolvedValue(imported);

    fireEvent.click(screen.getByRole("button", { name: "Slides" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Google Slides link" }),
      {
        target: {
          value: "https://docs.google.com/presentation/d/deck-google/edit",
        },
      },
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    });

    expect(onImportSource).toHaveBeenCalledWith({
      kind: "google-docs",
      value: "https://docs.google.com/presentation/d/deck-google/edit",
    });
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("Quarterly plan");
    expect(screen.getByLabelText("Slides - Imported")).toBeTruthy();
  });

  it("requires a reference after Slides is deselected", async () => {
    const imported: ImportedReference = {
      id: "deck-google",
      title: "Quarterly plan",
      source: "google-slides",
    };
    const { onSelect, onImportSource } = await renderStep();
    onImportSource.mockResolvedValue(imported);

    fireEvent.click(screen.getByRole("button", { name: "Slides" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Google Slides link" }),
      {
        target: {
          value: "https://docs.google.com/presentation/d/deck-google/edit",
        },
      },
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    });

    fireEvent.click(screen.getByRole("button", { name: "Slides - Imported" }));
    expect(screen.queryByRole("status")).toBeNull();

    expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "Skip" })).toHaveProperty(
      "disabled",
      false,
    );
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("disables Continue when no reference or design system is selected", async () => {
    await renderStep({ designSystems: [], defaultDesignSystemId: null });

    expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "Skip" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("only shows Google connection recovery after choosing Slides", async () => {
    await renderStep();

    expect(screen.queryByTestId("google-drive-connection-cta")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Slides" }));

    expect(screen.getByTestId("google-drive-connection-cta")).toBeTruthy();
  });

  it("hides the recent section and sorts reference decks by recency", async () => {
    const deck = (id: string, title: string, updatedAt: string): Deck => ({
      id,
      title,
      createdAt: updatedAt,
      updatedAt,
      slides: [],
    });

    await renderStep({
      decks: [
        deck("older", "Older deck", "2026-08-01T00:00:00.000Z"),
        deck("newer", "Newer deck", "2026-08-10T00:00:00.000Z"),
      ],
    });

    expect(screen.queryByText("Recent")).toBeNull();
    fireEvent.click(screen.getByRole("combobox", { name: "Reference deck" }));

    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent?.trim())).toEqual([
      "None",
      "Newer deck",
      "Older deck",
    ]);
  });

  it("shows the last selected reference deck when the step opens", async () => {
    await renderStep({
      decks: [
        {
          id: "deck-last-used",
          title: "Last used deck",
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-10T00:00:00.000Z",
          slides: [],
        },
      ],
      defaultReferenceDeckId: "deck-last-used",
    });

    expect(
      screen.getByRole("combobox", { name: "Reference deck" }).textContent,
    ).toContain("Last used deck");
  });

  it("hydrates the default design system when the list resolves after opening", async () => {
    const { rerender } = await renderStep({
      designSystems: [],
      defaultDesignSystemId: "ds-1",
    });

    expect(screen.getAllByRole("combobox")[0]?.textContent).toContain("None");

    rerender({ designSystems: [{ id: "ds-1", title: "Builder" }] });

    expect(screen.getAllByRole("combobox")[0]?.textContent).toContain(
      "Builder",
    );
  });

  it("keeps the reference step locked until selection handling finishes", async () => {
    let resolveSelection!: () => void;
    const selection = new Promise<void>((resolve) => {
      resolveSelection = resolve;
    });
    await renderStep({ onSelect: () => selection });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    });

    expect(
      screen.getByRole("button", { name: "New presentation" }),
    ).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Skip" })).toHaveProperty(
      "disabled",
      true,
    );

    await act(async () => {
      resolveSelection();
    });

    expect(
      screen.getByRole("button", { name: "New presentation" }),
    ).toHaveProperty("disabled", false);
  });

  it("does not render an Attached section on the reference step", async () => {
    await renderStep({ promptSummary: "Some prompt" });

    expect(screen.queryByText("Attached")).toBeNull();
  });

  it("opens design system creation inline instead of navigating away", async () => {
    const { onOpenChange, onDesignSystemsChanged } = await renderStep({
      designSystems: [],
    });

    // Regression: this used to be a plain `<a target="_blank" href="/design-systems">`,
    // which opened a full-page route in a new tab. Since that route is itself
    // gated by first-run onboarding, the new tab showed onboarding from the
    // beginning instead of the design-systems page. Asserting there is no
    // anchor here, and that the step's own open/close state never fires,
    // guards against that pattern coming back for this or any other
    // create-affordance reused inside an onboarding step.
    expect(
      screen.queryByRole("link", { name: "Add design system" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add design system" }));

    expect(screen.getByTestId("design-system-setup-dialog")).not.toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));

    expect(screen.queryByTestId("design-system-setup-dialog")).toBeNull();
    expect(onDesignSystemsChanged).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("shows the placeholder until the reference deck is touched", async () => {
    await renderStep({
      decks: [
        {
          id: "deck-1",
          title: "Some deck",
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
          slides: [],
        },
      ],
    });

    expect(
      screen.getByRole("combobox", { name: "Reference deck" }).textContent,
    ).toBe("Match the style of an existing deck");
  });

  it("shows None instead of the placeholder after explicitly selecting None", async () => {
    await renderStep({
      decks: [
        {
          id: "deck-1",
          title: "Some deck",
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
          slides: [],
        },
      ],
    });

    fireEvent.click(screen.getByRole("combobox", { name: "Reference deck" }));
    fireEvent.click(screen.getByRole("option", { name: "None" }));

    const trigger = screen.getByRole("combobox", { name: "Reference deck" });
    expect(trigger.textContent).toBe("None");
    expect(trigger.textContent).not.toContain(
      "Match the style of an existing deck",
    );
  });

  it("shows the deck name in the trigger after selecting a deck", async () => {
    await renderStep({
      decks: [
        {
          id: "deck-1",
          title: "Some deck",
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
          slides: [],
        },
      ],
    });

    fireEvent.click(screen.getByRole("combobox", { name: "Reference deck" }));
    fireEvent.click(screen.getByRole("option", { name: "Some deck" }));

    expect(
      screen.getByRole("combobox", { name: "Reference deck" }).textContent,
    ).toBe("Some deck");
  });
});
