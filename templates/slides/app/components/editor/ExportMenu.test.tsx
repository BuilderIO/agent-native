// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const { toastMock } = vi.hoisted(() => ({
  toastMock: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  cn: (...args: unknown[]) =>
    args
      .flat(Infinity)
      .filter((v) => typeof v === "string" && v.length > 0)
      .join(" "),
}));

vi.mock("@agent-native/core/client", () => ({
  agentNativePath: (path: string) => `/agent${path}`,
  appBasePath: () => "/slides",
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: toastMock,
}));

import { ExportMenu } from "./ExportMenu";

const PPTX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

function renderMenu() {
  return render(
    <ExportMenu
      deckId="deck-1"
      deckTitle="Quarterly Review"
      onDuplicate={vi.fn()}
      onExportPdf={vi.fn()}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = vi.fn(async () => {
    return new Response(new Blob(["pptx"], { type: PPTX_CONTENT_TYPE }), {
      status: 200,
      headers: {
        "content-disposition": 'attachment; filename="quarterly.pptx"',
      },
    });
  }) as typeof fetch;
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pptx");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    () => undefined,
  );
  vi.spyOn(window, "open").mockImplementation(() => null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("<ExportMenu>", () => {
  it("exports Google Slides through the streamed PPTX endpoint", async () => {
    renderMenu();

    const trigger = screen.getByRole("button", { name: /export/i });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByText("Export to Google Slides"));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    expect(fetch).toHaveBeenCalledWith(
      "/slides/api/exports/pptx",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ deckId: "deck-1" }),
      }),
    );
    expect(String(vi.mocked(fetch).mock.calls[0][0])).not.toContain(
      "export-google-slides",
    );
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(window.open).toHaveBeenCalledWith(
      "https://docs.google.com/presentation/u/0/?usp=import",
      "_blank",
      "noopener,noreferrer",
    );
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Open in Google Slides" }),
    );
  });
});
