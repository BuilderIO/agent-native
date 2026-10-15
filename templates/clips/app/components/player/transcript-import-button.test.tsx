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

    expect(onImport).toHaveBeenLastCalledWith({ text: VTT, replace: true });
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

  it("rejects a file over the size cap without reading it", async () => {
    const onImport = vi.fn();
    render(onImport);
    const file = new File([VTT], "huge.vtt");
    Object.defineProperty(file, "size", { value: 8_000_001 });
    const text = vi.spyOn(file, "text");

    await pick(file);

    expect(text).not.toHaveBeenCalled();
    expect(onImport).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "transcriptImport.invalidFile huge.vtt",
      { description: "transcriptImport.errorTooLarge" },
    );
  });
});
