import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { parse } from "yaml";

import {
  PRODUCTION_SITE_GROUP,
  validateReusableWorkflowConcurrency,
  validateProductionSiteConcurrency,
} from "./guard-netlify-prebuilt-workflow.ts";

type Workflow = Record<string, unknown>;

const readWorkflow = (path: string): Workflow =>
  parse(readFileSync(path, "utf8")) as Workflow;

const workflows = () => ({
  production: readWorkflow(
    ".github/workflows/deploy-production-sites-prebuilt.yml",
  ),
  manage: readWorkflow(".github/workflows/manage-production-sites.yml"),
  promote: readWorkflow(".github/workflows/promote-netlify-deploy.yml"),
});

const reusableSource = readFileSync(
  ".github/workflows/deploy-netlify-prebuilt.yml",
  "utf8",
);
const nodeHeredocs = [
  ...reusableSource.matchAll(/node <<'NODE'\n([\s\S]*?)\n\s*NODE/g),
].map((match) => match[1]);

describe("production Netlify site concurrency guard", () => {
  it("requires a distinct reusable child queue selected by the caller input", () => {
    assert.deepEqual(
      validateReusableWorkflowConcurrency(
        readWorkflow(".github/workflows/deploy-netlify-prebuilt.yml"),
      ),
      [],
    );
  });

  it("rejects the dead workflow_call event check", () => {
    const mutated = readWorkflow(
      ".github/workflows/deploy-netlify-prebuilt.yml",
    );
    const concurrency = mutated.concurrency as Record<string, unknown>;
    concurrency.group = String(concurrency.group).replace(
      "inputs.caller",
      "github.event_name",
    );

    assert.notDeepEqual(validateReusableWorkflowConcurrency(mutated), []);
  });

  it("executes every reusable workflow heredoc under the pinned Node loader", () => {
    assert.equal(nodeHeredocs.length, 6);
    const directory = mkdtempSync(
      join(tmpdir(), "agent-native-netlify-heredocs-"),
    );
    try {
      for (const [index, body] of nodeHeredocs.entries()) {
        const scriptPath = join(directory, `heredoc-${index}.js`);
        writeFileSync(scriptPath, `process.exit(0);\n${body}\n`);
        assert.doesNotThrow(
          () =>
            execFileSync(process.execPath, [scriptPath], {
              cwd: directory,
              stdio: "pipe",
            }),
          `heredoc ${index + 1} must parse and execute under Node`,
        );
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("ignores stale ready deploys after a locked cutover", () => {
    const unlock = nodeHeredocs[1];
    const pendingStart = unlock.indexOf("function pendingProductionDeploys");
    const drainStart = unlock.indexOf(
      "async function drainPendingDeploys",
      pendingStart,
    );
    assert(pendingStart >= 0 && drainStart > pendingStart);
    const pendingProductionDeploys = new Function(
      `${unlock.slice(pendingStart, drainStart)}; return pendingProductionDeploys;`,
    )() as (
      deploys: Array<Record<string, unknown>>,
      publishedId: string,
      readyIsBlocking: boolean,
    ) => Array<Record<string, unknown>>;
    const deploys = [
      {
        id: "published",
        context: "production",
        published_at: "now",
        state: "ready",
      },
      { id: "stale-ready", context: "production", state: "ready" },
      { id: "queued", context: "production", state: "enqueued" },
      { id: "failed", context: "production", state: "error" },
    ];

    assert.deepEqual(
      pendingProductionDeploys(deploys, "published", false).map(
        (deploy) => deploy.id,
      ),
      ["queued"],
    );
    assert.deepEqual(
      pendingProductionDeploys(deploys, "published", true).map(
        (deploy) => deploy.id,
      ),
      ["stale-ready", "queued"],
    );
  });

  it("requires the exact shared queue on deploy, manage, and promote jobs", () => {
    assert.deepEqual(validateProductionSiteConcurrency(workflows()), []);
  });

  it("rejects a renamed promote queue even when it still mentions matrix.site", () => {
    const mutated = workflows();
    const promoteJobs = mutated.promote.jobs as Record<string, Workflow>;
    const promote = promoteJobs.promote;
    const concurrency = promote.concurrency as Record<string, unknown>;
    concurrency.group =
      "agent-native-production-promote-job-${{ matrix.site }}";

    const issues = validateProductionSiteConcurrency(mutated);
    assert(
      issues.some((issue) =>
        issue.includes(
          `promote-netlify-deploy.yml promote job concurrency.group must equal ${PRODUCTION_SITE_GROUP}`,
        ),
      ),
    );
  });

  it("rejects a manager job with no per-site concurrency block", () => {
    const mutated = workflows();
    const manageJobs = mutated.manage.jobs as Record<string, Workflow>;
    const manage = manageJobs.manage;
    delete manage.concurrency;

    const issues = validateProductionSiteConcurrency(mutated);
    assert(
      issues.some((issue) =>
        issue.includes(
          `manage-production-sites.yml manage job concurrency.group must equal ${PRODUCTION_SITE_GROUP}`,
        ),
      ),
    );
  });

  it("rejects a production site queue that allows cancellation", () => {
    const mutated = workflows();
    const promoteJobs = mutated.promote.jobs as Record<string, Workflow>;
    const promote = promoteJobs.promote;
    const concurrency = promote.concurrency as Record<string, unknown>;
    concurrency["cancel-in-progress"] = true;

    const issues = validateProductionSiteConcurrency(mutated);
    assert(
      issues.some((issue) =>
        issue.includes(
          "promote-netlify-deploy.yml promote job concurrency.cancel-in-progress must be false",
        ),
      ),
    );
  });
});
