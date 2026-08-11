// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Deck } from "@/context/DeckContext";

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
      }[key] ?? key
    );
  },
}));

vi.mock("./GoogleDriveConnectionCta", () => ({
  GoogleDriveConnectionCta: () => (
    <div data-testid="google-drive-connection-cta" />
  ),
}));

import {
  NewDeckReferenceStep,
  type ImportedReference,
} from "./NewDeckReferenceStep";

function renderStep(
  overrides: Partial<React.ComponentProps<typeof NewDeckReferenceStep>> = {},
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

  render(
    <NewDeckReferenceStep
      open
      designSystems={[{ id: "ds-1", title: "Builder" }]}
      decks={[]}
      defaultDesignSystemId="ds-1"
      defaultReferenceDeckId={null}
      onSelect={onSelect}
      onImport={onImport}
      onImportSource={onImportSource}
      onSkip={vi.fn()}
      onOpenChange={vi.fn()}
      title="New presentation"
      designSystemLabel="Design system"
      referenceDeckLabel="Reference deck"
      chooseDeckLabel="Match the style of an existing deck"
      importingLabel="Importing..."
      skipLabel="Skip"
      searchDecksLabel="Search decks"
      {...overrides}
    />,
  );

  return { onSelect, onImport, onImportSource };
}

describe("<NewDeckReferenceStep>", () => {
  afterEach(() => cleanup());

  it("confirms a PPTX import and keeps it selected until generation continues", async () => {
    const imported: ImportedReference = {
      id: "deck-pptx",
      title: "Reference PPT",
      source: "pptx",
    };
    const { onSelect, onImport } = renderStep();
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
    });
  });

  it("confirms a PDF import as the selected reference deck", async () => {
    const imported: ImportedReference = {
      id: "deck-pdf",
      title: "Reference PDF",
      source: "pdf",
    };
    const { onImport } = renderStep();
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

  it("imports a Google Slides URL before showing the success state", async () => {
    const imported: ImportedReference = {
      id: "deck-google",
      title: "Quarterly plan",
      source: "google-slides",
    };
    const { onSelect, onImportSource } = renderStep();
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

  it("only shows Google connection recovery after choosing Slides", () => {
    renderStep();

    expect(screen.queryByTestId("google-drive-connection-cta")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Slides" }));

    expect(screen.getByTestId("google-drive-connection-cta")).toBeTruthy();
  });

  it("hides the recent section and sorts reference decks by recency", () => {
    const deck = (id: string, title: string, updatedAt: string): Deck => ({
      id,
      title,
      createdAt: updatedAt,
      updatedAt,
      slides: [],
    });

    renderStep({
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

  it("shows the last selected reference deck when the step opens", () => {
    renderStep({
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
});
