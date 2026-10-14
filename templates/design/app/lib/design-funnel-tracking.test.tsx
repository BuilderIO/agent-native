// @vitest-environment happy-dom

import { GUIDED_QUESTIONS_SUBMITTED_EVENT } from "@agent-native/toolkit/app/chat/agentkit-chat";
import { BOARD_FILENAME } from "@shared/board-file";
import { promptLengthBucket } from "@shared/prompt-length-bucket";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  designPromptReferenceTypes,
  trackDesignPromptSubmitted,
  resetDesignReadyViewsForTest,
  useDesignReadyViewTracking,
  useDesignVariantPickTracking,
  variantPickFromGuidedSubmit,
} from "./design-funnel-tracking";

const mocks = vi.hoisted(() => ({
  trackDesignRelay: vi.fn(),
  readAgentRunStatus: vi.fn(),
}));

vi.mock("@/lib/agent-run-status", () => ({
  readAgentRunStatus: (...args: unknown[]) => mocks.readAgentRunStatus(...args),
}));

vi.mock("@/lib/design-relay-tracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./design-relay-tracking")>()),
  trackDesignRelay: (...args: unknown[]) => mocks.trackDesignRelay(...args),
}));

type File = {
  id: string;
  filename: string;
  fileType: string;
  content: string;
  updatedAt: string;
};

const screen = (id: string, updatedAt = "t1", content = "<main/>"): File => ({
  id,
  filename: `${id}.html`,
  fileType: "html",
  content,
  updatedAt,
});

type ReadyProps = Parameters<typeof useDesignReadyViewTracking>[0];

let container: HTMLDivElement;
let root: Root;
let visibility: DocumentVisibilityState = "visible";

function ReadyHarness(props: ReadyProps) {
  useDesignReadyViewTracking(props);
  return null;
}

function readyEvents() {
  return mocks.trackDesignRelay.mock.calls.filter(
    ([name]) => name === "design_ready_viewed",
  );
}

async function renderReady(props: Partial<ReadyProps> = {}) {
  const full: ReadyProps = {
    designId: "design-1",
    isOwner: true,
    designLoaded: true,
    files: [],
    ...props,
  };
  await act(async () => {
    root.render(<ReadyHarness {...full} />);
  });
  return full;
}

async function flushRunStatus() {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

// The run the status mock reports, so a confirmation always concerns the run
// that just ended unless a test says otherwise.
let lastRunId = "run-1";

async function agentRun(detail: {
  isRunning: boolean;
  runId?: string;
  threadId?: string;
}) {
  if (detail.runId !== "") lastRunId = detail.runId ?? "run-1";
  await act(async () => {
    window.dispatchEvent(
      new CustomEvent("agentNative.chatRunning", {
        detail: { threadId: "thread-1", runId: "run-1", ...detail },
      }),
    );
  });
  await flushRunStatus();
}

function setUrl(search: string) {
  window.history.replaceState(null, "", `/design/design-1${search}`);
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.trackDesignRelay.mockReset();
  mocks.readAgentRunStatus.mockReset();
  lastRunId = "run-1";
  mocks.readAgentRunStatus.mockImplementation(async () => ({
    ok: true,
    status: "completed",
    active: false,
    runId: lastRunId,
    terminalReason: "done",
  }));
  resetDesignReadyViewsForTest();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  setUrl("");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("design_prompt_submitted helpers", () => {
  it("never sends a `source` property, which the browser relay overwrites", () => {
    trackDesignPromptSubmitted({
      outputId: "design-1",
      source: "suggestion_chip",
      prompt: "A landing page",
      referenceTypes: [],
      startMode: "design",
    });
    const [, properties] = mocks.trackDesignRelay.mock.calls[0]!;
    expect(properties).not.toHaveProperty("source");
    expect(properties).toMatchObject({ prompt_source: "suggestion_chip" });
  });

  it("buckets prompt length without carrying text", () => {
    expect(promptLengthBucket("   ")).toBe("0");
    expect(promptLengthBucket("a".repeat(50))).toBe("1-50");
    expect(promptLengthBucket("a".repeat(51))).toBe("50-500");
    expect(promptLengthBucket("a".repeat(501))).toBe("500+");
  });

  it("names each reference type once from context keys, files and picks", () => {
    expect(
      designPromptReferenceTypes({
        contextItems: [
          { key: "design-home-template" },
          { key: "design-home-system" },
          { key: "design-home-reference:figma:FILEKEY:node-1" },
          { key: "design-home-reference:figma:FILEKEY:node-2" },
          { key: "design-home-reference:website:https://x.test:x" },
          { key: "design-home-reference:design::d-2" },
          { key: "unrelated" },
        ],
        files: [{ type: "image/png" }, { type: "application/pdf" }],
        templateSelected: true,
        designSystemId: "system-1",
      }),
    ).toEqual([
      "design",
      "design_system",
      "figma",
      "file",
      "image",
      "template",
      "url",
    ]);
    expect(
      designPromptReferenceTypes({
        templateSelected: false,
        designSystemId: null,
      }),
    ).toEqual([]);
  });
});

describe("design_ready_viewed", () => {
  it("fires once, with the run id, when an agent run completes having changed the screens", async () => {
    await renderReady({ files: [screen("a")] });
    await agentRun({ isRunning: true });
    await agentRun({ isRunning: true });
    await renderReady({ files: [screen("a", "t2"), screen("b")] });
    expect(readyEvents()).toHaveLength(0);
    await agentRun({ isRunning: false });
    await agentRun({ isRunning: false });
    await renderReady({ files: [screen("a", "t2"), screen("b")] });

    expect(mocks.readAgentRunStatus).toHaveBeenCalledWith("thread-1");
    expect(readyEvents()).toEqual([
      [
        "design_ready_viewed",
        {
          output_id: "design-1",
          output_type: "design",
          screen_count: 2,
          is_owner: true,
          run_id: "run-1",
        },
      ],
    ]);
  });

  it("fires for a completed run even when the editor's file list has not caught up", async () => {
    await renderReady({ files: [screen("a")] });
    await agentRun({ isRunning: true });
    await agentRun({ isRunning: false });
    expect(readyEvents()).toHaveLength(1);
    expect(readyEvents()[0]![1]).toMatchObject({
      run_id: "run-1",
      screen_count: 1,
    });
  });

  it("sends nothing when the editor closes while a run is being confirmed", async () => {
    let resolveStatus: (value: unknown) => void = () => {};
    mocks.readAgentRunStatus.mockImplementationOnce(
      () => new Promise((resolve) => (resolveStatus = resolve)),
    );
    await renderReady({ files: [screen("a")] });
    await agentRun({ isRunning: true });
    await agentRun({ isRunning: false });
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => {
      resolveStatus({
        ok: true,
        status: "completed",
        active: false,
        runId: "run-1",
      });
    });
    await flushRunStatus();
    expect(readyEvents()).toHaveLength(0);
  });

  it("never fires for a run the server reports errored, aborted, truncated, or cannot read", async () => {
    for (const [index, run] of [
      { ok: true, status: "errored", active: false, runId: "run-0" },
      { ok: true, status: "aborted", active: false, runId: "run-1" },
      { ok: true, status: "truncated", active: false, runId: "run-2" },
      { ok: false },
    ].entries()) {
      mocks.readAgentRunStatus.mockResolvedValueOnce(run);
      const runId = `run-${index}`;
      await renderReady({ files: [screen("a", `before-${index}`)] });
      await agentRun({ isRunning: true, runId });
      await renderReady({ files: [screen("a", `after-${index}`)] });
      await agentRun({ isRunning: false, runId });
    }
    expect(mocks.readAgentRunStatus).toHaveBeenCalledTimes(4);
    expect(readyEvents()).toHaveLength(0);
  });

  it("never fires for a truncated run the route reports as completed", async () => {
    for (const terminalReason of [
      "no_progress",
      "run_timeout",
      "stream_ended",
    ]) {
      const runId = `run-${terminalReason}`;
      mocks.readAgentRunStatus.mockResolvedValueOnce({
        ok: true,
        status: "completed",
        active: false,
        runId,
        terminalReason,
      });
      await renderReady({ files: [screen("a")] });
      await agentRun({ isRunning: true, runId });
      await agentRun({ isRunning: false, runId });
    }
    expect(readyEvents()).toHaveLength(0);
  });

  it("reads again when the terminal reason is not written yet", async () => {
    vi.useFakeTimers();
    try {
      mocks.readAgentRunStatus.mockResolvedValueOnce({
        ok: true,
        status: "completed",
        active: false,
        runId: "run-1",
      });
      await renderReady({ files: [screen("a")] });
      await agentRun({ isRunning: true });
      await agentRun({ isRunning: false });
      expect(readyEvents()).toHaveLength(0);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(mocks.readAgentRunStatus).toHaveBeenCalledTimes(2);
      expect(readyEvents()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not credit a run with the status of a newer run in the same thread", async () => {
    mocks.readAgentRunStatus.mockResolvedValue({
      ok: true,
      status: "completed",
      active: false,
      runId: "run-newer",
    });
    await renderReady({ files: [screen("a")] });
    await agentRun({ isRunning: true });
    await renderReady({ files: [screen("a", "t2")] });
    await agentRun({ isRunning: false });
    expect(readyEvents()).toHaveLength(0);
  });

  it("waits for a run the server still reports active, then gives up", async () => {
    vi.useFakeTimers();
    try {
      mocks.readAgentRunStatus.mockResolvedValue({
        ok: true,
        status: "running",
        active: true,
        runId: "run-1",
      });
      await renderReady({ files: [screen("a")] });
      await agentRun({ isRunning: true });
      await renderReady({ files: [screen("a", "t2")] });
      await agentRun({ isRunning: false });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(mocks.readAgentRunStatus).toHaveBeenCalledTimes(3);
      expect(readyEvents()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not fire for a non-owner, for a design with no screens, or for runs seen before the design loaded", async () => {
    await renderReady({ files: [screen("a")], isOwner: false });
    await agentRun({ isRunning: true, runId: "run-a" });
    await agentRun({ isRunning: false, runId: "run-a" });

    const board = {
      id: "board",
      filename: BOARD_FILENAME,
      fileType: "html",
      content: "<b/>",
      updatedAt: "t1",
    };
    await renderReady({ files: [board] });
    await agentRun({ isRunning: true, runId: "run-b" });
    await agentRun({ isRunning: false, runId: "run-b" });

    await renderReady({ files: [], designLoaded: false });
    await agentRun({ isRunning: true, runId: "run-c" });
    await renderReady({ files: [screen("c")] });
    await agentRun({ isRunning: false, runId: "run-c" });

    expect(readyEvents()).toHaveLength(0);
  });

  it("confirms a run once even when its end is signalled twice in a row", async () => {
    await renderReady({ files: [screen("a")] });
    await agentRun({ isRunning: true });
    await renderReady({ files: [screen("a", "t2")] });
    await act(async () => {
      for (let i = 0; i < 2; i += 1) {
        window.dispatchEvent(
          new CustomEvent("agentNative.chatRunning", {
            detail: { threadId: "thread-1", runId: "run-1", isRunning: false },
          }),
        );
      }
    });
    await flushRunStatus();
    expect(mocks.readAgentRunStatus).toHaveBeenCalledTimes(1);
    expect(readyEvents()).toHaveLength(1);
  });

  it("reports a run once even when the editor mounts the tracker twice", async () => {
    function TwoTrackers(props: ReadyProps) {
      useDesignReadyViewTracking(props);
      useDesignReadyViewTracking(props);
      return null;
    }
    await act(async () => {
      root.render(
        <TwoTrackers
          designId="design-1"
          isOwner
          designLoaded
          files={[screen("a")]}
        />,
      );
    });
    await agentRun({ isRunning: true });
    await agentRun({ isRunning: false });
    expect(readyEvents()).toHaveLength(1);
  });

  it("ignores run signals without a run id or thread", async () => {
    await renderReady({ files: [screen("a")] });
    await agentRun({ isRunning: true, runId: "" });
    await renderReady({ files: [screen("a", "t2")] });
    await agentRun({ isRunning: false, runId: "" });
    expect(mocks.readAgentRunStatus).not.toHaveBeenCalled();
    expect(readyEvents()).toHaveLength(0);
  });

  it("waits for the tab to be visible and drops the send if the page leaves", async () => {
    visibility = "hidden";
    await renderReady({ files: [screen("a")] });
    await agentRun({ isRunning: true });
    await renderReady({ files: [screen("a", "t2")] });
    await agentRun({ isRunning: false });
    expect(readyEvents()).toHaveLength(0);
    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(readyEvents()).toHaveLength(1);

    visibility = "hidden";
    await agentRun({ isRunning: true, runId: "run-2" });
    await renderReady({ files: [screen("a", "t3")] });
    await agentRun({ isRunning: false, runId: "run-2" });
    await act(async () => root.unmount());
    root = createRoot(container);
    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(readyEvents()).toHaveLength(1);
  });

  it("reports a generate-design link's attempt once per page", async () => {
    setUrl("?generation_attempt_id=attempt_1234567890abcdef");
    await renderReady({ files: [screen("a")] });
    await renderReady({ files: [screen("a", "t2")] });
    await act(async () => root.unmount());
    root = createRoot(container);
    await renderReady({ files: [screen("a")] });
    expect(readyEvents()).toEqual([
      [
        "design_ready_viewed",
        expect.objectContaining({
          generation_attempt_id: "attempt_1234567890abcdef",
          screen_count: 1,
        }),
      ],
    ]);
  });

  it("ignores an invalid link attempt, a non-owner link open, and a link with no screens", async () => {
    setUrl("?generation_attempt_id=short");
    await renderReady({ files: [screen("a")] });
    setUrl("?generation_attempt_id=attempt_1234567890abcdef");
    await renderReady({ files: [screen("a")], isOwner: false });
    await renderReady({ files: [] });
    expect(readyEvents()).toHaveLength(0);
  });

  it("never reports one design's link attempt against the next design opened in the page", async () => {
    setUrl("?generation_attempt_id=attempt_1234567890abcdef");
    await renderReady({ files: [screen("a")], isOwner: false });
    window.history.replaceState(null, "", "/design/design-2");
    await renderReady({ designId: "design-2", files: [screen("b")] });
    expect(readyEvents()).toHaveLength(0);
  });

  it("reports a newer link's attempt on the same design", async () => {
    setUrl("?generation_attempt_id=attempt_aaaaaaaaaaaaaaaa");
    await renderReady({ files: [screen("a")] });
    setUrl("?generation_attempt_id=attempt_bbbbbbbbbbbbbbbb");
    await renderReady({ files: [screen("a")] });
    expect(
      readyEvents().map(([, properties]) => properties.generation_attempt_id),
    ).toEqual(["attempt_aaaaaaaaaaaaaaaa", "attempt_bbbbbbbbbbbbbbbb"]);
  });

  it("keeps the editor working when tracking throws", async () => {
    mocks.trackDesignRelay.mockImplementation(() => {
      throw new Error("analytics down");
    });
    mocks.readAgentRunStatus.mockRejectedValue(new Error("network"));
    await renderReady({ files: [screen("a")] });
    await agentRun({ isRunning: true });
    await expect(
      renderReady({ files: [screen("a", "t2")] }),
    ).resolves.toBeTruthy();
    await agentRun({ isRunning: false });
  });
});

// Mirrors the option values present-design-variants writes.
function variantQuestionsFor(designId: string) {
  return [
    {
      id: "variant",
      options: ["A", "B", "C"].map((label, index) => ({
        label,
        value: `Keep "${label}" (s${index}.html, file id s${index}) from variant set Vset_123abc. Delete each other variant screen at most once: x. Then call get-design-snapshot exactly once with designId ${designId} and fileId s${index} (filename s${index}.html).`,
      })),
    },
  ];
}
const variantQuestions = variantQuestionsFor("design-1");

function VariantHarness() {
  useDesignVariantPickTracking();
  return null;
}

function submitGuided(detail: unknown) {
  window.dispatchEvent(
    new CustomEvent(GUIDED_QUESTIONS_SUBMITTED_EVENT, { detail }),
  );
}

describe("design_variant_picked", () => {
  it("reads the picked option of a variant pick and nothing else", () => {
    expect(
      variantPickFromGuidedSubmit({
        questions: variantQuestions,
        answers: { variant: variantQuestions[0].options[1].value },
      }),
    ).toEqual({
      variantCount: 3,
      pickedIndex: 1,
      variantSetId: "Vset_123abc",
      designId: "design-1",
    });
    expect(
      variantPickFromGuidedSubmit({
        questions: [
          { id: "variant", options: [{ value: "Explore a few options" }] },
        ],
        answers: { variant: "Explore a few options" },
      }),
    ).toBeNull();
    expect(
      variantPickFromGuidedSubmit({
        questions: variantQuestions,
        answers: { variant: "__other__:something" },
      }),
    ).toBeNull();
    expect(variantPickFromGuidedSubmit(null)).toBeNull();
  });

  it("fires once per variant submit, not for other guided questions", async () => {
    await act(async () => root.render(<VariantHarness />));
    submitGuided({
      stateKey: "show-questions:design-1",
      questions: [{ id: "q1", options: [{ value: "7d" }] }],
      answers: { q1: "7d" },
    });
    expect(mocks.trackDesignRelay).not.toHaveBeenCalled();

    submitGuided({
      stateKey: "guided-questions",
      questions: variantQuestions,
      answers: { variant: variantQuestions[0].options[2].value },
    });
    expect(mocks.trackDesignRelay.mock.calls).toEqual([
      [
        "design_variant_picked",
        {
          output_id: "design-1",
          output_type: "design",
          variant_count: 3,
          picked_index: 2,
          variant_set_id: "Vset_123abc",
        },
      ],
    ]);

    await act(async () => root.render(null));
    submitGuided({
      questions: variantQuestions,
      answers: { variant: variantQuestions[0].options[0].value },
    });
    expect(mocks.trackDesignRelay).toHaveBeenCalledTimes(1);
  });

  it("records the design the picked option names, not the one on screen", async () => {
    await act(async () => root.render(<VariantHarness />));
    const otherDesign = variantQuestionsFor("design-2");
    submitGuided({
      questions: otherDesign,
      answers: { variant: otherDesign[0].options[0].value },
    });
    expect(mocks.trackDesignRelay.mock.calls[0]?.[1]).toMatchObject({
      output_id: "design-2",
      picked_index: 0,
    });
  });

  it("swallows a tracking failure inside the listener", async () => {
    mocks.trackDesignRelay.mockImplementation(() => {
      throw new Error("analytics down");
    });
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => errors.push(event.error);
    window.addEventListener("error", onError);
    await act(async () => root.render(<VariantHarness />));
    submitGuided({
      questions: variantQuestions,
      answers: { variant: variantQuestions[0].options[0].value },
    });
    window.removeEventListener("error", onError);
    expect(mocks.trackDesignRelay).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
  });
});
