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
  validateGoogleCallbackVerificationWorkflow,
  validateNetlifyApiRateLimitHandling,
  validateProductionPurgeCondition,
  validateReusableWorkflowConcurrency,
  validateProductionSiteConcurrency,
} from "./guard-netlify-prebuilt-workflow.ts";
import { resolveNetlifyMigrationUrl } from "./netlify-migration-url.ts";

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

const manageJob = (workflows().manage.jobs as Record<string, Workflow>).manage;
const manageScript = String(
  (
    (manageJob.steps as Array<Workflow>).find(
      (step) => typeof (step.with as Workflow | undefined)?.script === "string",
    )?.with as Workflow
  ).script,
);

const reusableSource = readFileSync(
  ".github/workflows/deploy-netlify-prebuilt.yml",
  "utf8",
);
const nodeHeredocs = [
  ...reusableSource.matchAll(
    /node(?: --experimental-strip-types)? <<'NODE'\n([\s\S]*?)\n\s*NODE/g,
  ),
].map((match) => match[1]);

describe("Google callback deploy verification guard", () => {
  it("requires direct probe execution and rolls back only definitive mismatches", () => {
    assert.deepEqual(
      validateGoogleCallbackVerificationWorkflow(reusableSource),
      [],
    );
    assert.match(
      validateGoogleCallbackVerificationWorkflow(
        reusableSource
          .replace(
            "node --experimental-strip-types scripts/check-google-redirect-uris.ts",
            "pnpm check:google-redirect-uris --",
          )
          .replace(
            "steps.google_redirect.outputs.exit_code == '1'",
            "steps.google_redirect.outputs.exit_code == '2'",
          ),
      ).join("\n"),
      /directly with the supported Node loader|only definitive/,
    );
  });
});

describe("Netlify API rate-limit guard", () => {
  it("routes all reusable-workflow API calls through the bounded helper", () => {
    assert.deepEqual(validateNetlifyApiRateLimitHandling(reusableSource), []);
    assert.match(
      validateNetlifyApiRateLimitHandling(
        reusableSource.replace(
          "requestNetlifyApi(`https://api.netlify.com/api/v1/sites/${siteId}`",
          "fetch(`https://api.netlify.com/api/v1/sites/${siteId}`",
        ),
      ).join("\n"),
      /raw Netlify fetch calls/,
    );
  });
});

describe("production Netlify site concurrency guard", () => {
  it("supports previous, N-back, and exact Netlify deploy rollbacks", () => {
    const helperStart = manageScript.indexOf("function publishedAtTimestamp");
    const helperEnd = manageScript.indexOf(
      "async function rollback",
      helperStart,
    );
    assert(helperStart >= 0 && helperEnd > helperStart);
    const {
      isRestorableProductionDeploy,
      parseRollbackTarget,
      selectRollbackDeploy,
    } = new Function(
      `${manageScript.slice(helperStart, helperEnd)}; return { isRestorableProductionDeploy, parseRollbackTarget, selectRollbackDeploy };`,
    )() as {
      isRestorableProductionDeploy: (deploy: Workflow) => boolean;
      parseRollbackTarget: (
        depth: string,
        deployId: string,
      ) => { depth: number | null; deployId: string | null };
      selectRollbackDeploy: (
        deploys: Array<Workflow>,
        currentId: string,
        currentPublishedAt: number,
        depth: number,
      ) => Workflow | null;
    };

    assert.deepEqual(parseRollbackTarget("1", ""), {
      depth: 1,
      deployId: null,
    });
    assert.deepEqual(parseRollbackTarget("3", ""), {
      depth: 3,
      deployId: null,
    });
    assert.deepEqual(parseRollbackTarget("1", "52465f435803544542000001"), {
      depth: null,
      deployId: "52465f435803544542000001",
    });
    assert.throws(() => parseRollbackTarget("0", ""), /positive safe integer/);
    assert.throws(
      () => parseRollbackTarget("1", "not-a-deploy"),
      /Netlify deploy ID/,
    );

    assert.equal(
      isRestorableProductionDeploy({ context: "production", state: "old" }),
      true,
    );
    assert.equal(
      isRestorableProductionDeploy({ context: "production", state: "ready" }),
      true,
    );
    assert.equal(
      isRestorableProductionDeploy({ context: "production", state: "error" }),
      false,
    );

    const deploys = [
      {
        id: "current",
        context: "production",
        state: "ready",
        published_at: "2026-08-23T03:00:00Z",
      },
      {
        id: "previous",
        context: "production",
        state: "old",
        published_at: "2026-08-23T02:00:00Z",
      },
      {
        id: "two-back",
        context: "production",
        state: "ready",
        published_at: "2026-08-23T01:00:00Z",
      },
      {
        id: "preview",
        context: "deploy-preview",
        state: "ready",
        published_at: "2026-08-23T00:00:00Z",
      },
    ];
    assert.equal(
      selectRollbackDeploy(
        deploys,
        "current",
        Date.parse("2026-08-23T03:00:00Z"),
        1,
      )?.id,
      "previous",
    );
    assert.equal(
      selectRollbackDeploy(
        deploys,
        "current",
        Date.parse("2026-08-23T03:00:00Z"),
        2,
      )?.id,
      "two-back",
    );
  });

  it("requires a distinct reusable child queue selected by the caller input", () => {
    assert.deepEqual(
      validateReusableWorkflowConcurrency(
        readWorkflow(".github/workflows/deploy-netlify-prebuilt.yml"),
      ),
      [],
    );
  });

  it("keeps automatic beta runs latest-main and source-keyed", () => {
    const beta = readWorkflow(
      ".github/workflows/deploy-beta-sites-prebuilt.yml",
    );
    assert.deepEqual(beta.concurrency, {
      group: "agent-native-release-pipeline",
      "cancel-in-progress": false,
    });
    assert.equal(
      ((beta.jobs as Workflow).deploy as Workflow).strategy?.["max-parallel"],
      8,
    );
    assert.equal(
      ((beta.jobs as Workflow)["discover-sites"] as Workflow).outputs
        ?.migration_matrix,
      undefined,
    );
    assert.equal((beta.jobs as Workflow).migrate, undefined);
    assert.deepEqual((beta.jobs as Workflow).deploy.needs, [
      "resolve-source",
      "discover-sites",
    ]);
    const reusable = readWorkflow(
      ".github/workflows/deploy-netlify-prebuilt.yml",
    );
    const validation = (
      ((reusable.jobs as Workflow).deploy as Workflow).steps as Array<Workflow>
    ).find((step) => step.name === "Validate rollout mode");
    assert.match(
      String(validation?.run),
      /BUILD_CONTEXT.*MIGRATION_ONLY.*production/,
    );
    assert.match(
      String((reusable.concurrency as Workflow).group),
      /format\('netlify-prebuilt-beta-\{0\}', inputs\.site\)/,
    );
    assert.match(
      String((reusable.concurrency as Workflow).group),
      /inputs\.caller == 'release-migration'/,
    );
    assert.match(
      reusableSource,
      /Verify beta source is current before publish/,
    );
    assert.match(
      reusableSource,
      /steps\.beta_freshness\.outputs\.current == 'true'/,
    );
    assert.match(
      reusableSource,
      /SOURCE_REF: \$\{\{ steps\.source\.outputs\.source_ref \}\}/,
    );
    assert.match(reusableSource, /netlify api getEnvVars/);
    assert.match(reusableSource, /account_id.*builder-io/);
    assert.match(
      reusableSource,
      /BUILD_CONTEXT="\$BUILD_CONTEXT" node --experimental-strip-types scripts\/netlify-migration-url\.ts/,
    );
  });

  it("resolves migration URLs by context, then preserves key priority", () => {
    const variables = [
      {
        key: "DATABASE_URL",
        values: [
          { context: "production", value: "postgresql://test.invalid/pooled" },
        ],
      },
      {
        key: "NETLIFY_DATABASE_URL_UNPOOLED",
        values: [
          { context: "unexpected", value: "postgresql://test.invalid/unknown" },
          { context: "all", value: "postgresql://test.invalid/unpooled" },
        ],
      },
    ];

    assert.equal(
      resolveNetlifyMigrationUrl(variables, "production"),
      "postgresql://test.invalid/unpooled",
    );
    assert.equal(
      resolveNetlifyMigrationUrl(
        [
          {
            key: "NETLIFY_DATABASE_URL_UNPOOLED",
            values: [{ context: "production", value: "not-a-database-url" }],
          },
          ...variables,
        ],
        "production",
      ),
      "postgresql://test.invalid/pooled",
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
    assert.equal(nodeHeredocs.length, 9);
    assert.equal(
      (reusableSource.match(/node --experimental-strip-types <<'NODE'/g) ?? [])
        .length,
      9,
    );
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
    assert.match(String(purge.run), /requestNetlifyApi\(`\$\{api\}\/purge`/);
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
    assert.match(build, /\[\[ \"\$SOURCE_TEMPLATE\" == \"clips\"/);
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

  it("runs Plan migrations after masked prebuilt assembly", () => {
    const workflow = readFileSync(
      ".github/workflows/deploy-netlify-prebuilt.yml",
      "utf8",
    );
    const planNetlify = readFileSync("templates/plan/netlify.toml", "utf8");
    const buildStart = workflow.indexOf(
      "name: Build with the Netlify project configuration",
    );
    const migrationStart = workflow.indexOf(
      "name: Run Plan release migrations",
    );
    const verifyStart = workflow.indexOf("name: Verify deploy directories");
    const uploadStart = workflow.indexOf("name: Upload the prebuilt deploy");

    assert.ok(buildStart >= 0);
    assert.ok(migrationStart > buildStart && migrationStart < verifyStart);
    assert.ok(uploadStart > migrationStart);
    assert.match(
      workflow,
      /if: >-\s+inputs\.deploy && inputs\.deploy_mode == 'production'/,
    );
    assert.match(workflow, /SOURCE_TEMPLATE.*clips.*plan/);
    assert.match(workflow, /agentNativePrebuiltDatabaseUrl=/);
    assert.match(
      workflow,
      /DATABASE_URL: \$\{\{ secrets\.PLAN_DATABASE_URL \}\}/,
    );
    assert.match(planNetlify, /agentNativePrebuiltDatabaseUrl/);
    assert.match(
      planNetlify,
      /agentNativePrebuiltBuild:-\}.*migrate:production/,
    );
  });

  it("runs Clips migrations against the production database", () => {
    const workflow = readFileSync(
      ".github/workflows/deploy-netlify-prebuilt.yml",
      "utf8",
    );
    const migrationStart = workflow.indexOf(
      "name: Run Clips release migrations",
    );
    const verifyStart = workflow.indexOf("name: Verify deploy directories");
    assert.ok(migrationStart >= 0 && migrationStart < verifyStart);
    const migration = workflow.slice(migrationStart, verifyStart);
    assert.match(migration, /inputs\.target == 'production'/);
    assert.match(migration, /inputs\.deploy_mode == 'production'/);
    assert.match(migration, /source_template == 'clips'/);
    assert.match(migration, /CLIPS_DATABASE_URL/);
    assert.match(migration, /pnpm --filter clips migrate:production/);
  });

  it("keeps production Chat assembly independent of masked runtime secrets", () => {
    const workflow = readFileSync(
      ".github/workflows/deploy-netlify-prebuilt.yml",
      "utf8",
    );
    const chatNetlify = readFileSync("templates/chat/netlify.toml", "utf8");
    const buildStart = workflow.indexOf(
      "name: Build with the Netlify project configuration",
    );
    const buildEnd = workflow.indexOf(
      "name: Verify deploy directories",
      buildStart,
    );
    const build = workflow.slice(buildStart, buildEnd);

    assert.match(
      build,
      /if \[\[ \"\$TARGET\" == \"production\" && \"\$SOURCE_TEMPLATE\" == \"chat\" \]\];/,
    );
    assert.match(chatNetlify, /agentNativePrebuiltDatabaseUrl/);
    assert.match(chatNetlify, /agentNativePrebuiltAuthSecret/);
    assert.match(
      chatNetlify,
      /agentNativePrebuiltBuild:-\}.*!= \\\"true\\\".*migrate:production/,
    );
  });

  it("only verifies static cache artifacts for prerendered prebuilt targets", () => {
    const workflow = readWorkflow(
      ".github/workflows/deploy-netlify-prebuilt.yml",
    );
    const jobs = workflow.jobs as Record<string, Workflow>;
    const steps = (jobs.deploy.steps as Array<Workflow>).filter(Boolean);
    const artifact = steps.find(
      (step) => step.name === "Verify static SSR cache artifact",
    );

    assert(artifact);
    assert.equal(
      artifact.if,
      "inputs.migration_only != true && (steps.target.outputs.source_template == 'clips' || steps.target.outputs.source_template == '@agent-native/docs')",
    );
    assert.match(String(artifact.run), /GUARD_SSR_CACHE_ARTIFACT_DIR/);
  });

  it("smoke-tests app health while keeping static docs on a shell-only probe", () => {
    const workflow = readWorkflow(
      ".github/workflows/deploy-netlify-prebuilt.yml",
    );
    const jobs = workflow.jobs as Record<string, Workflow>;
    const steps = (jobs.deploy.steps as Array<Workflow>).filter(Boolean);
    const appSmoke = steps.find(
      (step) => step.name === "Smoke-test the uploaded deploy",
    );
    const docsSmoke = steps.find(
      (step) => step.name === "Smoke-test the static docs deploy",
    );

    assert(appSmoke);
    assert.equal(
      appSmoke.if,
      "inputs.deploy && steps.beta_freshness.outputs.current != 'false' && inputs.smoke && steps.target.outputs.source_template != '@agent-native/docs'",
    );
    assert.match(String(appSmoke.run), /\/_agent-native\/health/);
    assert.match(String(appSmoke.run), /--max-time 60/);

    assert(docsSmoke);
    assert.equal(
      docsSmoke.if,
      "inputs.deploy && steps.beta_freshness.outputs.current != 'false' && inputs.smoke && steps.target.outputs.source_template == '@agent-native/docs'",
    );
    assert.doesNotMatch(String(docsSmoke.run), /\/_agent-native\/health/);
  });

  it("gives the beta branch-deploy build release and warm-runtime ownership", () => {
    const workflow = readFileSync(
      ".github/workflows/deploy-netlify-prebuilt.yml",
      "utf8",
    );
    const buildStart = workflow.indexOf(
      "name: Build with the Netlify project configuration",
    );
    const buildEnd = workflow.indexOf(
      "name: Verify deploy directories",
      buildStart,
    );
    const build = workflow.slice(buildStart, buildEnd);
    const betaStart = build.indexOf('if [[ "$TARGET" == "beta" ]]');
    const clipsStart = build.indexOf(
      'if [[ "$SOURCE_TEMPLATE" == "clips" ]]',
      betaStart,
    );
    const beta = build.slice(betaStart, clipsStart);
    const nonClipsStart = beta.indexOf(
      'if [[ "$SOURCE_TEMPLATE" != "clips" ]]',
    );
    const nonClipsEnd = beta.indexOf("\n          fi", nonClipsStart);
    const nonClips = beta.slice(nonClipsStart, nonClipsEnd);

    for (const flag of [
      "AGENT_NATIVE_RELEASE_MIGRATIONS=1",
      "AGENT_NATIVE_RUN_RELEASE_MIGRATIONS=1",
    ]) {
      assert.match(
        nonClips,
        new RegExp(`export ${flag.replace(/[=]/g, "\\=")}`),
      );
    }
    for (const flag of [
      "AGENT_NATIVE_ENABLE_KEEP_WARM=1",
      "AGENT_NATIVE_DISABLE_KEEP_WARM_BACKGROUND=1",
      "AGENT_NATIVE_HOSTED_HARNESS=true",
    ]) {
      assert.match(beta, new RegExp(`export ${flag.replace(/[=]/g, "\\=")}`));
    }
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
    assert.match(
      String(resume?.run),
      /process\.env\.cutoverHasGitConnectedBuild !== "true"/,
    );
    assert.equal(
      (resume?.env as Record<string, unknown>).cutoverWasStopped,
      "${{ steps.pause.outputs.was_stopped }}",
    );
    assert.equal(
      (resume?.env as Record<string, unknown>).cutoverWasPaused,
      "${{ steps.pause.outputs.cutover_acquired }}",
    );
    assert.equal(
      (resume?.env as Record<string, unknown>).cutoverHasGitConnectedBuild,
      "${{ steps.pause.outputs.has_git_connected_build }}",
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
    assert.match(pause, /hasGitConnectedBuild/);
    assert.match(pause, /has_git_connected_build/);
    assert.match(pause, /No Git-connected Netlify build is configured/);
    const acquiredIndex = pause.indexOf(
      'fs.appendFileSync(process.env.GITHUB_OUTPUT, "cutover_acquired=true\\n")',
    );
    const verificationIndex = pause.indexOf("await waitForBuildSetting");
    assert(acquiredIndex >= 0);
    assert(verificationIndex > acquiredIndex);
  });

  it("pauses the docs site before the prebuilt publisher runs", () => {
    const workflow = readWorkflow(
      ".github/workflows/deploy-docs-production.yml",
    );
    const jobs = workflow.jobs as Record<string, Workflow>;
    const deploy = jobs.deploy;
    const ownership = jobs["pause-netlify-builds"];
    assert.deepEqual(deploy?.needs, ["pause-netlify-builds", "migrate"]);
    assert.equal((jobs.migrate.with as Workflow).migration_only, true);
    const steps = (ownership?.steps as Array<Workflow>).filter(Boolean);
    const disable = steps.find(
      (step) =>
        step.name === "Disable the docs site's Git-connected Netlify builds",
    );
    assert(disable);
    const run = String(disable.run);
    assert.match(run, /'Content-Type': 'application\/json'/);
    assert.match(run, /returned an invalid JSON response/);
    assert.match(run, /returned an invalid JSON object/);
    assert.doesNotMatch(run, /body = text;/);
    assert.match(run, /hasGitConnectedBuild/);
    assert.match(run, /current\.git_provider/);
    assert.match(run, /current\.repo\?\.repo_path/);
    assert.match(run, /stop_builds: true/);
    assert.match(run, /for \(let attempt = 1; attempt <= 15; attempt \+= 1\)/);
    assert.match(run, /stop_builds=\$\{expected\}/);
    assert.match(run, /changedStopBuilds/);
    assert.match(run, /verificationError/);
    assert.match(run, /Netlify docs build pause rollback/);
    assert.equal(
      (ownership?.concurrency as Workflow)?.group,
      "agent-native-production-site-fw",
    );
    assert.equal(
      (ownership?.outputs as Workflow)?.cutover_acquired,
      "${{ steps.pause.outputs.cutover_acquired }}",
    );
    const restore = jobs["restore-netlify-builds"];
    assert.deepEqual(restore?.needs, [
      "pause-netlify-builds",
      "migrate",
      "deploy",
    ]);
    assert.match(String(restore?.if), /always\(\)/);
    assert.equal(
      (restore?.concurrency as Workflow)?.group,
      "agent-native-production-site-fw",
    );
    const restoreStep = (restore?.steps as Array<Workflow>).find(
      (step) => step.name === "Restore the prior docs build setting",
    );
    assert(restoreStep);
    assert.match(String(restoreStep.if), /cutover_acquired/);
    assert.match(String(restoreStep.run), /stop_builds: false/);
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
