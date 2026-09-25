import { beforeEach, describe, expect, it, vi } from "vitest";

const mockIsOrgAdmin = vi.hoisted(() => vi.fn());
const mockGetTraceSummary = vi.hoisted(() => vi.fn());
const mockGetTraceSummaries = vi.hoisted(() => vi.fn());
const mockGetFeedback = vi.hoisted(() => vi.fn());
const mockGetInstructionUpdates = vi.hoisted(() => vi.fn());
const mockInsertInstructionUpdate = vi.hoisted(() => vi.fn());
const mockInsertFeedback = vi.hoisted(() => vi.fn());
const mockGetOutputReviewSummarySource = vi.hoisted(() => vi.fn());
const mockUpsertHumanReviewSummary = vi.hoisted(() => vi.fn());

vi.mock("../../server/org-admin.js", () => ({
  currentRequestUserIsOrgAdmin: (...args: unknown[]) => mockIsOrgAdmin(...args),
}));

vi.mock("../store.js", () => ({
  getTraceSummary: (...args: unknown[]) => mockGetTraceSummary(...args),
  getTraceSummaries: (...args: unknown[]) => mockGetTraceSummaries(...args),
  getFeedback: (...args: unknown[]) => mockGetFeedback(...args),
  getInstructionUpdates: (...args: unknown[]) =>
    mockGetInstructionUpdates(...args),
  insertInstructionUpdate: (...args: unknown[]) =>
    mockInsertInstructionUpdate(...args),
  insertFeedback: (...args: unknown[]) => mockInsertFeedback(...args),
  upsertHumanReviewSummary: (...args: unknown[]) =>
    mockUpsertHumanReviewSummary(...args),
}));

vi.mock("../reviews.js", () => ({
  getOutputReviewSummarySource: (...args: unknown[]) =>
    mockGetOutputReviewSummarySource(...args),
}));

import { runWithRequestContext } from "../../server/request-context.js";
import getObservabilityReviewApp from "./get-observability-review-app.js";
import getObservabilityReviewDetail from "./get-observability-review-detail.js";
import getObservabilityReviewSummarySource from "./get-observability-review-summary-source.js";
import listObservabilityReviews from "./list-observability-reviews.js";
import saveObservabilityInstructionUpdate from "./save-observability-instruction-update.js";
import saveObservabilityReviewFeedback from "./save-observability-review-feedback.js";
import saveObservabilityReviewSummary from "./save-observability-review-summary.js";

const adminContext = {
  userEmail: "admin@example.com",
  orgId: "org-a",
} as any;

describe("observability admin action authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsOrgAdmin.mockResolvedValue(false);
    mockGetOutputReviewSummarySource.mockReset();
    mockUpsertHumanReviewSummary.mockReset();
  });

  it.each([
    ["list", () => listObservabilityReviews.run({}, adminContext)],
    [
      "detail",
      () => getObservabilityReviewDetail.run({ runId: "r-a" }, adminContext),
    ],
    [
      "app",
      () => getObservabilityReviewApp.run({ runId: "r-a" }, adminContext),
    ],
    [
      "instruction update",
      () =>
        saveObservabilityInstructionUpdate.run(
          {
            runId: "r-a",
            target: "agent",
            instruction: "Change this",
          },
          adminContext,
        ),
    ],
    [
      "human-review vote",
      () =>
        saveObservabilityReviewFeedback.run(
          {
            runId: "r-a",
            feedbackType: "thumbs_up",
          },
          adminContext,
        ),
    ],
    [
      "summary source",
      () =>
        getObservabilityReviewSummarySource.run({ runId: "r-a" }, adminContext),
    ],
    [
      "summary save",
      () =>
        saveObservabilityReviewSummary.run(
          { runId: "r-a", ask: "Ask", outcome: "Done", artifacts: [] },
          adminContext,
        ),
    ],
  ])("returns 403 for a non-admin on %s", async (_name, invoke) => {
    await expect(invoke()).rejects.toMatchObject({ statusCode: 403 });
    expect(mockIsOrgAdmin).toHaveBeenCalledWith("org-a");
    expect(mockGetTraceSummary).not.toHaveBeenCalled();
    expect(mockGetTraceSummaries).not.toHaveBeenCalled();
    expect(mockInsertInstructionUpdate).not.toHaveBeenCalled();
    expect(mockInsertFeedback).not.toHaveBeenCalled();
  });

  it("rejects missing active org before membership lookup", async () => {
    await expect(
      listObservabilityReviews.run({}, { ...adminContext, orgId: null }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
    expect(mockGetTraceSummaries).not.toHaveBeenCalled();
  });

  it("rejects a review-list cache namespace from another org", async () => {
    mockIsOrgAdmin.mockResolvedValue(true);
    await expect(
      listObservabilityReviews.run({ cacheOrgId: "org-b" }, adminContext),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockGetTraceSummaries).not.toHaveBeenCalled();
  });

  it.each([
    [
      "source",
      () =>
        getObservabilityReviewSummarySource.run(
          { runId: "run-b" },
          adminContext,
        ),
    ],
    [
      "save",
      () =>
        saveObservabilityReviewSummary.run(
          { runId: "run-b", ask: "Ask", outcome: "Done", artifacts: [] },
          adminContext,
        ),
    ],
  ])(
    "binds the scoped summary %s action to its runId",
    async (_name, invoke) => {
      mockIsOrgAdmin.mockResolvedValue(true);
      await expect(
        runWithRequestContext(
          {
            userEmail: adminContext.userEmail,
            orgId: adminContext.orgId,
            run: {
              actionScope: {
                kind: "observability-review-summary",
                runId: "run-a",
              },
            },
          },
          invoke,
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(mockGetOutputReviewSummarySource).not.toHaveBeenCalled();
      expect(mockUpsertHumanReviewSummary).not.toHaveBeenCalled();
    },
  );

  it("rejects summary actions for runs outside an authorized batch", async () => {
    mockIsOrgAdmin.mockResolvedValue(true);
    await expect(
      runWithRequestContext(
        {
          userEmail: adminContext.userEmail,
          orgId: adminContext.orgId,
          run: {
            actionScope: {
              kind: "observability-review-summary-batch",
              runIds: ["run-a"],
            },
          },
        },
        () =>
          getObservabilityReviewSummarySource.run(
            { runId: "run-b" },
            adminContext,
          ),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockGetOutputReviewSummarySource).not.toHaveBeenCalled();
  });

  it("binds feedback-improvement drafts to their source run", async () => {
    mockIsOrgAdmin.mockResolvedValue(true);
    await expect(
      runWithRequestContext(
        {
          userEmail: adminContext.userEmail,
          orgId: adminContext.orgId,
          run: {
            actionScope: {
              kind: "observability-feedback-improvement",
              runId: "run-a",
            },
          },
        },
        () =>
          saveObservabilityInstructionUpdate.run(
            {
              runId: "run-b",
              target: "agent",
              instruction: "Use the grounded feedback.",
            },
            adminContext,
          ),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockGetTraceSummary).not.toHaveBeenCalled();
    expect(mockInsertInstructionUpdate).not.toHaveBeenCalled();
  });

  it("accepts only safe single-segment artifact IDs", async () => {
    mockIsOrgAdmin.mockResolvedValue(true);

    await expect(
      saveObservabilityReviewSummary.run(
        {
          runId: "run-a",
          ask: "Ask",
          outcome: "Done",
          artifacts: [
            {
              appId: "design",
              artifactId: "../other-org",
              title: "Design",
            },
          ],
        },
        adminContext,
      ),
    ).rejects.toThrow();
    expect(mockGetTraceSummary).not.toHaveBeenCalled();
  });

  it("rejects non-renderable design IDs and accepts renderable evidence", async () => {
    mockIsOrgAdmin.mockResolvedValue(true);
    mockGetTraceSummary.mockResolvedValue({ runId: "run-a", threadId: "t-a" });
    mockGetOutputReviewSummarySource.mockResolvedValue({
      found: true,
      attachedArtifacts: [],
      toolEvidence: [
        {
          status: "success",
          name: "design.create",
          output: { appId: "design", id: "design-1", renderable: false },
        },
      ],
    });

    await expect(
      saveObservabilityReviewSummary.run(
        {
          runId: "run-a",
          ask: "Ask",
          outcome: "Done",
          artifacts: [
            { appId: "design", artifactId: "design-1", title: "Design" },
          ],
        },
        adminContext,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockUpsertHumanReviewSummary).not.toHaveBeenCalled();

    mockGetOutputReviewSummarySource.mockResolvedValueOnce({
      found: true,
      attachedArtifacts: [],
      toolEvidence: [
        {
          status: "success",
          name: "design.create",
          output: { appId: "design", id: "design-1", renderable: true },
        },
      ],
    });
    mockUpsertHumanReviewSummary.mockResolvedValue(true);
    await expect(
      saveObservabilityReviewSummary.run(
        {
          runId: "run-a",
          ask: "Ask",
          outcome: "Done",
          artifacts: [
            { appId: "design", artifactId: "design-1", title: "Design" },
          ],
        },
        adminContext,
      ),
    ).resolves.toMatchObject({ saved: true, runId: "run-a" });
  });

  it("saves text notes only for an org-scoped run and requires note text", async () => {
    mockIsOrgAdmin.mockResolvedValue(true);
    mockGetTraceSummary.mockResolvedValueOnce(null);
    await expect(
      saveObservabilityReviewFeedback.run(
        { runId: "run-b", feedbackType: "text", value: "Helpful note" },
        adminContext,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mockGetTraceSummary).toHaveBeenCalledWith("run-b", {
      orgId: "org-a",
    });
    expect(mockInsertFeedback).not.toHaveBeenCalled();

    mockGetTraceSummary.mockResolvedValueOnce({
      runId: "run-a",
      threadId: "thread-a",
    });
    await saveObservabilityReviewFeedback.run(
      { runId: "run-a", feedbackType: "text", value: "Helpful note" },
      adminContext,
    );
    expect(mockInsertFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-a",
        threadId: "thread-a",
        feedbackType: "text",
        value: "Helpful note",
        userId: "admin@example.com",
        orgId: "org-a",
        source: "human_review",
      }),
    );
    mockGetTraceSummary.mockResolvedValueOnce({
      runId: "run-a",
      threadId: "thread-a",
    });
    await saveObservabilityReviewFeedback.run(
      { runId: "run-a", feedbackType: "thumbs_up" },
      adminContext,
    );
    await expect(
      saveObservabilityReviewFeedback.run(
        { runId: "run-a", feedbackType: "text", value: "  " },
        adminContext,
      ),
    ).rejects.toThrow(/A text note is required/);
    expect(mockInsertFeedback).toHaveBeenCalledTimes(2);
  });
});
