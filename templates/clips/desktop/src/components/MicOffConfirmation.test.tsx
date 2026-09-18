// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { MicOffConfirmation } from "./MicOffConfirmation";

describe("MicOffConfirmation", () => {
  it("uses a compact confirmation before recording without a microphone", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(<MicOffConfirmation onBack={vi.fn()} onContinue={vi.fn()} />);
    });

    expect(document.body.textContent).toContain("Microphone is off");
    expect(document.body.textContent).toContain(
      "This recording won't include your voice.",
    );
    expect(document.body.textContent).toContain("Go back");
    expect(document.body.textContent).toContain("Record anyway");
    expect(document.querySelector("[role='alertdialog']")).not.toBeNull();

    act(() => root.unmount());
    host.remove();
  });
});
