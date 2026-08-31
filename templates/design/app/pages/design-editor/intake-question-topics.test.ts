import { callAction } from "@agent-native/core/client/hooks";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CreativeContextPrecedent } from "./creative-context-precedent";
import {
  allIntakeTopicsCovered,
  computeIntakeTopicCoverage,
  INTAKE_QUESTION_TOPICS,
  loadIntakeContext,
} from "./intake-question-topics";

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: vi.fn(),
}));

const mockedCallAction = vi.mocked(callAction);

const NONE: CreativeContextPrecedent = { status: "none" };

function textOnlyPrecedent(): CreativeContextPrecedent {
  return {
    status: "strong",
    contextId: "ctx-1",
    matches: [
      {
        itemId: "item-1",
        itemVersionId: "version-1",
        title: "Q3 press release",
        kind: "document",
        artifactKey: null,
        designResourceId: null,
      },
    ],
  };
}

function designPrecedent(): CreativeContextPrecedent {
  return {
    status: "strong",
    contextId: "ctx-1",
    matches: [
      {
        itemId: "item-1",
        itemVersionId: "version-1",
        title: "Prior dashboard",
        kind: "design-project",
        artifactKey: "design:design:dsn_1",
        designResourceId: "dsn_1",
      },
    ],
  };
}

describe("computeIntakeTopicCoverage", () => {
  it("does not let an irrelevant text-only member cover any topic (over-skip fix)", () => {
    const coverage = computeIntakeTopicCoverage({
      precedent: textOnlyPrecedent(),
      brandDna: null,
    });
    for (const topic of INTAKE_QUESTION_TOPICS) {
      expect(coverage[topic]).toBe(false);
    }
  });

  it("covers every topic when a design-relevant precedent exists", () => {
    const coverage = computeIntakeTopicCoverage({
      precedent: designPrecedent(),
      brandDna: null,
    });
    expect(allIntakeTopicsCovered(coverage)).toBe(true);
  });

  it("covers only the aesthetic topic from published brand DNA", () => {
    const coverage = computeIntakeTopicCoverage({
      precedent: NONE,
      brandDna: { visual: { colors: ["#112233"] } },
    });
    expect(coverage.aesthetic).toBe(true);
    expect(coverage.formFactor).toBe(false);
    expect(coverage.features).toBe(false);
    expect(coverage.interactions).toBe(false);
    expect(coverage.variants).toBe(false);
  });
});

describe("loadIntakeContext", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("skips every lookup when context mode is off", async () => {
    const result = await loadIntakeContext({
      contextMode: "off",
      selectedContextId: null,
    });
    expect(allIntakeTopicsCovered(result.coverage)).toBe(false);
    expect(mockedCallAction).not.toHaveBeenCalled();
  });

  it("falls back to the Default context when nothing was explicitly picked", async () => {
    mockedCallAction.mockImplementation((action: string) => {
      if (action === "list-creative-contexts") {
        return Promise.resolve({
          contexts: [
            { id: "ctx-specialty", kind: "specialty" },
            { id: "ctx-default", kind: "default" },
          ],
        });
      }
      if (action === "list-context-memberships") {
        return Promise.resolve({ memberships: [] });
      }
      if (action === "get-brand-profile") {
        return Promise.resolve({ dna: null });
      }
      throw new Error(`unexpected action ${action}`);
    });

    const result = await loadIntakeContext({
      contextMode: "auto",
      selectedContextId: null,
    });

    expect(mockedCallAction).toHaveBeenCalledWith(
      "list-context-memberships",
      expect.objectContaining({ contextId: "ctx-default" }),
      expect.anything(),
    );
    expect(result.contextId).toBe("ctx-default");
  });

  it("surfaces a failed lookup as unavailable, not as no-context (silent-failure fix)", async () => {
    mockedCallAction.mockImplementation((action: string) => {
      if (action === "list-context-memberships") {
        return Promise.reject(new Error("context service down"));
      }
      if (action === "get-brand-profile") {
        return Promise.resolve({ dna: null });
      }
      throw new Error(`unexpected action ${action}`);
    });

    const result = await loadIntakeContext({
      contextMode: "auto",
      selectedContextId: "ctx-1",
    });

    expect(result.unavailable).toBe(true);
    expect(result.unavailableReason).toBe("context service down");
    expect(allIntakeTopicsCovered(result.coverage)).toBe(false);
  });
});
