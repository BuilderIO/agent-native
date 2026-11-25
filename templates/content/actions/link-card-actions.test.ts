import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reader: undefined as string | undefined,
  readerOrg: undefined as string | undefined,
  invoke: vi.fn(),
  laneTargets: {} as Record<string, string>,
}));

vi.mock("../../../packages/core/src/a2a/caller-auth.js", () => ({
  resolveA2ACallerAuth: async () => ({
    userEmail: mocks.reader,
    metadata: {},
  }),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mocks.reader,
  getRequestOrgId: () => mocks.readerOrg,
}));
vi.mock("../../../packages/core/src/a2a/invoke.js", () => ({
  invokeAgentAction: mocks.invoke,
}));
vi.mock(
  "@agent-native/core/a2a",
  () => import("../../../packages/core/src/a2a/link-summary.js"),
);
vi.mock("../server/lib/app-peer.js", () => ({
  peerAppTarget: (app: string) => mocks.laneTargets[app] ?? app,
  peerLinkOrigins: (app: string) =>
    ({
      design: [
        "https://design.example.test",
        "https://design.beta.example.test",
      ],
      slides: ["https://workspace.example.test/slides"],
      clips: ["https://clips.example.test"],
    })[app] ?? [],
}));

import { answerLinkSummaries } from "../../../packages/core/src/a2a/link-summary.js";
import getLinkCardOrigins from "./get-link-card-origins";
import readLinkSummaries from "./read-link-summaries";

const DESIGN = "https://design.example.test/design/launch_1";
const DESIGN_BETA = "https://design.beta.example.test/design/launch_1";
const SLIDES = "https://workspace.example.test/slides/deck/q3";
const CLIPS = "https://clips.example.test/share/rec_1";
const OTHER = "https://example.test/design/launch_1";

const OWNERS: Record<string, Record<string, Record<string, string>>> = {
  design: { "alice@example.test": { launch_1: "Launch page" } },
  slides: { "alice@example.test": { q3: "Q3 review" } },
  clips: {
    "alice@example.test": { rec_1: "Onboarding walkthrough" },
    "bob@example.test": { rec_1: "Onboarding walkthrough" },
  },
};

function owningApp(down: string[] = []) {
  mocks.invoke.mockImplementation(
    async (options: {
      target: "design" | "slides" | "clips";
      input: { links: string[] };
      userEmail: string;
    }) => {
      if (down.includes(options.target))
        throw new Error("connect ECONNREFUSED");
      const titles = OWNERS[options.target]?.[options.userEmail] ?? {};
      const answer = await answerLinkSummaries({
        app: options.target,
        links: options.input.links,
        basePath: options.target === "slides" ? "/slides" : "",
        readTitle: async ({ id }) => titles[id] ?? null,
      });
      return {
        target: { kind: "discovered", name: options.target, url: "" },
        result: { status: "completed", output: JSON.stringify(answer) },
      };
    },
  );
}

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.laneTargets = {};
  mocks.reader = "alice@example.test";
  mocks.readerOrg = "org_1";
  vi.spyOn(console, "warn").mockImplementation(() => {});
  owningApp();
});

describe("read-link-summaries", () => {
  it("asks each owning app once, as the reader, and answers in order", async () => {
    const result = await readLinkSummaries.run({
      links: [DESIGN, OTHER, SLIDES, DESIGN_BETA, CLIPS],
    });
    expect(result.reader).toBe("alice@example.test");
    expect(result.readerOrg).toBe("org_1");
    expect(result.summaries).toEqual([
      {
        status: "available",
        app: "design",
        kind: "design",
        title: "Launch page",
        url: DESIGN,
      },
      { status: "unavailable" },
      {
        status: "available",
        app: "slides",
        kind: "deck",
        title: "Q3 review",
        url: SLIDES,
      },
      {
        status: "available",
        app: "design",
        kind: "design",
        title: "Launch page",
        url: DESIGN_BETA,
      },
      {
        status: "available",
        app: "clips",
        kind: "recording",
        title: "Onboarding walkthrough",
        url: CLIPS,
      },
    ]);
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
    expect(mocks.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "design",
        selfAppId: "content",
        action: "read-link-summary",
        input: { links: [DESIGN, DESIGN_BETA] },
        userEmail: "alice@example.test",
      }),
    );
  });

  it("asks an owning app on Content's own lane when the catalog names another", async () => {
    mocks.laneTargets = { design: "https://design.beta.example.test" };
    await readLinkSummaries.run({ links: [DESIGN, SLIDES] });
    expect(mocks.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "https://design.beta.example.test",
        input: { links: [DESIGN] },
      }),
    );
    expect(mocks.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ target: "slides", input: { links: [SLIDES] } }),
    );
  });

  it("sends no app a link that carries a credential", async () => {
    const result = await readLinkSummaries.run({
      links: [`${CLIPS}?agent_access=fake`, `${DESIGN}#token=fake`],
    });
    expect(result.summaries).toEqual([
      { status: "unavailable" },
      { status: "unavailable" },
    ]);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("gives a reader who can't open an item no trace of its title", async () => {
    mocks.reader = "bob@example.test";
    const result = await readLinkSummaries.run({
      links: [DESIGN, SLIDES, CLIPS],
    });
    expect(result.summaries.slice(0, 2)).toEqual([
      { status: "unavailable" },
      { status: "unavailable" },
    ]);
    const response = JSON.stringify(result);
    expect(response).not.toContain("Launch page");
    expect(response).not.toContain("Q3 review");
    expect(result.summaries[2]).toMatchObject({ status: "available" });
  });

  it("makes no call for a signed-out reader", async () => {
    mocks.reader = undefined;
    mocks.readerOrg = undefined;
    const result = await readLinkSummaries.run({ links: [DESIGN, CLIPS] });
    expect(result.reader).toBeNull();
    expect(result.readerOrg).toBeNull();
    expect(result.summaries).toEqual([
      { status: "unavailable" },
      { status: "unavailable" },
    ]);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("answers an app that is down as unavailable and the others as usual", async () => {
    owningApp(["design"]);
    const result = await readLinkSummaries.run({ links: [DESIGN, SLIDES] });
    expect(result.summaries[0]).toEqual({ status: "unavailable" });
    expect(result.summaries[1]).toMatchObject({
      status: "available",
      title: "Q3 review",
    });
  });

  it("answers an app slower than the card waits as unavailable", async () => {
    vi.useFakeTimers();
    try {
      mocks.invoke.mockReturnValue(new Promise(() => {}));
      const pending = readLinkSummaries.run({ links: [DESIGN] });
      await vi.advanceTimersByTimeAsync(5000);
      await expect(pending).resolves.toEqual({
        reader: "alice@example.test",
        readerOrg: "org_1",
        summaries: [{ status: "unavailable" }],
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("get-link-card-origins", () => {
  it("lists where each owning app lives", async () => {
    await expect(getLinkCardOrigins.run({})).resolves.toEqual({
      design: [
        "https://design.example.test",
        "https://design.beta.example.test",
      ],
      slides: ["https://workspace.example.test/slides"],
      clips: ["https://clips.example.test"],
    });
  });
});
