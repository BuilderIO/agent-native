import { callAction } from "@agent-native/core/client/hooks";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CreativeContextPrecedent } from "./creative-context-precedent";
import {
  allIntakeTopicsCovered,
  computeIntakeTopicCoverage,
  INTAKE_QUESTION_TOPICS,
  loadIntakeContext,
  loadIntakeContextFromAppState,
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
      precedentExplicitlyPicked: true,
      brandDna: null,
    });
    for (const topic of INTAKE_QUESTION_TOPICS) {
      expect(coverage[topic]).toBe(false);
    }
  });

  it("covers every topic when a design-relevant precedent was explicitly picked", () => {
    const coverage = computeIntakeTopicCoverage({
      precedent: designPrecedent(),
      precedentExplicitlyPicked: true,
      brandDna: null,
    });
    expect(allIntakeTopicsCovered(coverage)).toBe(true);
  });

  it("does not treat an auto-resolved (Default) design match as precedent", () => {
    const coverage = computeIntakeTopicCoverage({
      precedent: designPrecedent(),
      precedentExplicitlyPicked: false,
      brandDna: null,
    });
    for (const topic of INTAKE_QUESTION_TOPICS) {
      expect(coverage[topic]).toBe(false);
    }
  });

  it("covers only the aesthetic topic from published brand DNA", () => {
    const coverage = computeIntakeTopicCoverage({
      precedent: NONE,
      precedentExplicitlyPicked: false,
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
      pinnedPackId: null,
    });
    expect(allIntakeTopicsCovered(result.coverage)).toBe(false);
    expect(mockedCallAction).not.toHaveBeenCalled();
  });

  it("abstains (no lookups, no coverage) when a pack is pinned", async () => {
    const result = await loadIntakeContext({
      contextMode: "auto",
      selectedContextId: null,
      pinnedPackId: "pack-1",
    });
    expect(allIntakeTopicsCovered(result.coverage)).toBe(false);
    expect(mockedCallAction).not.toHaveBeenCalled();
  });

  it("falls back to the Default context for lookups but never treats its design matches as an explicit precedent", async () => {
    mockedCallAction.mockImplementation((action: string) => {
      if (action === "list-creative-contexts") {
        return Promise.resolve({
          contexts: [{ id: "ctx-default", kind: "default" }],
        });
      }
      if (action === "list-context-memberships") {
        return Promise.resolve({
          memberships: [
            {
              publishedItemId: "item-1",
              publishedItemVersionId: "version-1",
              status: "active",
              artifactKey: "design:design:dsn_1",
              publishedItem: {
                title: "Unrelated prior design",
                kind: "design-project",
                canonicalUrl: null,
              },
            },
          ],
        });
      }
      if (action === "get-brand-profile") {
        return Promise.resolve({ dna: null });
      }
      throw new Error(`unexpected action ${action}`);
    });

    const result = await loadIntakeContext({
      contextMode: "auto",
      selectedContextId: null,
      pinnedPackId: null,
    });

    expect(result.explicitContext).toBe(false);
    expect(allIntakeTopicsCovered(result.coverage)).toBe(false);
  });

  it("resolves Brand DNA from the context's own linked profile, not the account's most recent one", async () => {
    mockedCallAction.mockImplementation((action: string) => {
      if (action === "list-creative-contexts") {
        return Promise.resolve({
          contexts: [
            {
              id: "ctx-explicit",
              kind: "specialty",
              brandProfileId: "profile-b",
            },
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

    await loadIntakeContext({
      contextMode: "auto",
      selectedContextId: "ctx-explicit",
      pinnedPackId: null,
    });

    expect(mockedCallAction).toHaveBeenCalledWith(
      "get-brand-profile",
      { profileId: "profile-b" },
      expect.anything(),
    );
  });

  it("surfaces a failed precedent lookup as unavailable, not as no-context (silent-failure fix)", async () => {
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
      pinnedPackId: null,
    });

    expect(result.unavailable).toBe(true);
    expect(result.unavailableReason).toBe("context service down");
    expect(allIntakeTopicsCovered(result.coverage)).toBe(false);
  });

  it("surfaces a failed Brand DNA lookup as unavailable too, not as absent DNA", async () => {
    mockedCallAction.mockImplementation((action: string) => {
      if (action === "list-context-memberships") {
        return Promise.resolve({ memberships: [] });
      }
      if (action === "get-brand-profile") {
        return Promise.reject(new Error("brand profile service down"));
      }
      throw new Error(`unexpected action ${action}`);
    });

    const result = await loadIntakeContext({
      contextMode: "auto",
      selectedContextId: "ctx-1",
      pinnedPackId: null,
    });

    expect(result.unavailable).toBe(true);
    expect(result.unavailableReason).toBe("brand profile service down");
  });
});

describe("loadIntakeContextFromAppState", () => {
  it("degrades to an explicit unavailable result instead of throwing when the state read fails", async () => {
    const result = await loadIntakeContextFromAppState(() =>
      Promise.reject(new Error("app state unreachable")),
    );
    expect(result.unavailable).toBe(true);
    expect(result.unavailableReason).toBe("app state unreachable");
  });
});
