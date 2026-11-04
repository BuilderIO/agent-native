import { beforeEach, describe, expect, it, vi } from "vitest";

const requireCallerMock = vi.hoisted(() => vi.fn());
const createClientMock = vi.hoisted(() => vi.fn());
const resolveRepositoryMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));
vi.mock("../server/lib/workflow-action-support.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/workflow-action-support.js")
  >()),
  requireWorkflowActionCaller: requireCallerMock,
}));
vi.mock("../server/db/index.js", () => ({ getDb: () => ({}) }));
vi.mock("../server/lib/factory-repository-scope.js", () => ({
  resolveFactoryRepository: resolveRepositoryMock,
}));
vi.mock("../server/triage/github-client.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/triage/github-client.js")
  >()),
  createGitHubClient: createClientMock,
}));

import addLabels from "./add-github-labels.js";
import removeLabel from "./remove-github-label.js";

const caller = {
  userEmail: "owner@example.test",
  orgId: "org-1",
  factoryId: "f1",
};
const context = { caller: "automation" as const, userEmail: caller.userEmail };

type Audit = {
  recordInputs?: boolean;
  target: (args: unknown, result?: unknown) => Record<string, unknown>;
  summary: (args: unknown, result: unknown, meta: { status: string }) => string;
};
type Schema = { safeParse: (value: unknown) => { success: boolean } };

function fakeClient() {
  return {
    addIssueLabels: vi.fn(
      async (_repo: unknown, _number: number, labels: readonly string[]) => [
        ...labels,
      ],
    ),
    removeIssueLabel: vi.fn(async () => ({ removed: true, labels: [] })),
  };
}

let client: ReturnType<typeof fakeClient>;

beforeEach(() => {
  vi.clearAllMocks();
  requireCallerMock.mockResolvedValue(caller);
  resolveRepositoryMock.mockResolvedValue("acme/web");
  client = fakeClient();
  createClientMock.mockReturnValue(client);
});

const writes = [
  ["add-github-labels", addLabels],
  ["remove-github-label", removeLabel],
] as const;

describe.each(writes)("%s", (_name, action) => {
  it("declares a write that reaches outside, is not an HTTP route and is not offered to MCP clients", () => {
    expect(action.readOnly).toBeUndefined();
    expect(action.mcpAnnotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    });
    expect(action.http).toBe(false);
    expect(action.mcpTool).toBe(false);
  });

  it("declares its output, so a result that drifts fails instead of reaching a graph", () => {
    expect(action.outputSchema).toBeDefined();
  });

  it("keeps the audit row to a path: no inputs are recorded, so no label text is", () => {
    const audit = action.audit as Audit;

    expect(audit.recordInputs).toBe(false);
    expect(
      audit.summary({ repo: "acme/web", number: 12 }, undefined, {
        status: "success",
      }),
    ).toMatch(/^(POST|DELETE) github \/repos\/acme\/web\/issues\/12\/labels/);
    expect(audit.target({ repo: "acme/web", number: 12 })).toEqual({
      type: "github-issue",
      id: "acme/web#12",
      visibility: "org",
    });
  });

  it("does nothing for a caller the gate refuses", async () => {
    requireCallerMock.mockRejectedValue(new Error("not allowed"));

    await expect(
      action.run(
        {
          repo: "acme/web",
          number: 12,
          labels: ["bug"],
          label: "bug",
        } as never,
        context,
      ),
    ).rejects.toThrow("not allowed");
    expect(createClientMock).not.toHaveBeenCalled();
    expect(resolveRepositoryMock).not.toHaveBeenCalled();
  });

  it("builds its GitHub client from the caller's own email and organization, which is how the credential is resolved", async () => {
    await action.run(
      {
        repo: "acme/web",
        number: 12,
        labels: ["bug"],
        label: "bug",
      } as never,
      context,
    );

    expect(createClientMock).toHaveBeenCalledWith({
      ownerEmail: "owner@example.test",
      orgId: "org-1",
    });
  });

  it("refuses a number that is not a positive whole one in its schema", () => {
    const schema = action.schema as Schema;
    const base = { repo: "acme/web", labels: ["bug"], label: "bug" };

    expect(schema.safeParse({ ...base, number: 12 }).success).toBe(true);
    for (const number of [0, -1, 1.5, "12"]) {
      expect(schema.safeParse({ ...base, number }).success).toBe(false);
    }
  });
});

describe.each([
  [
    "add-github-labels",
    addLabels,
    { repo: "acme/web", number: 12, labels: ["triage"] },
  ],
  [
    "remove-github-label",
    removeLabel,
    { repo: "acme/web", number: 12, label: "triage" },
  ],
])("%s and the factory's repository", (_name, action, input) => {
  it("resolves the factory's repository the way every GitHub gate does", async () => {
    await action.run(input as never, context);

    expect(resolveRepositoryMock).toHaveBeenCalledWith(
      {},
      context,
      caller,
      "f1",
    );
  });

  it.each([
    ["another repository", "acme/other"],
    ["no repository set", null],
  ])(
    "refuses a write when the factory has %s, and GitHub is never asked",
    async (_label, configured) => {
      resolveRepositoryMock.mockResolvedValue(configured);

      await expect(action.run(input as never, context)).rejects.toMatchObject({
        errorCode: "repository_not_allowed",
        sideEffect: "none",
      });
      expect(client.addIssueLabels).not.toHaveBeenCalled();
      expect(client.removeIssueLabel).not.toHaveBeenCalled();
    },
  );

  it("does not take the setting's word over a URL for the repository", async () => {
    resolveRepositoryMock.mockResolvedValue("acme/web");

    await expect(
      action.run(
        { ...input, repo: "https://github.com/acme/web" } as never,
        context,
      ),
    ).rejects.toMatchObject({ errorCode: "github_repository_invalid" });
    expect(client.addIssueLabels).not.toHaveBeenCalled();
    expect(client.removeIssueLabel).not.toHaveBeenCalled();
  });

  it("fails loudly, and writes nothing, when the setting cannot be read", async () => {
    resolveRepositoryMock.mockRejectedValue(new Error("database unavailable"));

    await expect(action.run(input as never, context)).rejects.toThrow(
      "database unavailable",
    );
    expect(client.addIssueLabels).not.toHaveBeenCalled();
    expect(client.removeIssueLabel).not.toHaveBeenCalled();
  });
});

describe("add-github-labels", () => {
  it("adds the labels and returns what the item carries, with a derived reference", async () => {
    const result = await addLabels.run(
      { repo: "acme/web", number: 12, labels: ["triage"] },
      context,
    );

    expect(result).toEqual({
      ok: true,
      labels: ["triage"],
      externalRef: "acme/web#12+triage",
    });
    expect((addLabels.outputSchema as Schema).safeParse(result).success).toBe(
      true,
    );
  });

  it("refuses a bad label with a typed code and never calls GitHub", async () => {
    await expect(
      addLabels.run({ repo: "acme/web", number: 12, labels: ["a,b"] }, context),
    ).rejects.toMatchObject({ errorCode: "github_label_invalid" });
    expect(client.addIssueLabels).not.toHaveBeenCalled();
  });
});

describe("remove-github-label", () => {
  it("removes the label and returns the derived reference", async () => {
    const result = await removeLabel.run(
      { repo: "acme/web", number: 12, label: "triage" },
      context,
    );

    expect(result).toEqual({
      ok: true,
      alreadyAbsent: false,
      externalRef: "acme/web#12-triage",
    });
    expect((removeLabel.outputSchema as Schema).safeParse(result).success).toBe(
      true,
    );
  });

  it("names the label in the audit row, since it is part of the path it called", () => {
    const audit = removeLabel.audit as Audit;

    expect(
      audit.summary(
        { repo: "acme/web", number: 12, label: "triage" },
        undefined,
        {
          status: "success",
        },
      ),
    ).toBe("DELETE github /repos/acme/web/issues/12/labels/triage");
  });
});
