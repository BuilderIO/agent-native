// @vitest-environment happy-dom

import type { Attachment } from "@assistant-ui/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AGENT_PROMPT_MAX_TEXT_FILE_BYTES } from "./prompt-attachments.js";
import { AttachmentChip } from "./PromptComposer.js";
import { ComposerRuntimeAdaptersProvider } from "./runtime-adapters.js";

describe("AttachmentChip", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function renderChip(file: File) {
    const attachment = {
      id: "file-1",
      type: "file",
      name: file.name,
      file,
      status: { type: "requires-action", reason: "composer-send" },
    } as unknown as Attachment;
    await act(async () => {
      root.render(
        <ComposerRuntimeAdaptersProvider
          adapters={{
            translate: (_key, options) => String(options?.defaultValue ?? ""),
          }}
        >
          <AttachmentChip attachment={attachment} onRemove={() => {}} />
        </ComposerRuntimeAdaptersProvider>,
      );
    });
  }

  it("shows a file the browser cannot read before it is sent", async () => {
    const file = new File(["# Design"], "DESIGN.md", { type: "text/markdown" });
    vi.spyOn(file, "arrayBuffer").mockRejectedValue(
      new Error("NotReadableError"),
    );

    await renderChip(file);

    await vi.waitFor(() => {
      expect(container.querySelector('[role="status"]')?.textContent).toContain(
        "Couldn't read this file",
      );
    });
  });

  it("shows a text file over the read limit", async () => {
    const file = new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" });
    Object.defineProperty(file, "size", {
      value: AGENT_PROMPT_MAX_TEXT_FILE_BYTES + 1,
    });

    await renderChip(file);

    await vi.waitFor(() => {
      expect(container.textContent).toContain("File is over 8 MB");
    });
  });

  it("keeps the plain chip for a readable file", async () => {
    await renderChip(
      new File(["# Design"], "DESIGN.md", { type: "text/markdown" }),
    );

    await act(async () => {});
    expect(container.textContent).toContain("DESIGN.md");
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
