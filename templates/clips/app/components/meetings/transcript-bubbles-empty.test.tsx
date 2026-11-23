// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { TranscriptBubbles } from "./transcript-bubbles";

describe("TranscriptBubbles with no segments", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  const render = (props: { isLive: boolean; unreadable?: boolean }) =>
    act(async () => {
      root.render(
        <TooltipProvider>
          <TranscriptBubbles segments={[]} {...props} />
        </TooltipProvider>,
      );
    });

  it("says a transcript that can't be parsed couldn't be read, not that there is none", async () => {
    await render({ isLive: false, unreadable: true });

    expect(host.textContent).toContain("transcriptBubbles.unreadable");
    expect(host.textContent).not.toContain("transcriptBubbles.noTranscript");
    expect(host.textContent).not.toContain(
      "transcriptBubbles.liveTranscriptDescription",
    );
  });

  it("still says no transcript yet when there is none", async () => {
    await render({ isLive: false });

    expect(host.textContent).toContain("transcriptBubbles.noTranscript");
    expect(host.textContent).not.toContain("transcriptBubbles.unreadable");
  });

  it("keeps listening on a running meeting, since new lines will replace what can't be read", async () => {
    await render({ isLive: true, unreadable: true });

    expect(host.textContent).toContain("transcriptBubbles.listening");
    expect(host.textContent).not.toContain("transcriptBubbles.unreadable");
  });
});
