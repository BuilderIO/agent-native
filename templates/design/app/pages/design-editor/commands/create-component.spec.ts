import { sourceContentHash } from "@shared/source-workspace";
import { describe, expect, it, vi } from "vitest";

import type { GeometryHistorySelection } from "../history";
import {
  createComponentActionChange,
  runCreateComponent,
  type CreateComponentActionResult,
  type CreateComponentArgs,
  type CreateComponentCommandOutcome,
  type CreateComponentMutationTransaction,
} from "./create-component";

const BEFORE =
  '<main data-agent-native-node-id="root"><button>Go</button></main>';
const AFTER =
  '<main data-agent-native-node-id="root" data-agent-native-component="PrimaryButton"><button>Go</button></main>';
const selectionBefore: GeometryHistorySelection = {
  overviewSelectedScreenIds: [],
  selectedLayerIds: ["root"],
  activeFileId: "file-1",
};

function actionChange(overrides: Partial<ReturnType<typeof baseChange>> = {}) {
  return { ...baseChange(), ...overrides };
}

function baseChange() {
  return {
    fileId: "file-1",
    before: BEFORE,
    after: AFTER,
    beforeVersionHash: sourceContentHash(BEFORE),
    afterVersionHash: sourceContentHash(AFTER),
    updatedAt: "2026-09-15T19:00:00.000Z",
  };
}

function persistedResult(
  change: ReturnType<typeof baseChange> = baseChange(),
): CreateComponentActionResult {
  return {
    persisted: true,
    fileId: change.fileId,
    changes: [change],
    sourceBases: [
      {
        fileId: change.fileId,
        versionHash: change.afterVersionHash,
        updatedAt: change.updatedAt,
      },
    ],
  };
}

function makeOutcome(
  result: CreateComponentActionResult,
): CreateComponentCommandOutcome {
  return {
    result,
    historyRecorded: result.persisted === true,
    change: result.changes?.[0]
      ? {
          fileId: result.changes[0].fileId,
          before: result.changes[0].before,
          after: result.changes[0].after,
        }
      : undefined,
    hostSync: result.persisted === true ? "accepted" : "skipped",
  };
}

function makeArgs(
  transaction: CreateComponentMutationTransaction,
  overrides: Partial<CreateComponentArgs> = {},
): CreateComponentArgs {
  return {
    canEditDesign: true,
    createComponent: vi.fn(async () => ({
      persisted: true,
      fileId: "file-1",
    })),
    designId: "design-1",
    fileId: "file-1",
    mutationTransaction: transaction,
    selectionBefore,
    ...overrides,
  };
}

describe("createComponentActionChange", () => {
  it("accepts one exact changed file receipt", () => {
    const result = persistedResult();
    expect(
      createComponentActionChange(result, {
        fileId: "file-1",
        content: BEFORE,
        versionHash: sourceContentHash(BEFORE),
      }),
    ).toEqual(actionChange());
  });

  it("rejects a persisted receipt with a stale preimage", () => {
    expect(() =>
      createComponentActionChange(persistedResult(), {
        fileId: "file-1",
        content: "<main>newer</main>",
        versionHash: sourceContentHash("<main>newer</main>"),
      }),
    ).toThrow("before/after content or source version is stale");
  });

  it("rejects a non-persisted result that claims a source change", () => {
    expect(() =>
      createComponentActionChange(
        { persisted: false, changes: [actionChange()] },
        {
          fileId: "file-1",
          content: BEFORE,
          versionHash: sourceContentHash(BEFORE),
        },
      ),
    ).toThrow("non-persisted result included source changes");
  });
});

describe("runCreateComponent", () => {
  it("delegates the action to the queue with its gate-owned source preimage", async () => {
    const source = {
      content: BEFORE,
      versionHash: sourceContentHash(BEFORE),
    };
    let transactionArgs:
      | Parameters<CreateComponentMutationTransaction["enqueue"]>[0]
      | undefined;
    const transaction: CreateComponentMutationTransaction = {
      enqueue: vi.fn(async (args) => {
        transactionArgs = args;
        const result = await args.run(source);
        return makeOutcome(result);
      }),
    };
    const createComponent = vi.fn(async (request) => {
      expect(request).toEqual({
        designId: "design-1",
        fileId: "file-1",
        nodeId: "root",
        name: "Primary Button",
        source: {
          currentContent: BEFORE,
          expectedVersionHash: source.versionHash,
        },
      });
      return {
        persisted: true,
        fileId: "file-1",
        changes: [actionChange()],
        sourceBases: [
          {
            fileId: "file-1",
            versionHash: sourceContentHash(AFTER),
            updatedAt: "2026-09-15T19:00:00.000Z",
          },
        ],
      };
    });
    const args = makeArgs(transaction, { createComponent });

    const outcome = await runCreateComponent(args, {
      nodeId: "root",
      name: "Primary Button",
    });

    expect(transaction.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: "file-1",
        selectionBefore,
        run: expect.any(Function),
      }),
    );
    expect(transactionArgs?.fileId).toBe("file-1");
    expect(outcome).toMatchObject({
      historyRecorded: true,
      hostSync: "accepted",
      result: { persisted: true },
    });
  });

  it("leaves declined results and reservation cleanup to the shared queue", async () => {
    const result: CreateComponentActionResult = {
      persisted: false,
      ctaRequired: true,
    };
    const transaction: CreateComponentMutationTransaction = {
      enqueue: vi.fn(async ({ run }) =>
        makeOutcome(
          await run({
            content: BEFORE,
            versionHash: sourceContentHash(BEFORE),
          }),
        ),
      ),
    };
    const createComponent = vi.fn(async () => result);

    const outcome = await runCreateComponent(
      makeArgs(transaction, { createComponent }),
      { selector: "button", name: "Primary Button" },
    );

    expect(outcome).toMatchObject({
      historyRecorded: false,
      hostSync: "skipped",
      result,
    });
  });

  it("does not enqueue when editing is disabled", async () => {
    const transaction: CreateComponentMutationTransaction = {
      enqueue: vi.fn(),
    };
    const outcome = await runCreateComponent(
      makeArgs(transaction, { canEditDesign: false }),
      { nodeId: "root", name: "Primary Button" },
    );

    expect(outcome).toBeUndefined();
    expect(transaction.enqueue).not.toHaveBeenCalled();
  });
});
