// @vitest-environment happy-dom
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { AppPinButton } from "./app-pin-button";
import { TooltipProvider } from "./ui/tooltip";

function MovingRow() {
  const [pinned, setPinned] = useState(false);
  const button = (
    <AppPinButton
      appId="mail"
      name="Mail"
      pinned={pinned}
      onToggle={() => setPinned((value) => !value)}
    />
  );
  return (
    <TooltipProvider>
      <section data-section="pinned">{pinned ? button : null}</section>
      <section data-section="apps">{pinned ? null : button}</section>
    </TooltipProvider>
  );
}

describe("AppPinButton", () => {
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

  it("keeps focus on the app's pin button after pinning moves its row", async () => {
    await act(async () => root.render(<MovingRow />));
    const before = container.querySelector<HTMLButtonElement>(
      '[data-pin-app-id="mail"]',
    )!;
    before.focus();

    await act(async () => before.click());
    await act(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );

    const after = container.querySelector<HTMLButtonElement>(
      '[data-section="pinned"] [data-pin-app-id="mail"]',
    );
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
    expect(document.activeElement).toBe(after);
  });
});
