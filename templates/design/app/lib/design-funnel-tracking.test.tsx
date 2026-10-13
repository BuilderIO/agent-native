// @vitest-environment happy-dom

import { BOARD_FILENAME } from "@shared/board-file";
import { promptLengthBucket } from "@shared/prompt-length-bucket";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  designPromptReferenceTypes,
  GUIDED_QUESTIONS_SUBMITTED_EVENT,
  resetDesignReadyViewsForTest,
  useDesignReadyViewTracking,
  useDesignVariantPickTracking,
  variantPickFromGuidedSubmit,
} from "./design-funnel-tracking";

const mocks = vi.hoisted(() => ({ trackDesignRelay: vi.fn() }));

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
    generationActive: false,
    files: [],
    stopCountRef: { current: 0 },
    ...props,
  };
  await act(async () => root.render(<ReadyHarness {...full} />));
  return full;
}

function setUrl(search: string) {
  window.history.replaceState(null, "", `/design/design-1${search}`);
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.trackDesignRelay.mockReset();
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
  it("fires once when an owner's generation ends having written a screen", async () => {
    const stopCountRef = { current: 0 };
    await renderReady({ generationActive: true, files: [], stopCountRef });
    expect(readyEvents()).toHaveLength(0);
    // Files land while the run is still active: not ready yet.
    await renderReady({
      generationActive: true,
      files: [screen("a")],
      stopCountRef,
    });
    expect(readyEvents()).toHaveLength(0);
    await renderReady({
      generationActive: false,
      files: [screen("a"), screen("b")],
      stopCountRef,
    });
    await renderReady({
      generationActive: false,
      files: [screen("a"), screen("b")],
      stopCountRef,
    });
    expect(readyEvents()).toEqual([
      [
        "design_ready_viewed",
        {
          output_id: "design-1",
          output_type: "design",
          screen_count: 2,
          is_owner: true,
        },
      ],
    ]);
  });

  it("does not fire for a non-owner", async () => {
    await renderReady({ generationActive: true, isOwner: false });
    await renderReady({
      generationActive: false,
      isOwner: false,
      files: [screen("a")],
    });
    expect(readyEvents()).toHaveLength(0);
  });

  it("does not fire when the run wrote nothing, or only a board file", async () => {
    const existing = [screen("a")];
    await renderReady({ generationActive: true, files: existing });
    await renderReady({ generationActive: false, files: existing });
    expect(readyEvents()).toHaveLength(0);

    await renderReady({ generationActive: true, files: [] });
    await renderReady({
      generationActive: false,
      files: [
        {
          id: "board",
          filename: BOARD_FILENAME,
          fileType: "html",
          content: "<main/>",
          updatedAt: "t1",
        },
      ],
    });
    expect(readyEvents()).toHaveLength(0);
  });

  it("does not fire before the design has loaded or without a generation", async () => {
    await renderReady({ designLoaded: false, files: [screen("a")] });
    await renderReady({ files: [screen("a")] });
    expect(readyEvents()).toHaveLength(0);
  });

  it("takes the baseline from loaded files, not the empty pre-load list", async () => {
    await renderReady({ designLoaded: false, generationActive: true });
    await renderReady({ generationActive: true, files: [screen("a")] });
    await renderReady({ files: [screen("a")] });
    expect(readyEvents()).toHaveLength(0);
  });

  it("does not report a link's attempt when the design has no screen", async () => {
    setUrl("?generation_attempt_id=attempt_1234567890abcdef");
    await renderReady({ files: [] });
    expect(readyEvents()).toHaveLength(0);
  });

  it("counts an edited screen but not a stopped generation", async () => {
    const stopCountRef = { current: 0 };
    await renderReady({
      generationActive: true,
      files: [screen("a", "t1")],
      stopCountRef,
    });
    stopCountRef.current += 1;
    await renderReady({
      generationActive: false,
      files: [screen("a", "t2")],
      stopCountRef,
    });
    expect(readyEvents()).toHaveLength(0);

    await renderReady({
      generationActive: true,
      files: [screen("a", "t2")],
      stopCountRef,
    });
    await renderReady({
      generationActive: false,
      files: [screen("a", "t3")],
      stopCountRef,
    });
    expect(readyEvents()).toHaveLength(1);
  });

  it("waits for the tab to be visible and drops it if the page leaves", async () => {
    visibility = "hidden";
    await renderReady({ generationActive: true });
    await renderReady({ files: [screen("a")] });
    expect(readyEvents()).toHaveLength(0);
    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(readyEvents()).toHaveLength(1);

    visibility = "hidden";
    await renderReady({ generationActive: true, files: [screen("a")] });
    await renderReady({ files: [screen("a", "t9")] });
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
    await renderReady({ files: [screen("a")] });
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

    // A later in-page generation is not attributed to the link's attempt.
    await renderReady({ generationActive: true, files: [screen("a")] });
    await renderReady({ files: [screen("a"), screen("b")] });
    expect(readyEvents()).toHaveLength(2);
    expect(readyEvents()[1][1]).not.toHaveProperty("generation_attempt_id");
  });

  it("ignores an invalid attempt id and a non-owner link open", async () => {
    setUrl("?generation_attempt_id=short");
    await renderReady({ files: [screen("a")] });
    await act(async () => root.unmount());
    root = createRoot(container);
    setUrl("?generation_attempt_id=attempt_1234567890abcdef");
    await renderReady({ files: [screen("a")], isOwner: false });
    expect(readyEvents()).toHaveLength(0);
  });

  it("never reports one design's link attempt against the next design opened in the page", async () => {
    setUrl("?generation_attempt_id=attempt_1234567890abcdef");
    await renderReady({ files: [screen("a")], isOwner: false });
    window.history.replaceState(null, "", "/design/design-2");
    await renderReady({ designId: "design-2", files: [screen("b")] });
    expect(readyEvents()).toHaveLength(0);
  });

  it("keeps rendering when tracking throws", async () => {
    mocks.trackDesignRelay.mockImplementation(() => {
      throw new Error("analytics down");
    });
    await renderReady({ generationActive: true });
    await expect(renderReady({ files: [screen("a")] })).resolves.toBeTruthy();
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
