import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { parse } from "yaml";

import {
  PUBLISHED_CACHE_PURGE_CONDITION,
  PRODUCTION_SITE_GROUP,
  validateGoogleCallbackVerificationWorkflow,
  validateNetlifyApiRateLimitHandling,
  validateNetlifyPrPreviewWorkflow,
  validatePublishedCachePurgeCondition,
  validateReusableCallerPermissions,
  validateReusablePreviewRecordPlacement,
  validateReusableWorkflowConcurrency,
  validateReusableWorkflowPermissions,
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

const pullRequestPreviewSource = readFileSync(
  ".github/workflows/deploy-netlify-pr-previews.yml",
  "utf8",
);
const trustedPreviewBuildStart = reusableSource.indexOf(
  "      - name: Build trusted preview Functions for the PR artifact",
);
const trustedPreviewBuildEnd = reusableSource.indexOf(
  "      - name: Run Plan release migrations",
  trustedPreviewBuildStart,
);
const trustedPreviewBuildSource = reusableSource.slice(
  trustedPreviewBuildStart,
  trustedPreviewBuildEnd,
);

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

describe("Netlify PR preview workflow guard", () => {
  it("keeps PR builds secret-free and uploads through the trusted prebuilt lane", () => {
    assert.deepEqual(
      validateNetlifyPrPreviewWorkflow(
        readWorkflow(".github/workflows/deploy-netlify-pr-previews.yml"),
        pullRequestPreviewSource,
      ),
      [],
    );
    const preview = readWorkflow(
      ".github/workflows/deploy-netlify-pr-previews.yml",
    );
    const previewDeploy = (preview.jobs as Record<string, Workflow>).deploy;
    assert.equal(
      (previewDeploy.with as Workflow).checkout_ref,
      "${{ github.event.pull_request.base.sha }}",
    );
    const previewDiscover = (preview.jobs as Record<string, Workflow>).discover;
    const previewDiscoverCheckout = (
      previewDiscover.steps as Array<Workflow>
    ).find(
      (step) =>
        typeof step.uses === "string" &&
        step.uses.startsWith("actions/checkout@"),
    );
    assert.equal(
      (previewDiscoverCheckout?.with as Workflow).ref,
      "${{ github.event.pull_request.base.sha }}",
    );
    assert.match(
      reusableSource,
      /supplies static files; arbitrary PR Functions never reach Netlify\./,
    );
    assert.match(
      pullRequestPreviewSource,
      /needs\.deploy\.result != 'cancelled'/,
    );
    assert.match(pullRequestPreviewSource, /No successful deploy record/);
    assert.match(pullRequestPreviewSource, /auto_merge: false/);
    assert.match(pullRequestPreviewSource, /required_contexts: \[\]/);
    assert.match(pullRequestPreviewSource, /createDeploymentStatus/);
    assert.doesNotMatch(
      pullRequestPreviewSource,
      /issues: write|pull-requests: write|createComment/,
    );
    const previewJobs = preview.jobs as Record<string, Workflow>;
    assert.equal(previewJobs.comment, undefined);
    assert.deepEqual(previewJobs.deployment?.permissions, {
      actions: "read",
      contents: "read",
      deployments: "write",
    });
    const deploymentStep = (
      previewJobs.deployment.steps as Array<Workflow>
    ).find((step) =>
      String((step.with as Workflow | undefined)?.script ?? "").includes(
        "createDeploymentStatus",
      ),
    );
    assert.match(
      String((deploymentStep?.with as Workflow).script),
      /createDeploymentStatus/,
    );
    assert.match(reusableSource, /build_args\+=\(--offline\)/);
    assert.match(
      trustedPreviewBuildSource,
      /netlify build --context "\$BUILD_CONTEXT" --filter "\$SOURCE_TEMPLATE" --offline/,
    );
  });

  it("fails when deployment options are missing or calls are swapped", () => {
    const mutate = (needle: string, replacement: string) => {
      const source = pullRequestPreviewSource.replace(needle, replacement);
      return validateNetlifyPrPreviewWorkflow(
        parse(source) as Workflow,
        source,
      );
    };
    for (const [needle, replacement] of [
      ["ref: process.env.SOURCE_REF", "ref: process.env.OTHER_REF"],
      ["auto_merge: false", "auto_merge: true"],
      ["state: 'success'", "state: 'failure'"],
      ["createDeployment(", "createDeploymentStatus("],
    ]) {
      assert.notDeepEqual(mutate(needle, replacement), []);
    }
  });
});

describe("Reusable workflow permission guard", () => {
  it("keeps shared deploy permissions compatible with every caller", () => {
    const reusable = readWorkflow(
      ".github/workflows/deploy-netlify-prebuilt.yml",
    );
    assert.deepEqual(validateReusableWorkflowPermissions(reusable), []);
    assert.deepEqual(validateReusablePreviewRecordPlacement(reusable), []);
    assert.match(
      validateReusableWorkflowPermissions({
        ...reusable,
        permissions: { contents: "read", issues: "write" },
      }).join("\n"),
      /must declare only the read permissions used by the reusable deploy job/,
    );
    const beta = readWorkflow(
      ".github/workflows/deploy-beta-sites-prebuilt.yml",
    );
    assert.deepEqual(
      validateReusableCallerPermissions(
        beta,
        ".github/workflows/deploy-beta-sites-prebuilt.yml",
      ),
      [],
    );
    assert.match(
      validateReusableCallerPermissions(
        {
          ...beta,
          jobs: {
            ...(beta.jobs as Workflow),
            deploy: {
              ...(beta.jobs as Workflow).deploy,
              permissions: { issues: "write" },
            },
          },
        },
        ".github/workflows/deploy-beta-sites-prebuilt.yml",
      ).join("\n"),
      /deploy reusable deploy job must explicitly retain contents access/,
    );
    assert.deepEqual(
      validateReusableCallerPermissions(
        {
          permissions: { contents: "read" },
          jobs: {
            future_caller: {
              uses: "./.github/workflows/deploy-netlify-prebuilt.yml",
            },
            unrelated: { "runs-on": "ubuntu-latest" },
          },
        },
        ".github/workflows/future-caller.yml",
      ),
      [],
    );
    assert.match(
      validateReusableCallerPermissions(
        {
          permissions: { contents: "read" },
          jobs: {
            future_caller: {
              uses: "./.github/workflows/deploy-netlify-prebuilt.yml",
              permissions: { issues: "write" },
            },
          },
        },
        ".github/workflows/future-caller.yml",
      ).join("\n"),
      /future_caller reusable deploy job must explicitly retain contents access/,
    );
    assert.match(
      validateReusableCallerPermissions(
        {
          jobs: {
            future_caller: {
              uses: "./.github/workflows/deploy-netlify-prebuilt.yml",
            },
          },
        },
        ".github/workflows/future-caller.yml",
      ).join("\n"),
      /future_caller reusable deploy job must explicitly retain contents access/,
    );
  });

  it("normalizes quoted reusable caller paths before validating them", () => {
    const quotedCaller = parse(`
permissions:
  contents: read
jobs:
  quoted_caller:
    uses: "./.github/workflows/deploy-netlify-prebuilt.yml"
`) as Workflow;
    assert.deepEqual(
      validateReusableCallerPermissions(
        quotedCaller,
        ".github/workflows/quoted-caller.yml",
      ),
      [],
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

  it("requires distinct preview and beta child queues", () => {
    const reusable = readWorkflow(
      ".github/workflows/deploy-netlify-prebuilt.yml",
    );
    assert.deepEqual(validateReusableWorkflowConcurrency(reusable), []);
    assert.match(
      String((reusable.concurrency as Workflow).group),
      /inputs\.target == 'preview'[\s\S]*netlify-prebuilt-preview-\{0\}-\{1\}/,
    );
  });

  it("coalesces pending beta runs and keeps the source latest-main", () => {
    const beta = readWorkflow(
      ".github/workflows/deploy-beta-sites-prebuilt.yml",
    );
    const betaConcurrency = beta.concurrency as Workflow;
    assert.equal(betaConcurrency["cancel-in-progress"], false);
    assert.match(
      String(betaConcurrency.group),
      /github\.event_name == 'workflow_dispatch'/,
    );
    assert.match(
      String(betaConcurrency.group),
      /format\('deploy-agent-native-beta-manual-\{0\}', github\.run_id\)/,
    );
    assert.match(
      String(betaConcurrency.group),
      /'deploy-agent-native-beta-sites-prebuilt'/,
    );
    assert.equal((beta.permissions as Workflow).contents, "write");
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
      "schema-gate",
    ]);
    const schemaGate = (beta.jobs as Workflow)["schema-gate"] as Workflow;
    assert.equal(schemaGate.needs, "resolve-source");
    const schemaGateStep = (schemaGate.steps as Array<Workflow>).find(
      (step) =>
        step.name ===
        "Detect schema-dependent beta code without production migration",
    );
    assert.match(String(schemaGateStep?.run), /migrated_source_sha/);
    assert.match(String(schemaGateStep?.run), /base_sha_input/);
    assert.equal(
      schemaGateStep?.env?.base_sha_input,
      "${{ github.event.before }}",
    );
    assert.match(
      String(schemaGateStep?.run),
      /git hash-object -t tree \/dev\/null/,
    );
    assert.match(String(schemaGateStep?.run), /git diff --name-only/);
    assert.match(String(schemaGateStep?.run), /grep -E/);
    assert.doesNotMatch(String(schemaGateStep?.run), /\brg\b/);
    assert.match(String(schemaGateStep?.run), /\[\[ "\$status" -eq 1 \]\]/);
    assert.match(
      String(schemaGateStep?.run),
      /git tag --list 'agent-native-beta-pending\/\*'/,
    );
    assert.match(String(schemaGateStep?.run), /agent-native-beta-migrated/);
    assert.match(String(schemaGateStep?.run), /unresolved_pending_sha/);
    assert.match(String(schemaGateStep?.run), /required_source_sha/);
    assert.match(String(schemaGateStep?.run), /schema_files/);
    assert.match(String(schemaGateStep?.run), /schema_files_between/);
    assert.match(
      String(schemaGateStep?.run),
      /Ignoring obsolete beta migration marker/,
    );
    assert.match(
      String(schemaGateStep?.run),
      /if ! changed_files="\$\(git diff --name-only "\$1" "\$2"\)"/,
    );
    assert.match(
      String(schemaGateStep?.run),
      /pending_schema_files="\$\(schema_files_between "\$pending_base" "\$pending_sha"\)"/,
    );
    assert.match(String(schemaGateStep?.run), /\[\[ "\$status" -eq 0 \]\]/);
    assert.match(
      String(schemaGateStep?.run),
      /is_ancestor "\$latest_migrated_sha" "\$pending_sha"/,
    );
    assert.doesNotMatch(
      String(schemaGateStep?.run),
      /packages\/core\/src\/db\/\|/,
    );
    const schemaPattern = String(schemaGateStep?.run).match(
      /grep -E '([^']+)'/,
    )?.[1];
    assert(schemaPattern);
    const classifiesAsSchemaDependent = new RegExp(schemaPattern).test.bind(
      new RegExp(schemaPattern),
    );
    assert.equal(
      classifiesAsSchemaDependent("packages/core/src/db/client.ts"),
      false,
    );
    assert.equal(
      classifiesAsSchemaDependent("packages/core/src/db/schema.ts"),
      true,
    );
    const schemaGateBlockStep = (schemaGate.steps as Array<Workflow>).find(
      (step) =>
        step.name ===
        "Block schema-dependent beta code until production migration",
    );
    assert.match(String(schemaGateBlockStep?.run), /required_source_sha/);
    const migrationMarkerStep = (schemaGate.steps as Array<Workflow>).find(
      (step) => step.name === "Record pending beta migration marker",
    );
    assert.match(
      String(schemaGateStep?.run),
      /No production-owned migration marker exists/,
    );
    assert.match(String(migrationMarkerStep?.if), /record_pending/);
    assert.match(
      String(migrationMarkerStep?.with?.script),
      /Concurrent beta pending marker/,
    );
    assert.match(String(migrationMarkerStep?.with?.script), /createRef/);
    assert.equal(
      (schemaGate.steps as Array<Workflow>)[0].with?.["fetch-depth"],
      0,
    );
    const production = readWorkflow(
      ".github/workflows/deploy-production-sites-prebuilt.yml",
    );
    const productionDiscover = (production.jobs as Workflow)[
      "discover-sites"
    ] as Workflow;
    assert.equal(
      productionDiscover.outputs?.complete_fleet,
      "${{ steps.matrix.outputs.complete_fleet }}",
    );
    assert.match(
      String(productionDiscover.steps[1].run),
      /completeFleet.*productionNames/s,
    );
    assert.match(
      String(productionDiscover.steps[1].run),
      /productionNames\.every/,
    );
    assert.match(
      String(productionDiscover.steps[1].run),
      /names\.includes\(name\)/,
    );
    assert.match(String(productionDiscover.steps[1].run), /buildable\.some/);
    assert.doesNotMatch(
      String(productionDiscover.steps[1].run),
      /unsupported\.length\s*===\s*0/,
    );
    const productionMarker = (production.jobs as Workflow)[
      "record-beta-migration"
    ] as Workflow;
    assert.match(
      String(productionMarker.if),
      /needs\.discover-sites\.outputs\.complete_fleet == 'true'/,
    );
    assert.match(
      String(productionMarker.if),
      /needs\.deploy\.result == 'success'/,
    );
    assert.deepEqual(productionMarker.needs, [
      "resolve-source",
      "discover-sites",
      "deploy",
    ]);
    assert.equal((productionMarker.permissions as Workflow).contents, "write");
    assert.match(
      String(productionMarker.steps[0].with?.script),
      /agent-native-beta-migrated/,
    );
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
      /inputs\.target == 'beta'\s+&&\s+format\('netlify-prebuilt-beta-\{0\}', inputs\.site\)/,
    );
    assert.match(
      String((reusable.concurrency as Workflow).group),
      /github\.event_name == 'workflow_dispatch'\s+&&\s+!inputs\.caller/,
    );
    assert.match(
      String((reusable.concurrency as Workflow).group),
      /format\('netlify-prebuilt-beta-direct-\{0\}-\{1\}', inputs\.site, github\.run_id\)/,
    );
    assert.equal(
      (reusable.concurrency as Workflow)["cancel-in-progress"],
      false,
    );
    assert.match(
      String((reusable.concurrency as Workflow).group),
      /inputs\.caller == 'release-migration'/,
    );
    assert.equal(
      ((reusable.jobs as Workflow).deploy as Workflow)["timeout-minutes"],
      150,
    );
    assert.match(
      reusableSource,
      /Verify beta source is current immediately before upload/,
    );
    assert.match(
      reusableSource,
      /steps\.beta_freshness\.outputs\.current == 'true'/,
    );
    assert.doesNotMatch(reusableSource, /allowPinnedRecovery/);
    assert.match(
      reusableSource,
      /core\.setOutput\('current', String\(current\)\)/,
    );
    assert.match(reusableSource, /Verify beta source is current after publish/);
    assert.match(
      reusableSource,
      /always\(\) && inputs\.target == 'beta' && inputs\.deploy/,
    );
    assert.match(reusableSource, /steps\.deploy\.outputs\.deploy_id != ''/);
    assert.match(
      reusableSource,
      /steps\.beta_post_freshness\.outputs\.current == 'false'/,
    );
    assert.match(reusableSource, /Revert stale beta deploy/);
    assert.match(
      reusableSource,
      /sites\/\$\{siteId\}\/deploys\/\$\{previousId\}\/restore/,
    );
    assert.match(reusableSource, /deploys\/\$\{deployId\}\/cancel/);
    assert.match(reusableSource, /cancellationRequested/);
    assert.match(reusableSource, /PREVIOUS_DEPLOY_ID/);
    assert.match(reusableSource, /const publishedDeployId/);
    assert.match(
      reusableSource,
      /keeping the beta queue occupied until the stale deploy is non-publishable/,
    );
    assert.match(reusableSource, /Netlify beta freshness restore precondition/);
    assert.match(reusableSource, /const restoredDeployId = restored\?\.id/);
    assert.match(
      reusableSource,
      /current\.published_deploy\?\.id === restoredDeployId/,
    );
    assert.match(
      reusableSource,
      /steps\.previous\.outputs\.published_deploy_id != ''/,
    );
    assert.match(
      reusableSource,
      /Keep this job in the per-site concurrency group until Netlify/,
    );
    assert.match(reusableSource, /cancellationRejected/);
    assert.match(reusableSource, /deletionRequested/);
    assert.match(reusableSource, /method: "DELETE"/);
    assert.match(
      reusableSource,
      /Netlify stale beta deploy \$\{deployId\} deletion/,
    );
    assert.doesNotMatch(
      reusableSource,
      /did not settle before the five-minute cleanup deadline/,
    );
    assert.match(
      reusableSource,
      /steps\.beta_post_freshness\.outcome == 'failure'/,
    );
    assert.match(
      reusableSource,
      /steps\.beta_first_publish_freshness\.outcome == 'failure'/,
    );
    assert.match(
      reusableSource,
      /steps\.beta_first_publish_freshness\.outputs\.current == 'false'/,
    );
    assert.match(
      reusableSource,
      /steps\.beta_first_publish_wait\.outcome == 'failure'/,
    );
    assert.match(reusableSource, /id: deploy_wait/);
    assert.match(
      reusableSource,
      /Netlify beta deploy \$\{process\.env\.DEPLOY_ID\} was superseded by unrelated published deploy/,
    );
    assert.match(reusableSource, /steps\.deploy_wait\.outcome == 'failure'/);
    assert.match(reusableSource, /TARGET: \$\{\{ inputs\.target \}\}/);
    assert.match(reusableSource, /PUBLISH_STARTED_AT/);
    assert.match(reusableSource, /DEPLOY_MESSAGE/);
    assert.match(reusableSource, /first beta production deploy reconciliation/);
    assert.match(reusableSource, /Could not parse Netlify CLI output/);
    assert.match(reusableSource, /deploy\.commit_ref/);
    assert.match(reusableSource, /Fail after beta freshness verification/);
    assert.match(
      reusableSource,
      /inputs\.target == 'beta' \|\| \(inputs\.smoke && steps\.target\.outputs\.source_template != '@agent-native\/docs'\)/,
    );
    assert.match(reusableSource, /inputs\.caller/);
    const betaResolveSource = readWorkflow(
      ".github/workflows/deploy-beta-sites-prebuilt.yml",
    );
    const betaResolveStep = (
      ((betaResolveSource.jobs as Workflow)["resolve-source"] as Workflow)
        .steps as Array<Workflow>
    ).find((step) => step.id === "source");
    assert.equal(
      ((betaResolveSource.jobs as Workflow).deploy as Workflow).with?.caller,
      "${{ github.event_name == 'workflow_dispatch' && 'manual' || 'automatic' }}",
    );
    assert.match(
      String(betaResolveStep?.with?.script),
      /context\.eventName === 'workflow_dispatch'/,
    );
    assert.match(
      String(betaResolveStep?.with?.script),
      /sourceSha\.toLowerCase\(\) !== mainSha\.toLowerCase\(\)/,
    );
    assert.match(
      String(betaResolveStep?.with?.script),
      /Manual beta source_ref must equal current main/,
    );
    assert.match(
      reusableSource,
      /Beta source_ref must be a full 40-character commit SHA/,
    );
    assert.match(reusableSource, /Beta source_ref must equal current main/);
    assert.match(
      reusableSource,
      /Direct beta dispatch is unsupported; use deploy-beta-sites-prebuilt\.yml\./,
    );
    assert.match(reusableSource, /process\.env\.CALLER\.trim\(\)/);
    assert.match(reusableSource, /Netlify beta site has no published deploy/);
    assert.match(
      reusableSource,
      /Uploading the first beta deploy as a draft until its source is revalidated\./,
    );
    assert.match(
      reusableSource,
      /Verify first beta deploy source immediately before publish/,
    );
    assert.match(
      reusableSource,
      /Publish first beta deploy after freshness verification/,
    );
    assert.match(reusableSource, /id: beta_first_publish/);
    assert.match(reusableSource, /--prod/);
    assert.match(
      reusableSource,
      /Wait for first beta production deploy to publish/,
    );
    assert.match(reusableSource, /id: beta_first_publish_wait/);
    assert.match(reusableSource, /Netlify first beta production deploy status/);
    assert.match(
      reusableSource,
      /did not become ready and published within 30 minutes/,
    );
    assert.match(reusableSource, /main_sha,,\}" != "\$\{SOURCE_REF,,\}"/);
    assert.doesNotMatch(
      reusableSource.slice(
        reusableSource.indexOf(
          "name: Publish first beta deploy after freshness verification",
        ),
        reusableSource.indexOf(
          "name: Verify beta source is current after publish",
        ),
      ),
      /\/restore/,
    );
    assert.match(reusableSource, /id: beta_first_publish_reconcile/);
    assert.match(
      reusableSource,
      /steps\.beta_first_publish\.outputs\.deploy_id \|\| steps\.beta_first_publish_reconcile\.outputs\.deploy_id/,
    );
    assert.match(reusableSource, /Recovered first beta production deploy/);
    assert.match(reusableSource, /Netlify published unrelated deploy/);
    assert.doesNotMatch(
      reusableSource,
      /DEPLOY_ID: \$\{\{ steps\.beta_first_publish\.outputs\.deploy_id \|\| steps\.deploy\.outputs\.deploy_id \}\}/,
    );
    assert.match(reusableSource, /Delete staged first beta draft/);
    assert.match(reusableSource, /id: beta_draft_cleanup/);
    assert.match(reusableSource, /DRAFT_DEPLOY_ID/);
    assert.match(
      reusableSource,
      /Netlify staged beta draft \$\{draftId\} deletion/,
    );
    assert.match(
      reusableSource,
      /Refusing to delete staged beta draft \$\{draftId\} because Netlify published it\./,
    );
    assert.match(reusableSource, /cancellationDeadline/);
    assert.match(
      reusableSource,
      /staged beta draft \$\{draftId\} cancellation status/,
    );
    assert.match(
      reusableSource,
      /Canceled and deleted staged beta draft \$\{draftId\}\./,
    );
    assert.match(reusableSource, /did not become terminal after cancellation/);
    assert.match(
      reusableSource,
      /DEPLOY_URL: \$\{\{ steps\.beta_first_publish\.outputs\.deploy_url \|\| steps\.beta_first_publish_reconcile\.outputs\.deploy_url \|\| \(steps\.previous\.outputs\.published_deploy_id != '' && steps\.deploy\.outputs\.deploy_url\) \}\}/,
    );
    assert.match(
      reusableSource,
      /First publishes are staged as drafts and only published after a current-main check/,
    );
    assert.doesNotMatch(reusableSource, /requested \|\| 'beta'/);
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
    assert.equal(
      resolveNetlifyMigrationUrl(
        {
          connection_string: "postgresql://test.invalid/netlify-db",
          connection_strings: {
            netlifydb_readonly: "postgresql://test.invalid/readonly",
          },
        },
        "production",
      ),
      "postgresql://test.invalid/netlify-db",
    );
  });

  it("rejects the dead workflow_call event check", () => {
    const mutated = readWorkflow(
      ".github/workflows/deploy-netlify-prebuilt.yml",
    );
    const concurrency = mutated.concurrency as Record<string, unknown>;
    concurrency.group = String(concurrency.group).replaceAll(
      "inputs.caller",
      "github.event_name",
    );

    assert.notDeepEqual(validateReusableWorkflowConcurrency(mutated), []);
  });

  it("executes every reusable workflow heredoc under the pinned Node loader", () => {
    assert.equal(nodeHeredocs.length, 13);
    assert.equal(
      (reusableSource.match(/node --experimental-strip-types <<'NODE'/g) ?? [])
        .length,
      13,
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

  it("purges the published cache after smoke and before relocking the deploy", () => {
    const workflow = readWorkflow(
      ".github/workflows/deploy-netlify-prebuilt.yml",
    );
    const jobs = workflow.jobs as Record<string, Workflow>;
    const steps = (jobs.deploy.steps as Array<Workflow>).filter(Boolean);
    const smokeIndex = steps.findIndex(
      (step) => step.name === "Smoke-test the uploaded deploy",
    );
    const purgeIndex = steps.findIndex(
      (step) => step.name === "Purge the published Netlify cache",
    );
    const lockIndex = steps.findIndex(
      (step) => step.name === "Lock the published production deploy",
    );
    assert(
      smokeIndex >= 0 && smokeIndex < purgeIndex && purgeIndex < lockIndex,
    );

    const purge = steps[purgeIndex];
    assert.match(String(purge.if), /inputs.target == 'production'/);
    assert.match(String(purge.if), /inputs.target == 'beta'/);
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
    assert.match(
      build,
      /\[\[ \"\$SOURCE_TEMPLATE\" == \"clips\" \|\| \"\$SOURCE_TEMPLATE\" == \"plan\" \]\]/,
    );
    assert.match(build, /\[\[ \"\$SOURCE_TEMPLATE\" == \"crm\" \]\]/);
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

  it("keeps Analytics migrations on its app-scoped database URL", () => {
    const workflow = readFileSync(
      ".github/workflows/deploy-netlify-prebuilt.yml",
      "utf8",
    );
    const analyticsNetlify = readFileSync(
      "templates/analytics/netlify.toml",
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

    assert.match(
      workflow,
      /ANALYTICS_DATABASE_URL_SECRET: \$\{\{ inputs\.target == 'production' && steps\.target\.outputs\.source_template == 'analytics' && secrets\.ANALYTICS_DATABASE_URL \|\| '' \}\}/,
    );
    assert.match(build, /export ANALYTICS_DATABASE_URL_SECRET/);
    assert.match(analyticsNetlify, /ANALYTICS_DATABASE_URL_SECRET/);
    assert.match(
      analyticsNetlify,
      /unset NETLIFY_DATABASE_URL NETLIFY_DATABASE_URL_UNPOOLED DATABASE_URL_UNPOOLED/,
    );
    assert.doesNotMatch(analyticsNetlify, /NETLIFY_DATABASE_URL:-/);

    const rebind = analyticsNetlify.indexOf(
      'export ANALYTICS_DATABASE_URL=\\"$ANALYTICS_DATABASE_URL_SECRET\\"',
    );
    const clearMaskedUrls = analyticsNetlify.indexOf(
      "unset NETLIFY_DATABASE_URL NETLIFY_DATABASE_URL_UNPOOLED DATABASE_URL_UNPOOLED",
    );
    const exportDatabaseUrl = analyticsNetlify.indexOf(
      'export DATABASE_URL=\\"${ANALYTICS_DATABASE_URL:-$DATABASE_URL}\\"',
    );
    assert.ok(rebind >= 0 && rebind < clearMaskedUrls);
    assert.ok(clearMaskedUrls < exportDatabaseUrl);

    const rebindScript = [
      'if [ -n "${ANALYTICS_DATABASE_URL_SECRET:-}" ]; then export ANALYTICS_DATABASE_URL="$ANALYTICS_DATABASE_URL_SECRET"; fi',
      "unset NETLIFY_DATABASE_URL NETLIFY_DATABASE_URL_UNPOOLED DATABASE_URL_UNPOOLED",
      'export DATABASE_URL="${ANALYTICS_DATABASE_URL:-$DATABASE_URL}"',
      'printf "%s\\n%s\\n" "$ANALYTICS_DATABASE_URL" "$DATABASE_URL"',
    ].join("\n");
    const runRebind = (env: NodeJS.ProcessEnv): string[] =>
      execFileSync("bash", ["-c", rebindScript], {
        env,
        encoding: "utf8",
      })
        .trim()
        .split("\n");

    assert.deepEqual(
      runRebind({
        ANALYTICS_DATABASE_URL_SECRET: "",
        ANALYTICS_DATABASE_URL: "postgres://beta.example/analytics",
        DATABASE_URL: "postgres://beta.example/analytics",
        NETLIFY_DATABASE_URL: "masked",
        NETLIFY_DATABASE_URL_UNPOOLED: "masked",
        DATABASE_URL_UNPOOLED: "masked",
      }),
      [
        "postgres://beta.example/analytics",
        "postgres://beta.example/analytics",
      ],
    );
    assert.deepEqual(
      runRebind({
        ANALYTICS_DATABASE_URL_SECRET:
          "postgres://production.example/analytics",
        ANALYTICS_DATABASE_URL: "masked",
        DATABASE_URL: "postgres://crm.example/database",
        NETLIFY_DATABASE_URL: "masked",
        NETLIFY_DATABASE_URL_UNPOOLED: "masked",
        DATABASE_URL_UNPOOLED: "masked",
      }),
      [
        "postgres://production.example/analytics",
        "postgres://production.example/analytics",
      ],
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
    assert.match(workflow, /SOURCE_TEMPLATE.*clips.*plan/s);
    assert.match(workflow, /SOURCE_TEMPLATE.*crm/s);
    assert.match(workflow, /agentNativePrebuiltDatabaseUrl=/);
    assert.match(
      workflow,
      /DATABASE_URL: \$\{\{ secrets\.PLAN_DATABASE_URL \}\}/,
    );
    assert.match(planNetlify, /agentNativePrebuiltDatabaseUrl/);
    assert.match(
      planNetlify,
      /export DATABASE_URL=\$\{NETLIFY_DATABASE_URL:-\$DATABASE_URL\}.*&& unset NETLIFY_DATABASE_URL NETLIFY_DATABASE_URL_UNPOOLED DATABASE_URL_UNPOOLED/,
    );
    assert.match(
      planNetlify,
      /agentNativePrebuiltBuild:-\}.*migrate:production/,
    );

    const clearMaskedUrls = planNetlify.indexOf(
      "unset NETLIFY_DATABASE_URL NETLIFY_DATABASE_URL_UNPOOLED DATABASE_URL_UNPOOLED",
    );
    const normalDatabaseUrl = planNetlify.indexOf(
      "export DATABASE_URL=${NETLIFY_DATABASE_URL:-$DATABASE_URL}",
    );
    assert.ok(normalDatabaseUrl >= 0 && normalDatabaseUrl < clearMaskedUrls);

    const planDatabaseScript = [
      'if [ "${agentNativePrebuiltBuild:-}" = "true" ]; then export DATABASE_URL="${agentNativePrebuiltDatabaseUrl:?}" BETTER_AUTH_SECRET="${agentNativePrebuiltAuthSecret:?}"; else export DATABASE_URL=${NETLIFY_DATABASE_URL:-$DATABASE_URL}; fi',
      "unset NETLIFY_DATABASE_URL NETLIFY_DATABASE_URL_UNPOOLED DATABASE_URL_UNPOOLED",
      'printf "%s\\n" "$DATABASE_URL"',
    ].join("\n");
    const runPlanDatabaseSelection = (env: NodeJS.ProcessEnv): string =>
      execFileSync("bash", ["-c", planDatabaseScript], {
        env,
        encoding: "utf8",
      }).trim();

    assert.equal(
      runPlanDatabaseSelection({
        agentNativePrebuiltBuild: "true",
        agentNativePrebuiltDatabaseUrl: "postgres://build.example/plan",
        agentNativePrebuiltAuthSecret: "fake",
        DATABASE_URL: "masked",
        NETLIFY_DATABASE_URL: "masked",
        NETLIFY_DATABASE_URL_UNPOOLED: "masked",
        DATABASE_URL_UNPOOLED: "masked",
      }),
      "postgres://build.example/plan",
    );
    assert.equal(
      runPlanDatabaseSelection({
        agentNativePrebuiltBuild: "",
        DATABASE_URL: "postgres://fallback.example/plan",
        NETLIFY_DATABASE_URL: "postgres://beta.example/plan",
        NETLIFY_DATABASE_URL_UNPOOLED: "masked",
        DATABASE_URL_UNPOOLED: "masked",
      }),
      "postgres://beta.example/plan",
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

  it("runs CRM migrations against the Netlify-managed database", () => {
    const workflow = readFileSync(
      ".github/workflows/deploy-netlify-prebuilt.yml",
      "utf8",
    );
    const migrationStart = workflow.indexOf("name: Run CRM release migrations");
    const pauseStart = workflow.indexOf(
      "name: Pause automatic Netlify builds for production cutover",
    );
    const unlockStart = workflow.indexOf(
      "name: Unlock the published production deploy",
    );
    assert.ok(migrationStart > pauseStart && migrationStart < unlockStart);
    const migration = workflow.slice(migrationStart, unlockStart);
    assert.match(migration, /inputs\.target == 'production'/);
    assert.match(migration, /inputs\.deploy_mode == 'production'/);
    assert.match(migration, /source_template == 'crm'/);
    assert.match(migration, /getSiteDatabase/);
    assert.match(migration, /role.*netlifydb_owner/);
    assert.match(migration, /netlify-migration-url\.ts/);
    assert.match(migration, /pnpm --filter crm migrate:production/);
  });

  it("keeps Chat assembly independent of masked runtime secrets", () => {
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
      /if \[\[ \( \"\$TARGET\" == \"beta\" \|\| \"\$TARGET\" == \"production\" \|\| \"\$TARGET\" == \"preview\" \) && \"\$SOURCE_TEMPLATE\" == \"chat\" \]\];/,
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
      "inputs.migration_only != true && inputs.artifact_download != true && (steps.target.outputs.source_template == 'clips' || steps.target.outputs.source_template == '@agent-native/docs')",
    );
    assert.match(String(artifact.run), /GUARD_SSR_CACHE_ARTIFACT_DIR/);
  });

  it("checks the built docs cold-start budget before publishing", () => {
    const workflow = readWorkflow(
      ".github/workflows/deploy-netlify-prebuilt.yml",
    );
    const jobs = workflow.jobs as Record<string, Workflow>;
    const steps = (jobs.deploy.steps as Array<Workflow>).filter(Boolean);
    const index = steps.findIndex(
      (step) => step.name === "Verify docs cold-start budget",
    );
    assert(index >= 0);
    assert.equal(
      steps[index].if,
      "inputs.migration_only != true && inputs.artifact_download != true && steps.target.outputs.source_template == '@agent-native/docs'",
    );
    assert.match(
      String(steps[index].run),
      /NODE_ENV=production NETLIFY=true timeout 180 node scripts\/ssr-boot-smoke\.mjs packages\/docs/,
    );
    assert(index < steps.findIndex((step) => step.id === "deploy"));
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
    const previewSmoke = steps.find(
      (step) => step.name === "Smoke-test the uploaded PR preview",
    );
    const previewDatabaseMirror = steps.find(
      (step) =>
        step.name ===
        "Mirror production database variables into the PR preview context",
    );

    assert(appSmoke);
    assert.equal(
      appSmoke.if,
      "inputs.target != 'preview' && inputs.deploy && steps.beta_freshness.outputs.current != 'false' && inputs.smoke && steps.target.outputs.source_template != '@agent-native/docs' && (inputs.target != 'beta' || steps.beta_first_publish.outputs.deploy_id != '' || steps.beta_first_publish_reconcile.outputs.deploy_id != '' || (steps.previous.outputs.published_deploy_id != '' && steps.deploy.outputs.deploy_id != ''))",
    );
    // The smoke step asserts the health BODY (ready, db, schema,
    // jwks, identity), not just the status code — see scripts/smoke-check-health.ts.
    assert.match(String(appSmoke.run), /scripts\/smoke-check-health\.ts/);
    assert.match(String(appSmoke.run), /--auth-routes/);
    assert.match(String(appSmoke.run), /--canonical-host/);

    assert(previewSmoke);
    assert.equal(
      previewSmoke.if,
      "inputs.target == 'preview' && inputs.deploy && steps.beta_freshness.outputs.current != 'false' && inputs.smoke && steps.target.outputs.source_template != '@agent-native/docs'",
    );
    assert.match(String(previewSmoke.run), /scripts\/smoke-check-health\.ts/);
    assert.match(String(previewSmoke.run), /--canonical-host/);
    assert.match(String(previewSmoke.run), /--auth-routes/);
    assert.match(String(previewSmoke.run), /--preview/);
    assert.doesNotMatch(String(previewSmoke.run), /--allow-missing-health/);

    assert(previewDatabaseMirror);
    assert.equal(
      previewDatabaseMirror.if,
      "inputs.target == 'preview' && inputs.deploy && inputs.migration_only != true && steps.target.outputs.source_template != '@agent-native/docs'",
    );
    assert.match(
      String(previewDatabaseMirror.run),
      /sync-netlify-preview-database\.ts/,
    );
    assert.equal(previewDatabaseMirror.env?.NETLIFY_ACCOUNT_ID, "builder-io");
    assert.equal(
      previewDatabaseMirror.env?.NETLIFY_PREVIEW_DATABASE_URL,
      "${{ secrets[format('NETLIFY_PREVIEW_DATABASE_URL_{0}', steps.target.outputs.source_template)] }}",
    );
    assert.equal(
      previewDatabaseMirror.env?.NETLIFY_SOURCE_TEMPLATE,
      "${{ steps.target.outputs.source_template }}",
    );
    assert(
      steps.findIndex((step) => step === previewDatabaseMirror) <
        steps.findIndex((step) => step.id === "deploy"),
    );
    const previewDatabaseScript = readFileSync(
      "scripts/sync-netlify-preview-database.ts",
      "utf8",
    );
    assert.doesNotMatch(previewDatabaseScript, /productionDatabaseVariables/);
    assert.doesNotMatch(previewDatabaseScript, /candidate\.value\b/);
    assert.doesNotMatch(
      readFileSync("scripts/smoke-check-health.ts", "utf8"),
      /previewDatabaseGap/,
    );

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

  it("rejects a purge step that is not beta/production-only and success-gated", () => {
    const workflow = readWorkflow(
      ".github/workflows/deploy-netlify-prebuilt.yml",
    );
    const jobs = workflow.jobs as Record<string, Workflow>;
    const steps = (jobs.deploy.steps as Array<Workflow>).filter(Boolean);
    const purge = steps.find(
      (step) => step.name === "Purge the published Netlify cache",
    );

    assert(purge);
    assert.equal(String(purge.if), PUBLISHED_CACHE_PURGE_CONDITION);
    assert.deepEqual(
      validatePublishedCachePurgeCondition(PUBLISHED_CACHE_PURGE_CONDITION),
      [],
    );
    assert.match(
      String(purge.if),
      /steps\.beta_freshness\.outputs\.current == 'true'/,
    );
    for (const mutatedIf of [
      "inputs.target == 'production' && inputs.deploy_mode == 'production' && success()",
      "inputs.target == 'beta' && inputs.deploy && inputs.deploy_mode == 'production' && success()",
      "inputs.target == 'production' && !inputs.deploy && inputs.deploy_mode == 'production' && success()",
      "inputs.target == 'production' && inputs.deploy && inputs.deploy_mode == 'production' && !success()",
      "inputs.target == 'production' && inputs.deploy && inputs.deploy_mode == 'production' || success()",
    ]) {
      assert.notDeepEqual(validatePublishedCachePurgeCondition(mutatedIf), []);
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
