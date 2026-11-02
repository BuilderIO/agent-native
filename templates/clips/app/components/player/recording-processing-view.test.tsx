// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PageHeaderSlotProvider } from "@/components/library/page-header";
import messages from "@/i18n/en-US";

import { RecordingProcessingView } from "./recording-processing-view";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => {
    let node: unknown = messages;
    for (const part of key.split("."))
      node =
        node && typeof node === "object" ? Reflect.get(node, part) : undefined;
    if (typeof node !== "string") throw new Error(`Missing message: ${key}`);
    return node;
  },
}));

let container: HTMLDivElement;
let header: HTMLDivElement;
let root: Root;
async function render(progress: number, isPrivateRecipient = false) {
  await act(async () =>
    root.render(
      <PageHeaderSlotProvider slot={header}>
        <RecordingProcessingView
          breadcrumb={<span>Library / Test Clip</span>}
          isPrivateRecipient={isPrivateRecipient}
          progress={progress}
        />
      </PageHeaderSlotProvider>,
    ),
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  header = document.createElement("div");
  document.body.append(header, container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  header.remove();
});

describe("pending recording media", () => {
  it("keeps progress and the current Clip in the workspace header without offering playback sharing", async () => {
    await render(42, true);
    expect(header.textContent).toContain("Library / Test Clip");
    expect(header.textContent).toContain(messages.recordingPage.sharedWithYou);
    expect(container.querySelector("main")).not.toBeNull();
    expect(container.textContent).toContain(
      messages.recordingPage.finishingClip,
    );
    expect(container.textContent).toContain(
      messages.recordingPage.uploadingAssembling,
    );
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(header.querySelector("button")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(
      container
        .querySelector('[role="progressbar"]')
        ?.getAttribute("aria-valuenow"),
    ).toBe("42");
  });

  it("omits unknown progress and bounds reported progress at completion", async () => {
    await render(0);
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(header.textContent).not.toContain(
      messages.recordingPage.sharedWithYou,
    );
    await render(200);
    expect(
      container
        .querySelector('[role="progressbar"]')
        ?.getAttribute("aria-valuenow"),
    ).toBe("100");
    expect(
      container
        .querySelector('[role="progressbar"]')
        ?.getAttribute("aria-valuemax"),
    ).toBe("100");
  });
});
