import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";

import {
  type TrustedAcceptanceConfig,
  type TrustedAcceptanceReceipt,
  createTrustedAcceptancePlan,
  validatePullRequestProvenance,
  validateTrustedAcceptanceConfig,
  validateTrustedAcceptanceReceipt,
} from "./trusted-acceptance.ts";

const sha = "a".repeat(40);

function config(): TrustedAcceptanceConfig {
  return {
    revision: "3",
    workspaces: [
      {
        id: "calendar-content-acceptance",
        enabled: false,
        assertions: ["A1", "A2", "A3"],
        members: [
          {
            template: "calendar",
            origin: "https://calendar-acceptance.example.test",
            siteIdVariable: "ACCEPTANCE_CALENDAR_NETLIFY_SITE_ID",
            environment: {
              databaseUrl: "ACCEPTANCE_CALENDAR_DATABASE_URL",
              betterAuthSecret: "ACCEPTANCE_CALENDAR_BETTER_AUTH_SECRET",
              a2aSecret: "ACCEPTANCE_A2A_SECRET",
            },
            build: {
              command: "pnpm --filter calendar build",
              publishDirectory: "templates/calendar/dist",
            },
            paths: {
              health: "/health",
              oauthMetadata: "/.well-known/oauth-authorization-server",
              mcp: "/mcp",
            },
          },
          {
            template: "content",
            origin: "https://content-acceptance.example.test",
            siteIdVariable: "ACCEPTANCE_CONTENT_NETLIFY_SITE_ID",
            environment: {
              databaseUrl: "ACCEPTANCE_CONTENT_DATABASE_URL",
              betterAuthSecret: "ACCEPTANCE_CONTENT_BETTER_AUTH_SECRET",
              a2aSecret: "ACCEPTANCE_A2A_SECRET",
            },
            build: {
              command: "pnpm --filter content build",
              publishDirectory: "templates/content/dist",
            },
            paths: {
              health: "/health",
              oauthMetadata: "/.well-known/oauth-authorization-server",
              mcp: "/mcp",
            },
          },
        ],
      },
    ],
  };
}

describe("trusted acceptance configuration", () => {
  it("accepts a generic third-template workspace without a controller branch", () => {
    assert.equal(existsSync("templates/tasks/package.json"), true);
    const fixture = config();
    fixture.workspaces.push({
      id: "third-template-acceptance",
      enabled: false,
      assertions: ["A1"],
      members: [
        {
          ...fixture.workspaces[0]!.members[0]!,
          template: "tasks",
          origin: "https://tasks-acceptance.example.test",
          siteIdVariable: "ACCEPTANCE_TASKS_NETLIFY_SITE_ID",
          build: {
            command: "pnpm --filter tasks build",
            publishDirectory: "templates/tasks/dist",
          },
        },
      ],
    });
    const availableTemplates = ["calendar", "content", "tasks"];
    assert.deepEqual(
      validateTrustedAcceptanceConfig(fixture, availableTemplates),
      {
        ok: true,
        issues: [],
      },
    );
    const plan = createTrustedAcceptancePlan(
      fixture,
      availableTemplates,
      "third-template-acceptance",
      true,
    );
    assert.equal(plan.ok, true);
    if (plan.ok) {
      assert.deepEqual(
        plan.plan.members.map(({ template }) => template),
        ["tasks"],
      );
    }
  });

  it("rejects production, preview, duplicate, unknown-template, and unsafe-key configuration", () => {
    const fixture = config();
    const member = fixture.workspaces[0]!.members[1]!;
    member.origin = "https://deploy-preview-123--content.netlify.app";
    member.siteIdVariable = fixture.workspaces[0]!.members[0]!.siteIdVariable;
    member.template = "unknown";
    member.environment.betterAuthSecret = "PRODUCTION_BETTER_AUTH_SECRET";
    const result = validateTrustedAcceptanceConfig(fixture, [
      "calendar",
      "content",
    ]);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.deepEqual(
        result.issues.map(({ path }) => path),
        [
          "workspaces[0].members[1].template",
          "workspaces[0].members[1].origin",
          "workspaces[0].members[1].siteIdVariable",
          "workspaces[0].members[1].environment.betterAuthSecret",
          "workspaces[0].members[1].build.command",
          "workspaces[0].members[1].build.publishDirectory",
        ],
      );
    }
  });

  it("rejects production origins and unsafe site variable names", () => {
    const fixture = config();
    const member = fixture.workspaces[0]!.members[1]!;
    member.origin = "https://content-production.example.test";
    member.siteIdVariable = "PRODUCTION_CONTENT_NETLIFY_SITE_ID";
    const result = validateTrustedAcceptanceConfig(fixture, [
      "calendar",
      "content",
    ]);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.deepEqual(
        result.issues.map(({ path }) => path),
        [
          "workspaces[0].members[1].origin",
          "workspaces[0].members[1].siteIdVariable",
        ],
      );
    }
  });

  it("permits disabled workspaces only for dry-run planning", () => {
    const fixture = config();
    const disabled = createTrustedAcceptancePlan(
      fixture,
      ["calendar", "content"],
      "calendar-content-acceptance",
      false,
    );
    assert.equal(disabled.ok, false);

    const dryRun = createTrustedAcceptancePlan(
      fixture,
      ["calendar", "content"],
      "calendar-content-acceptance",
      true,
    );
    assert.equal(dryRun.ok, true);
    if (dryRun.ok) {
      assert.equal(dryRun.plan.enabled, false);
      assert.deepEqual(
        dryRun.plan.members.map(({ template }) => template),
        ["calendar", "content"],
      );
    }
  });

  it("rejects unknown workspaces", () => {
    const result = createTrustedAcceptancePlan(
      config(),
      ["calendar", "content"],
      "unknown-workspace",
      true,
    );
    assert.deepEqual(result, {
      ok: false,
      issues: [{ path: "workspace", message: "is not configured" }],
    });
  });
});

describe("pull request provenance", () => {
  it("requires a full current same-repository open PR head", () => {
    assert.deepEqual(
      validatePullRequestProvenance({
        selectedSha: sha,
        expectedRepository: "BuilderIO/agent-native",
        pullRequest: {
          number: 42,
          state: "open",
          headSha: sha,
          headRepository: "BuilderIO/agent-native",
          isFork: false,
        },
      }),
      { ok: true, issues: [] },
    );
  });

  it("rejects abbreviated SHA, forks, closed PRs, and stale heads", () => {
    const result = validatePullRequestProvenance({
      selectedSha: "abc123",
      expectedRepository: "BuilderIO/agent-native",
      pullRequest: {
        number: 42,
        state: "closed",
        headSha: sha,
        headRepository: "someone/agent-native",
        isFork: true,
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.issues.length, 4);
  });
});

describe("trusted acceptance receipts", () => {
  it("accepts a complete redacted receipt", () => {
    const receipt: TrustedAcceptanceReceipt = {
      actor: "maintainer-123",
      runUrl: "https://github.com/BuilderIO/agent-native/actions/runs/123",
      operation: "candidate",
      pullRequest: 42,
      sha,
      controllerSha: "c".repeat(40),
      configRevision: "3",
      workspace: "calendar-content-acceptance",
      members: [
        {
          template: "calendar",
          origin: "https://calendar-acceptance.example.test",
          deployId: "deploy-calendar-123",
        },
      ],
      assertions: [
        { id: "A1", state: "pass", evidencePointer: "artifacts://receipt/A1" },
      ],
      startedAt: "2026-07-25T12:00:00.000Z",
      completedAt: "2026-07-25T12:01:00.000Z",
      result: "pass",
      rollbackTarget: "b".repeat(40),
      priorKnownGoodSha: "b".repeat(40),
      currentKnownGoodSha: sha,
    };
    assert.deepEqual(validateTrustedAcceptanceReceipt(receipt), {
      ok: true,
      issues: [],
    });
  });

  it("rejects sensitive fields and values in receipts", () => {
    const receipt = {
      actor: "maintainer-123",
      runUrl: "https://github.com/BuilderIO/agent-native/actions/runs/123",
      operation: "candidate",
      pullRequest: 42,
      sha,
      controllerSha: "c".repeat(40),
      configRevision: "3",
      workspace: "calendar-content-acceptance",
      members: [
        {
          template: "calendar",
          origin: "https://calendar-acceptance.example.test",
          deployId: "deploy-calendar-123",
        },
      ],
      assertions: [{ id: "A1", state: "pass" }],
      startedAt: "2026-07-25T12:00:00.000Z",
      completedAt: "2026-07-25T12:01:00.000Z",
      result: "fail",
      rollbackTarget: null,
      priorKnownGoodSha: null,
      currentKnownGoodSha: null,
      secretValue: "not allowed",
    } as unknown as TrustedAcceptanceReceipt;
    const result = validateTrustedAcceptanceReceipt(receipt);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.issues[0]!.message, /sensitive fields/);
  });

  it("rejects a passing result with blocked assertions", () => {
    const receipt: TrustedAcceptanceReceipt = {
      actor: "maintainer-123",
      runUrl: "https://github.com/BuilderIO/agent-native/actions/runs/123",
      operation: "candidate",
      pullRequest: 42,
      sha,
      controllerSha: "c".repeat(40),
      configRevision: "3",
      workspace: "calendar-content-acceptance",
      members: [
        {
          template: "calendar",
          origin: "https://calendar-acceptance.example.test",
          deployId: "deploy-calendar-123",
        },
      ],
      assertions: [{ id: "A1", state: "blocked" }],
      startedAt: "2026-07-25T12:00:00.000Z",
      completedAt: "2026-07-25T12:01:00.000Z",
      result: "pass",
      rollbackTarget: "b".repeat(40),
      priorKnownGoodSha: "b".repeat(40),
      currentKnownGoodSha: sha,
    };
    const result = validateTrustedAcceptanceReceipt(receipt, ["A1", "A2"]);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert(
        result.issues.some(({ message }) =>
          message.includes("every assertion"),
        ),
      );
      assert(
        result.issues.some(({ message }) =>
          message.includes("configured assertion"),
        ),
      );
    }
  });
});
