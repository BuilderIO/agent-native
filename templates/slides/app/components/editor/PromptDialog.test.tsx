// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const ensureEmbedAuthFetchInterceptor = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/composer", () => ({
  PromptComposer: (props: {
    disabled?: boolean;
    onSubmit: (
      text: string,
      files: File[],
      references: unknown[],
      options: Record<string, unknown>,
    ) => void | Promise<void>;
  }) => (
    <button
      type="button"
      data-testid="prompt-composer"
      disabled={props.disabled}
      onClick={() =>
        void props.onSubmit(
          "make a deck",
          [new File(["pdf"], "large.pdf", { type: "application/pdf" })],
          [],
          {},
        )
      }
    >
      Prompt composer
    </button>
  ),
}));

vi.mock("@agent-native/core/client/host", () => ({
  ensureEmbedAuthFetchInterceptor,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    ({
      "editorToolbar.importFile": "Import file",
      "home.googleSlidesImportLabel": "Slides",
      "home.googleSlidesReferenceTitle": "Google Slides",
      "home.googleSlidesReferenceUrl": "Paste a Google Slides link",
      "raw.uploadFailed": "Upload failed",
      "raw.uploadAttachedFailed": "Upload failed",
      "raw.uploading": "Uploading...",
    })[key] ?? key,
}));

vi.mock("./GoogleDocImportHint", () => ({
  GoogleDocImportHint: () => null,
}));

vi.mock("./GoogleDriveConnectionCta", () => ({
  GoogleDriveConnectionCta: () => (
    <div data-testid="google-drive-connection-cta" />
  ),
}));

import PromptPopover, {
  isInsidePortaledLayer,
  uploadPromptFiles,
} from "./PromptDialog";

describe("isInsidePortaledLayer", () => {
  it("matches nodes inside a Radix popper layer", () => {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-radix-popper-content-wrapper", "");
    const button = document.createElement("button");
    wrapper.append(button);
    document.body.append(wrapper);

    expect(isInsidePortaledLayer(button)).toBe(true);
    wrapper.remove();
  });

  it("ignores ordinary nodes and non-elements", () => {
    const button = document.createElement("button");
    document.body.append(button);

    expect(isInsidePortaledLayer(button)).toBe(false);
    expect(isInsidePortaledLayer(document.createTextNode("x"))).toBe(false);
    expect(isInsidePortaledLayer(null)).toBe(false);
    button.remove();
  });
});

describe("uploadPromptFiles", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    ensureEmbedAuthFetchInterceptor.mockClear();
  });

  it("uses the authenticated fetch boundary for reference uploads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await uploadPromptFiles([
      new File(["pdf"], "reference.pdf", { type: "application/pdf" }),
    ]);

    expect(ensureEmbedAuthFetchInterceptor).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/uploads"),
      expect.objectContaining({
        credentials: "include",
        method: "POST",
      }),
    );
  });
});

describe("PromptPopover import mode", () => {
  afterEach(() => cleanup());

  function renderPopover(
    onImport: React.ComponentProps<typeof PromptPopover>["onImport"],
  ) {
    return render(
      <PromptPopover
        open
        centered
        onOpenChange={vi.fn()}
        title="New presentation"
        onSubmit={vi.fn()}
        onSkip={vi.fn()}
        skipLabel="Skip prompt"
        onImport={onImport}
        importFromLabel="Import from"
        importingLabel="Importing..."
      />,
    );
  }

  it("takes over the popover with a Google Slides URL form", () => {
    renderPopover(vi.fn());

    expect(screen.getByText("or import from")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Slides" }));

    expect(
      screen.getByRole("textbox", { name: "Paste a Google Slides link" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to prompt" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Prompt composer" }),
    ).toBeNull();
    expect(screen.getByTestId("google-drive-connection-cta")).toBeTruthy();
  });

  it("passes an uploaded PDF to the direct import callback", async () => {
    const onImport = vi.fn().mockResolvedValue(true);
    renderPopover(onImport);

    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    expect(screen.getByRole("button", { name: "Upload PDF" })).toBeTruthy();

    const file = new File(["pdf"], "reference.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(screen.getAllByLabelText("Import file")[0], {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(onImport).toHaveBeenCalledWith({ kind: "pdf", files: [file] });
    });
  });

  it("shows the importing state while a direct import is pending", async () => {
    let resolveImport!: (value: boolean) => void;
    const onImport = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveImport = resolve;
        }),
    );
    renderPopover(onImport);

    fireEvent.click(screen.getByRole("button", { name: "Slides" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Paste a Google Slides link" }),
      { target: { value: "https://docs.google.com/presentation/d/example" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    expect(screen.getByRole("status").textContent).toContain("Importing...");
    expect(screen.queryByRole("button", { name: "Skip prompt" })).toBeNull();

    resolveImport(true);
    await waitFor(() => {
      expect(onImport).toHaveBeenCalledWith({
        kind: "google-slides",
        url: "https://docs.google.com/presentation/d/example",
      });
    });
  });

  it("shows a busy state while prompt attachments are uploading", async () => {
    let resolveUpload!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveUpload = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onSubmit = vi.fn();

    render(
      <PromptPopover
        open
        centered
        onOpenChange={vi.fn()}
        title="New presentation"
        onSubmit={onSubmit}
        onSkip={vi.fn()}
        skipLabel="Skip prompt"
      />,
    );

    const composer = screen.getByRole("button", { name: "Prompt composer" });
    fireEvent.click(composer);

    expect(screen.getByRole("status").textContent).toContain("Uploading...");
    expect((composer as HTMLButtonElement).disabled).toBe(true);

    resolveUpload(new Response("[]", { status: 200 }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith("make a deck", []);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });
});
