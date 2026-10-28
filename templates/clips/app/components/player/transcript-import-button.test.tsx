// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { TranscriptPanel, type TranscriptPanelProps } from "./transcript-panel";

const toastError = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({ toast: { error: toastError } }));

vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
  appPath: (path: string) => path,
}));

vi.mock("@agent-native/toolkit/app/settings", () => ({
  openBuilderConnectPopup: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, string>) =>
    values ? `${key} ${Object.values(values).join(" ")}`.trim() : key,
}));

vi.mock("@/lib/utils", () => ({
  cn: (...classes: Array<string | false | null | undefined>) =>
    classes.filter(Boolean).join(" "),
}));

const VTT = "WEBVTT\n\n00:00.000 --> 00:02.000\nHello there.\n";
const READY: Partial<TranscriptPanelProps> = {
  status: "ready",
  segments: [{ startMs: 0, endMs: 2000, text: "Automatic words." }],
};

describe("transcript file import", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    toastError.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(
    onImport: (request: unknown) => Promise<unknown>,
    props: Partial<TranscriptPanelProps> = { status: "pending" },
  ) {
    act(() => {
      root.render(
        <TooltipProvider>
          <TranscriptPanel
            segments={[]}
            currentMs={0}
            onSeek={vi.fn()}
            onImportTranscript={onImport}
            {...props}
          />
        </TooltipProvider>,
      );
    });
  }

  async function pick(file: File) {
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      value: [file],
      configurable: true,
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  it("asks to replace a transcript that became ready after the panel loaded, through the panel's switch to ready", async () => {
    const onImport = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("conflict"), {
          errorCode: "transcript_exists",
        }),
      )
      .mockResolvedValueOnce({});
    render(onImport);

    await pick(new File([VTT], "talk.vtt"));
    expect(onImport).toHaveBeenCalledWith({ text: VTT, replace: false });
    expect(document.body.textContent).toContain(
      "transcriptImport.replaceDescription talk.vtt",
    );

    // The conflict's refetch shows the ready transcript, which mounts the
    // header's import button in place of the pending state's.
    render(onImport, READY);
    expect(document.body.textContent).toContain(
      "transcriptImport.replaceDescription talk.vtt",
    );

    const replace = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "transcriptImport.replace",
    )!;
    await act(async () => replace.click());

    expect(onImport).toHaveBeenLastCalledWith({
      text: VTT,
      replace: true,
      replaceImportId: null,
    });
  });

  it("asks again when another import replaced the one the user agreed to replace", async () => {
    const onImport = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("conflict"), {
          errorCode: "transcript_exists",
          details: { source: "imported", importId: "import-2" },
        }),
      )
      .mockResolvedValueOnce({});
    render(onImport, { ...READY, transcriptImportId: "import-1" });
    const confirm = () =>
      act(async () =>
        [...document.body.querySelectorAll("button")]
          .find((button) => button.textContent === "transcriptImport.replace")!
          .click(),
      );

    await pick(new File([VTT], "talk.vtt"));
    await confirm();
    expect(onImport).toHaveBeenLastCalledWith({
      text: VTT,
      replace: true,
      replaceImportId: "import-1",
    });
    expect(document.body.textContent).toContain(
      "transcriptImport.replaceDescription talk.vtt",
    );

    await confirm();
    expect(onImport).toHaveBeenLastCalledWith({
      text: VTT,
      replace: true,
      replaceImportId: "import-2",
    });
  });

  it("does not ask to replace after any other failure", async () => {
    const onImport = vi.fn().mockRejectedValueOnce(new Error("offline"));
    render(onImport);

    await pick(new File([VTT], "talk.vtt"));

    expect(onImport).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain(
      "transcriptImport.replaceDescription",
    );
  });

  it("says the file couldn't be read when reading it fails", async () => {
    const onImport = vi.fn();
    render(onImport);
    const file = new File([VTT], "moved.vtt");
    vi.spyOn(file, "arrayBuffer").mockRejectedValue(
      new Error("NotReadableError"),
    );

    await pick(file);

    expect(onImport).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "transcriptImport.invalidFile moved.vtt",
    );
  });

  it("rejects a file that isn't UTF-8 instead of importing replacement characters", async () => {
    const onImport = vi.fn();
    render(onImport);
    // "0:00 Café" saved as Latin-1, where é is the single byte 0xE9.
    const latin1 = [...new TextEncoder().encode("0:00 Caf"), 0xe9];

    await pick(new File([new Uint8Array(latin1)], "legacy.txt"));

    expect(onImport).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "transcriptImport.invalidFile legacy.txt",
      { description: "transcriptImport.errorNotUtf8" },
    );
  });

  it("rejects a file over the size cap without reading it", async () => {
    const onImport = vi.fn();
    render(onImport);
    const file = new File([VTT], "huge.vtt");
    Object.defineProperty(file, "size", { value: 8_000_001 });
    const read = vi.spyOn(file, "arrayBuffer");

    await pick(file);

    expect(read).not.toHaveBeenCalled();
    expect(onImport).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "transcriptImport.invalidFile huge.vtt",
      { description: "transcriptImport.errorTooLarge" },
    );
  });
});
