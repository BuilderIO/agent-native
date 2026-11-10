// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  openExternal: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: tauri.openExternal }));

import { parseNotices, ThirdPartyNotices } from "./ThirdPartyNotices";

const NOTICES = `# Third-party notices

The app links [transcribe.cpp](https://github.com/handy-computer/transcribe.cpp)
for on-device transcription.

## transcribe.cpp

\`\`\`
MIT License

Permission is hereby granted
\`\`\`
`;

async function renderOpen(onOpenChange = vi.fn()) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<ThirdPartyNotices open onOpenChange={onOpenChange} />);
  });
  return {
    onOpenChange,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

afterEach(() => {
  tauri.invoke.mockReset();
  tauri.openExternal.mockClear();
});

describe("ThirdPartyNotices", () => {
  it("parses headings, wrapped paragraphs and license blocks verbatim", () => {
    expect(parseNotices(NOTICES)).toEqual([
      { kind: "heading", level: 1, text: "Third-party notices" },
      {
        kind: "paragraph",
        text: "The app links [transcribe.cpp](https://github.com/handy-computer/transcribe.cpp) for on-device transcription.",
      },
      { kind: "heading", level: 2, text: "transcribe.cpp" },
      { kind: "code", text: "MIT License\n\nPermission is hereby granted" },
    ]);
  });

  it("shows the bundled notices in a dialog with a close button", async () => {
    tauri.invoke.mockResolvedValue(NOTICES);
    const view = await renderOpen();

    const dialog = document.querySelector("[role='dialog']");
    expect(dialog?.querySelector("h2")?.textContent).toBe("Acknowledgements");
    expect(dialog?.querySelector("h3")?.textContent).toBe("transcribe.cpp");
    expect(dialog?.querySelector("pre")?.textContent).toContain("MIT License");
    expect(dialog?.textContent).not.toContain("Third-party notices");
    expect(tauri.invoke).toHaveBeenCalledWith("read_third_party_notices");

    const link = dialog?.querySelector("a");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      link?.dispatchEvent(click);
    });
    expect(click.defaultPrevented).toBe(true);
    expect(tauri.openExternal).toHaveBeenCalledWith(
      "https://github.com/handy-computer/transcribe.cpp",
    );

    const close = document.querySelector<HTMLButtonElement>(
      "[role='dialog'] button[aria-label='Close']",
    );
    act(() => close?.click());
    expect(view.onOpenChange).toHaveBeenCalledWith(false);
    view.unmount();
  });

  it("shows why the notices could not be read", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    tauri.invoke.mockRejectedValue("THIRD_PARTY_NOTICES.md is missing");
    const view = await renderOpen();

    expect(document.querySelector("[role='dialog']")?.textContent).toContain(
      "THIRD_PARTY_NOTICES.md is missing",
    );
    expect(error).toHaveBeenCalled();
    view.unmount();
  });
});
