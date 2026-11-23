// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useActionQuery: () => ({
    isPending: false,
    isError: false,
    data: {
      turns: [
        {
          receipt: { messageId: "m1" },
          denied: false,
          toolReceipts: [],
          durationMs: null,
          answerBlocks: [{ text: "For a QA fixture, use only these rows" }],
          chartArtifacts: [],
        },
      ],
    },
  }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@/components/notebook/MarkdownCellView", () => ({
  MarkdownCellView: ({ markdown }: { markdown: string }) => <p>{markdown}</p>,
}));
vi.mock("@/components/notebook/VegaChart", () => ({ VegaChart: () => null }));

import { SharedAskThread } from "./AskThreadContents";

describe("shared ask thread landmarks", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("exposes the thread panel and message landmarks the chat surface does", () => {
    act(() =>
      root.render(<SharedAskThread threadId="t1" identity="a@b.test" />),
    );
    expect(host.querySelector(".agent-panel-root")).not.toBeNull();
    expect(host.querySelectorAll(".agentkit-message")).toHaveLength(1);
  });
});
