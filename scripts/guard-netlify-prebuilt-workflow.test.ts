import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { parse } from "yaml";

import {
  PRODUCTION_PURGE_CONDITION,
  PRODUCTION_SITE_GROUP,
  validateProductionPurgeCondition,
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
  it("uses exponential backoff when Netlify omits Retry-After", () => {
    const workflow = readFileSync(
      ".github/workflows/manage-production-sites.yml",
      "utf8",
    );
    assert.match(
      workflow,
      /retryAfterHeader === null \? Number\.NaN : Number\(retryAfterHeader\)/,
    );
    assert.match(workflow, /Math\.min\(120_000, 30_000 \* 2 \*\* attempt\)/);
  });

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
    assert.equal(nodeHeredocs.length, 7);
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

  it("purges the production cache after smoke and before relocking the deploy", () => {
    const workflow = readWorkflow(
      ".github/workflows/deploy-netlify-prebuilt.yml",
    );
    const jobs = workflow.jobs as Record<string, Workflow>;
    const steps = (jobs.deploy.steps as Array<Workflow>).filter(Boolean);
    const smokeIndex = steps.findIndex(
      (step) => step.name === "Smoke-test the uploaded deploy",
    );
    const purgeIndex = steps.findIndex(
      (step) => step.name === "Purge the production Netlify cache",
    );
    const lockIndex = steps.findIndex(
      (step) => step.name === "Lock the published production deploy",
    );
    assert(
      smokeIndex >= 0 && smokeIndex < purgeIndex && purgeIndex < lockIndex,
    );

    const purge = steps[purgeIndex];
    assert.match(String(purge.if), /inputs.target == 'production'/);
    assert.match(String(purge.if), /inputs.deploy_mode == 'production'/);
    assert.match(String(purge.if), /success\(\)/);
    assert.match(
      String(purge.run),
      /const api = "https:\/\/api\.netlify\.com\/api\/v1"/,
    );
    assert.match(String(purge.run), /fetch\(`\$\{api\}\/purge`/);
    assert.match(String(purge.run), /method: "POST"/);
    assert.match(
      String(purge.run),
      /JSON\.stringify\(\{ site_id: process\.env\.NETLIFY_SITE_ID \}\)/,
    );
    assert.match(String(purge.run), /if \(!response\.ok\)/);
  });

  it("keeps Clips prebuilt assembly independent of masked runtime secrets", () => {
    const workflow = readFileSync(
      ".github/workflows/deploy-netlify-prebuilt.yml",
      "utf8",
    );
    const clipsNetlify = readFileSync("templates/clips/netlify.toml", "utf8");
    const buildStart = workflow.indexOf(
      "name: Build with the Netlify project configuration",
    );
    const buildEnd = workflow.indexOf(
      "name: Verify deploy directories",
      buildStart,
    );
    const build = workflow.slice(buildStart, buildEnd);
    assert.match(build, /\[\[ \"\$SOURCE_TEMPLATE\" == \"clips\" \]\]/);
    assert.match(build, /agentNativePrebuiltBuild=true/);
    assert.match(build, /agentNativePrebuiltDatabaseUrl=/);
    assert.match(build, /agentNativePrebuiltAuthSecret=/);
    assert.match(clipsNetlify, /agentNativePrebuiltDatabaseUrl/);
    assert.match(clipsNetlify, /agentNativePrebuiltAuthSecret/);
    assert.match(
      clipsNetlify,
      /agentNativePrebuiltBuild:-\}.*migrate:production/,
    );
  });

  it("rejects a purge step that is no longer production-only and success-gated", () => {
    const workflow = readWorkflow(
      ".github/workflows/deploy-netlify-prebuilt.yml",
    );
    const jobs = workflow.jobs as Record<string, Workflow>;
    const steps = (jobs.deploy.steps as Array<Workflow>).filter(Boolean);
    const purge = steps.find(
      (step) => step.name === "Purge the production Netlify cache",
    );

    assert(purge);
    assert.equal(String(purge.if), PRODUCTION_PURGE_CONDITION);
    for (const mutatedIf of [
      "inputs.target == 'production' && inputs.deploy_mode == 'production' && success()",
      "inputs.target == 'production' && !inputs.deploy && inputs.deploy_mode == 'production' && success()",
      "inputs.target == 'production' && inputs.deploy && inputs.deploy_mode == 'production' && !success()",
      "inputs.target == 'production' && inputs.deploy && inputs.deploy_mode == 'production' || success()",
    ]) {
      assert.notDeepEqual(validateProductionPurgeCondition(mutatedIf), []);
    }
  });

  it("allows Netlify-observed ready deploys but blocks newly observed ready deploys", () => {
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
      preexistingDeployIds: Set<unknown>,
    ) => Array<Record<string, unknown>>;
    const deploys = [
      {
        id: "published",
        context: "production",
        published_at: "now",
        state: "ready",
      },
      {
        id: "stale-ready",
        context: "production",
        state: "ready",
        created_at: "2026-08-20T01:59:59Z",
      },
      {
        id: "preexisting-unreadable-ready",
        context: "production",
        state: "ready",
        created_at: "not-a-date",
      },
      {
        id: "new-ready",
        context: "production",
        state: "ready",
        created_at: "2026-08-20T02:00:01Z",
      },
      {
        id: "new-unreadable-ready",
        context: "production",
        state: "ready",
        created_at: "not-a-date",
      },
      { id: "queued", context: "production", state: "enqueued" },
      { id: "failed", context: "production", state: "error" },
      { id: "rejected", context: "production", state: "rejected" },
    ];

    assert.deepEqual(
      pendingProductionDeploys(
        deploys,
        "published",
        new Set(["published", "stale-ready", "preexisting-unreadable-ready"]),
      ).map((deploy) => deploy.id),
      ["new-ready", "new-unreadable-ready", "queued"],
    );
  });

  it("captures the Netlify deploy baseline before draining production deploys", () => {
    const unlock = nodeHeredocs[1];
    assert.doesNotMatch(unlock, /readyIsBlocking/);
    const baselineIndex = unlock.indexOf(
      "const preexistingDeployIds = new Set",
    );
    const siteLookupIndex = unlock.indexOf("const site = await readJson(");
    assert(baselineIndex >= 0 && siteLookupIndex > baselineIndex);
    assert.match(
      unlock,
      /const preexistingDeployIds = new Set\([\s\S]*?Netlify pre-existing production ready deploy lookup[\s\S]*?\["ready"\][\s\S]*?\);\s*const site = await readJson\(/,
    );
  });

  it("rechecks the production queue immediately before unlocking", () => {
    const unlock = nodeHeredocs[1];
    const finalDrain = unlock.lastIndexOf(
      "await drainPendingDeploys(deployId, preexistingDeployIds);",
    );
    const unlockRequest = unlock.lastIndexOf(
      "await request(`${api}/deploys/${deployId}/unlock`",
    );
    assert(finalDrain >= 0 && unlockRequest > finalDrain);
    assert.match(
      unlock.slice(finalDrain, unlockRequest),
      /finalBeforeUnlock[\s\S]*published_deploy\?\.id !== deployId/,
    );
  });

  it("uses production state filters without an age cutoff", async () => {
    const unlock = nodeHeredocs[1];
    const listStart = unlock.indexOf("async function listDeploys");
    const pendingStart = unlock.indexOf(
      "function pendingProductionDeploys",
      listStart,
    );
    assert(listStart >= 0 && pendingStart > listStart);
    const listDeploys = new Function(
      "request",
      "readJson",
      "nextPageUrl",
      "api",
      "siteId",
      `${unlock.slice(listStart, pendingStart)}; return listDeploys;`,
    )(
      async (url: string) => {
        requests.push(url);
        const page = pages.get(url);
        assert(page, `unexpected deploy page ${url}`);
        return {
          headers: {
            get: () => page.next,
          },
          page: page.deploys,
        };
      },
      async (response: { page: Array<Record<string, unknown>> }) =>
        response.page,
      (link: string | null) => link,
      "https://netlify.test/api",
      "site-id",
    ) as (
      label: string,
      states: string[],
    ) => Promise<Array<Record<string, unknown>>>;
    const requests: string[] = [];
    const pages = new Map([
      [
        "https://netlify.test/api/sites/site-id/deploys?per_page=100&production=true&state=processing",
        {
          deploys: [{ id: "old-active", state: "processing" }],
          next: null,
        },
      ],
    ]);

    const deploys = await listDeploys("test deploy lookup", ["processing"]);
    assert.deepEqual(
      deploys.map((deploy) => deploy.id),
      ["old-active"],
    );
    assert.deepEqual(requests, [
      "https://netlify.test/api/sites/site-id/deploys?per_page=100&production=true&state=processing",
    ]);
  });

  it("does not treat rejected production deploys as active cutover blockers", () => {
    const unlock = nodeHeredocs[1];
    const statesStart = unlock.indexOf(
      "const ACTIVE_PRODUCTION_DEPLOY_STATES = [",
    );
    const statesEnd = unlock.indexOf("];", statesStart);
    assert(statesStart >= 0 && statesEnd > statesStart);
    assert.doesNotMatch(unlock.slice(statesStart, statesEnd), /"rejected"/);
    assert.match(unlock.slice(statesStart, statesEnd), /"pending"/);
    assert.match(
      unlock,
      /\["error", "canceled", "rejected"\]\.includes\(candidate\.state\)/,
    );
  });

  it("finds old active production deploys through filtered state requests", async () => {
    const unlock = nodeHeredocs[1];
    const statesStart = unlock.indexOf(
      "const ACTIVE_PRODUCTION_DEPLOY_STATES = [",
    );
    const statesEnd = unlock.indexOf("];", statesStart);
    assert(statesStart >= 0 && statesEnd > statesStart);
    assert.deepEqual(
      [
        ...unlock.slice(statesStart, statesEnd).matchAll(/\n\s+"([^"]+)",/g),
      ].map((match) => match[1]),
      [
        "new",
        "pending",
        "enqueued",
        "building",
        "uploading",
        "uploaded",
        "preparing",
        "prepared",
        "processing",
        "processed",
        "retrying",
        "pending_review",
        "accepted",
      ],
    );
    const listStart = unlock.indexOf("async function listDeploys");
    const pendingStart = unlock.indexOf(
      "function pendingProductionDeploys",
      listStart,
    );
    assert(listStart >= 0 && pendingStart > listStart);
    const listDeploys = new Function(
      "request",
      "readJson",
      "nextPageUrl",
      "api",
      "siteId",
      `${unlock.slice(listStart, pendingStart)}; return listDeploys;`,
    )(
      async (url: string) => {
        requests.push(url);
        const page = pages.get(url);
        assert(page, `unexpected deploy page ${url}`);
        return {
          headers: {
            get: () => page.next,
          },
          page: page.deploys,
        };
      },
      async (response: { page: Array<Record<string, unknown>> }) =>
        response.page,
      (link: string | null) => link,
      "https://netlify.test/api",
      "site-id",
    ) as (
      label: string,
      states: string[],
    ) => Promise<Array<Record<string, unknown>>>;
    const requests: string[] = [];
    const pages = new Map([
      [
        "https://netlify.test/api/sites/site-id/deploys?per_page=100&production=true&state=pending",
        {
          deploys: [
            { id: "old-pending", context: "production", state: "pending" },
          ],
          next: null,
        },
      ],
      [
        "https://netlify.test/api/sites/site-id/deploys?per_page=100&production=true&state=processing",
        {
          deploys: [
            {
              id: "old-active",
              context: "production",
              state: "processing",
              created_at: "2026-08-19T00:00:00Z",
            },
          ],
          next: null,
        },
      ],
    ]);

    const deploys = await listDeploys("test deploy lookup", [
      "processing",
      "pending",
    ]);
    assert.deepEqual(deploys.map((deploy) => deploy.id).sort(), [
      "old-active",
      "old-pending",
    ]);
    assert.deepEqual(requests.sort(), [
      "https://netlify.test/api/sites/site-id/deploys?per_page=100&production=true&state=pending",
      "https://netlify.test/api/sites/site-id/deploys?per_page=100&production=true&state=processing",
    ]);
    assert(
      requests.every((url) =>
        /production=true&state=(pending|processing)$/.test(url),
      ),
    );
  });

  it("restores cutover state before failure lock cleanup", () => {
    const workflow = readWorkflow(
      ".github/workflows/deploy-netlify-prebuilt.yml",
    );
    const jobs = workflow.jobs as Record<string, Workflow>;
    const steps = (jobs.deploy.steps as Array<Workflow>).filter(Boolean);
    const resume = steps.find(
      (step) =>
        step.name ===
        "Resume automatic Netlify builds after production cutover",
    );
    const cleanup = steps.find(
      (step) =>
        step.name ===
        "Restore the production deploy lock after a failed cutover",
    );
    assert.equal(typeof resume?.if, "string");
    assert.match(resume?.if as string, /always\(\)/);
    assert.match(
      String(resume?.run),
      /process\.env\.cutoverWasPaused !== "true"/,
    );
    assert.match(
      String(resume?.run),
      /process\.env\.cutoverWasStopped === "true"/,
    );
    assert.equal(
      (resume?.env as Record<string, unknown>).cutoverWasStopped,
      "${{ steps.pause.outputs.was_stopped }}",
    );
    assert.equal(
      (resume?.env as Record<string, unknown>).cutoverWasPaused,
      "${{ steps.pause.outputs.cutover_acquired }}",
    );
    assert.equal(typeof cleanup?.if, "string");
    assert.match(cleanup?.if as string, /failure\(\)/);
    assert.equal(
      (cleanup?.env as Record<string, unknown>).cutoverPublishedDeployId,
      "${{ steps.unlock.outputs.published_deploy_id }}",
    );
    assert.equal(
      (cleanup?.env as Record<string, unknown>).cutoverNewDeployId,
      "${{ steps.deploy.outputs.deploy_id }}",
    );
    assert.equal(
      (cleanup?.env as Record<string, unknown>).cutoverWasLocked,
      "${{ steps.unlock.outputs.was_locked }}",
    );
    assert.equal(
      (cleanup?.env as Record<string, unknown>).cutoverWasPaused,
      "${{ steps.pause.outputs.cutover_acquired }}",
    );
    assert.doesNotMatch(String(cleanup?.run), /stop_builds/);
    assert.match(
      String(cleanup?.run),
      /process\.env\.cutoverWasPaused !== "true"/,
    );
    assert.match(
      String(cleanup?.run),
      /!process\.env\.cutoverPublishedDeployId/,
    );
    assert.match(String(cleanup?.run), /currentDeployId === newDeployId/);
    assert.match(String(cleanup?.run), /newly published deploy/);
  });

  it("records cutover acquisition before pause verification", () => {
    const pause = nodeHeredocs[0];
    const acquiredIndex = pause.indexOf(
      'fs.appendFileSync(process.env.GITHUB_OUTPUT, "cutover_acquired=true\\n")',
    );
    const verificationIndex = pause.indexOf("const paused =");
    assert(acquiredIndex >= 0);
    assert(verificationIndex > acquiredIndex);
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
