import { readFileSync } from "node:fs";

import { parse } from "yaml";

const reusablePath = ".github/workflows/deploy-netlify-prebuilt.yml";
const clipsNetlifyPath = "templates/clips/netlify.toml";
const chatNetlifyPath = "templates/chat/netlify.toml";
const productionPath = ".github/workflows/deploy-production-sites-prebuilt.yml";
const betaPath = ".github/workflows/deploy-beta-sites-prebuilt.yml";
const docsProductionPath = ".github/workflows/deploy-docs-production.yml";
const manageProductionPath = ".github/workflows/manage-production-sites.yml";
const promotePath = ".github/workflows/promote-netlify-deploy.yml";

// promote /restore locks the site, and prebuilt unlock/upload is not atomic;
// all three production lanes must therefore share one per-site queue.
export const PRODUCTION_SITE_GROUP =
  "agent-native-production-site-${{ matrix.site }}";
export const PRODUCTION_PURGE_CONDITION =
  "inputs.target == 'production' && inputs.deploy && inputs.deploy_mode == 'production' && success()";

const reusable = readFileSync(reusablePath, "utf8");
const clipsNetlify = readFileSync(clipsNetlifyPath, "utf8");
const chatNetlify = readFileSync(chatNetlifyPath, "utf8");
const production = readFileSync(productionPath, "utf8");
const beta = readFileSync(betaPath, "utf8");
const docsProduction = readFileSync(docsProductionPath, "utf8");
const manageProduction = readFileSync(manageProductionPath, "utf8");
const promote = readFileSync(promotePath, "utf8");

const issues: string[] = [];
const parsedWorkflows = new Map<string, Record<string, unknown>>();

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export function validateReusableWorkflowConcurrency(
  workflow: Record<string, unknown>,
): string[] {
  const group = asRecord(workflow.concurrency)?.group;
  if (
    typeof group !== "string" ||
    !group.includes("inputs.caller") ||
    !group.includes("netlify-prebuilt-child") ||
    !group.includes("agent-native-release-migrations") ||
    !group.includes("inputs.target") ||
    !group.includes("inputs.site") ||
    !group.includes("agent-native-production-site") ||
    group.includes("github.event_name")
  ) {
    return [
      "reusable Netlify workflow must select a distinct child queue through inputs.caller",
    ];
  }
  return [];
}

export function validateProductionPurgeCondition(ifValue: unknown): string[] {
  const normalized =
    typeof ifValue === "string" ? ifValue.trim().replace(/\s+/g, " ") : "";
  if (normalized !== PRODUCTION_PURGE_CONDITION) {
    return [
      `${reusablePath} production cache purge must run only after a successful production deploy`,
    ];
  }
  return [];
}

export function validateProductionSiteConcurrency(workflows: {
  production: Record<string, unknown>;
  manage: Record<string, unknown>;
  promote: Record<string, unknown>;
}): string[] {
  const issues: string[] = [];
  const jobs = (workflow: Record<string, unknown>) => asRecord(workflow.jobs);
  const jobConcurrency = (workflow: Record<string, unknown>, jobName: string) =>
    asRecord(asRecord(jobs(workflow)?.[jobName])?.concurrency);

  for (const [path, workflow, jobName] of [
    [productionPath, workflows.production, "deploy"],
    [manageProductionPath, workflows.manage, "manage"],
    [promotePath, workflows.promote, "promote"],
  ] as const) {
    const concurrency = jobConcurrency(workflow, jobName);
    const group = concurrency?.group;
    if (group !== PRODUCTION_SITE_GROUP) {
      issues.push(
        `${path} ${jobName} job concurrency.group must equal ${PRODUCTION_SITE_GROUP}`,
      );
    }
    if (concurrency?.["cancel-in-progress"] !== false) {
      issues.push(
        `${path} ${jobName} job concurrency.cancel-in-progress must be false`,
      );
    }
  }

  return issues;
}

export function validateGoogleCallbackVerificationWorkflow(
  workflow: string,
): string[] {
  const issues: string[] = [];
  const verifyStart = workflow.indexOf(
    "name: Verify Google OAuth redirect registration",
  );
  const rollbackStart = workflow.indexOf(
    "name: Roll back after Google callback verification failure",
    verifyStart,
  );
  const failStart = workflow.indexOf(
    "name: Fail after Google callback verification",
    rollbackStart,
  );
  const verify =
    verifyStart >= 0 && rollbackStart > verifyStart
      ? workflow.slice(verifyStart, rollbackStart)
      : "";
  const rollback =
    rollbackStart >= 0 && failStart > rollbackStart
      ? workflow.slice(rollbackStart, failStart)
      : "";

  if (!verify) {
    issues.push(
      `${reusablePath} must verify Google OAuth after publishing a deploy`,
    );
  } else {
    if (
      !verify.includes(
        "node --experimental-strip-types scripts/check-google-redirect-uris.ts",
      )
    ) {
      issues.push(
        `${reusablePath} Google OAuth verification must run the probe directly with the supported Node loader`,
      );
    }
    if (verify.includes("pnpm check:google-redirect-uris")) {
      issues.push(
        `${reusablePath} Google OAuth verification must not depend on a package-script indirection`,
      );
    }
    if (verify.includes("source_template != 'macros'")) {
      issues.push(
        `${reusablePath} Google OAuth verification must use the deployed capability contract instead of a template allowlist`,
      );
    }
  }

  if (
    !rollback ||
    !rollback.includes("steps.google_redirect.outcome == 'failure'") ||
    !rollback.includes("steps.google_redirect.outputs.exit_code == '1'")
  ) {
    issues.push(
      `${reusablePath} must roll back only definitive Google OAuth mismatches (exit code 1); inconclusive checks must not roll back`,
    );
  }
  return issues;
}

export function validateNetlifyApiRateLimitHandling(
  workflow: string,
): string[] {
  const issues: string[] = [];
  if (!workflow.includes("scripts/netlify-api-request.ts")) {
    issues.push(
      `${reusablePath} Netlify API calls must use the bounded rate-limit helper`,
    );
  }
  if (workflow.includes("fetch(")) {
    issues.push(
      `${reusablePath} must not make raw Netlify fetch calls outside the rate-limit helper`,
    );
  }
  return issues;
}

try {
  for (const [path, source] of [
    [reusablePath, reusable],
    [productionPath, production],
    [betaPath, beta],
    [docsProductionPath, docsProduction],
    [manageProductionPath, manageProduction],
    [promotePath, promote],
  ] as const) {
    const document = asRecord(parse(source));
    if (!document) {
      throw new Error(`${path} must contain a YAML mapping at the root`);
    }
    parsedWorkflows.set(path, document);
  }
  if (!reusable.includes("workflow_call:")) {
    issues.push(`${reusablePath} must remain a reusable workflow`);
  }
} catch (error) {
  issues.push(
    `Netlify prebuilt workflows must be valid YAML: ${String(error)}`,
  );
}

const reusableDocument = parsedWorkflows.get(reusablePath);
issues.push(...validateReusableWorkflowConcurrency(reusableDocument ?? {}));

if (asRecord(reusableDocument?.concurrency)?.["cancel-in-progress"] !== false) {
  issues.push(`${reusablePath} beta deploys must queue every source SHA`);
}
const betaWorkflowConcurrency = asRecord(
  parsedWorkflows.get(betaPath)?.concurrency,
);
if (betaWorkflowConcurrency) {
  issues.push(
    `${betaPath} must not use a workflow-level queue that can evict a pending main push`,
  );
}
const reusableConcurrencyGroup = String(
  asRecord(reusableDocument?.concurrency)?.group ?? "",
);
if (
  !reusableConcurrencyGroup.includes(
    "format('netlify-prebuilt-beta-{0}', inputs.site)",
  )
) {
  issues.push(
    `${reusablePath} beta publishes must share one non-canceling remote queue per site`,
  );
}

const productionConcurrency = asRecord(
  parsedWorkflows.get(productionPath)?.concurrency,
);
if (
  typeof productionConcurrency?.group !== "string" ||
  !productionConcurrency.group.includes("agent-native-production-fleet")
) {
  issues.push(
    `${productionPath} must keep fleet runs in a dedicated production queue`,
  );
}
const docsProductionDocument = parsedWorkflows.get(docsProductionPath);
const docsProductionConcurrency = asRecord(docsProductionDocument?.concurrency);
if (
  docsProductionConcurrency?.group !== "agent-native-docs-production" ||
  docsProductionConcurrency["cancel-in-progress"] !== false
) {
  issues.push(
    `${docsProductionPath} must keep its path-filtered production queue independent`,
  );
}
const docsProductionJobs = asRecord(docsProductionDocument?.jobs);
for (const jobName of ["pause-netlify-builds", "restore-netlify-builds"]) {
  const concurrency = asRecord(
    asRecord(docsProductionJobs?.[jobName])?.concurrency,
  );
  if (
    concurrency?.group !== "agent-native-production-site-fw" ||
    concurrency?.["cancel-in-progress"] !== false
  ) {
    issues.push(
      `${docsProductionPath} ${jobName} must share the fw production site queue without cancellation`,
    );
  }
}
const docsPauseJob = asRecord(docsProductionJobs?.["pause-netlify-builds"]);
const docsRestoreJob = asRecord(docsProductionJobs?.["restore-netlify-builds"]);
if (
  !asRecord(docsPauseJob?.outputs)?.cutover_acquired ||
  !asRecord(docsPauseJob?.outputs)?.was_stopped ||
  typeof docsRestoreJob?.if !== "string" ||
  !docsRestoreJob.if.includes("always()") ||
  !String(docsRestoreJob.needs).includes("pause-netlify-builds") ||
  !docsProduction.includes("stop_builds: false") ||
  !docsProduction.includes(
    "needs.pause-netlify-builds.outputs.cutover_acquired",
  )
) {
  issues.push(
    `${docsProductionPath} must restore the prior Git-connected build setting after every pause attempt`,
  );
}

const buildStepStart = reusable.indexOf(
  "name: Build with the Netlify project configuration",
);
const buildStepEnd = reusable.indexOf(
  "name: Verify deploy directories",
  buildStepStart,
);
const clipsBuild =
  buildStepStart >= 0 && buildStepEnd > buildStepStart
    ? reusable.slice(buildStepStart, buildStepEnd)
    : "";
const hasProductionChatBuildOverride =
  clipsBuild.includes(
    'if [[ "$TARGET" == "production" && "$SOURCE_TEMPLATE" == "chat" ]];',
  ) &&
  chatNetlify.includes("agentNativePrebuiltBuild") &&
  chatNetlify.includes("agentNativePrebuiltDatabaseUrl") &&
  chatNetlify.includes("agentNativePrebuiltAuthSecret");
if (!hasProductionChatBuildOverride) {
  issues.push(
    `${reusablePath} and ${chatNetlifyPath} must provide a production Chat build-only override for masked Netlify secrets`,
  );
}
const hasClipsAndPlanBuildOverride = clipsBuild.includes(
  '[[ "$SOURCE_TEMPLATE" == "clips" || "$SOURCE_TEMPLATE" == "plan" ]]',
);
if (
  !hasClipsAndPlanBuildOverride ||
  !clipsBuild.includes("agentNativePrebuiltBuild=true") ||
  !clipsBuild.includes("agentNativePrebuiltDatabaseUrl=") ||
  !clipsBuild.includes("agentNativePrebuiltAuthSecret=") ||
  !clipsNetlify.includes("agentNativePrebuiltBuild") ||
  !clipsNetlify.includes("agentNativePrebuiltDatabaseUrl") ||
  !clipsNetlify.includes("agentNativePrebuiltAuthSecret") ||
  !/agentNativePrebuiltBuild:-\}.*!= \\"true\\".*migrate:production/.test(
    clipsNetlify,
  )
) {
  issues.push(
    `${reusablePath} must provide Clips and Plan build-only env overrides without running production migrations`,
  );
}
const manageConcurrency = asRecord(
  parsedWorkflows.get(manageProductionPath)?.concurrency,
);
if (
  typeof manageConcurrency?.group !== "string" ||
  !manageConcurrency.group.includes("agent-native-production-manager")
) {
  issues.push(
    `${manageProductionPath} must use a manager-specific production queue`,
  );
}
const promoteConcurrency = asRecord(
  parsedWorkflows.get(promotePath)?.concurrency,
);
if (
  typeof promoteConcurrency?.group !== "string" ||
  !promoteConcurrency.group.includes("agent-native-production-promote")
) {
  issues.push(`${promotePath} must use a promotion-specific production queue`);
}
issues.push(
  ...validateProductionSiteConcurrency({
    production: parsedWorkflows.get(productionPath) ?? {},
    manage: parsedWorkflows.get(manageProductionPath) ?? {},
    promote: parsedWorkflows.get(promotePath) ?? {},
  }),
);

const reusableOn = asRecord(reusableDocument?.on);
const workflowCall = asRecord(reusableOn?.workflow_call);
const workflowCallInputs = asRecord(workflowCall?.inputs);
for (const input of [
  "target",
  "site",
  "build_context",
  "deploy",
  "deploy_mode",
  "smoke",
  "caller",
  "migration_only",
  "skip_build_migrations",
]) {
  if (!asRecord(workflowCallInputs?.[input])) {
    issues.push(`${reusablePath} workflow_call must define the ${input} input`);
  }
}

const reusableDeployJob = asRecord(asRecord(reusableDocument?.jobs)?.deploy);
const reusableSteps = Array.isArray(reusableDeployJob?.steps)
  ? reusableDeployJob.steps.map(asRecord)
  : [];
const parsedStepIndex = (name: string) =>
  reusableSteps.findIndex((step) => step?.name === name);
const parsedPauseIndex = parsedStepIndex(
  "Pause automatic Netlify builds for production cutover",
);
const parsedClipsMigrationIndex = parsedStepIndex(
  "Run Clips release migrations",
);
const parsedUnlockIndex = parsedStepIndex(
  "Unlock the published production deploy",
);
const parsedUploadIndex = parsedStepIndex("Upload the prebuilt deploy");
const parsedPublishWaitIndex = parsedStepIndex(
  "Wait for the Netlify deploy to publish",
);
const parsedPurgeIndex = parsedStepIndex("Purge the production Netlify cache");
const parsedLockIndex = parsedStepIndex("Lock the published production deploy");
const parsedResumeIndex = parsedStepIndex(
  "Resume automatic Netlify builds after production cutover",
);
const parsedCleanupIndex = parsedStepIndex(
  "Restore the production deploy lock after a failed cutover",
);
issues.push(...validateGoogleCallbackVerificationWorkflow(reusable));
issues.push(...validateNetlifyApiRateLimitHandling(reusable));
const parsedClipsMigrationIf = reusableSteps[parsedClipsMigrationIndex]?.if;
if (
  parsedClipsMigrationIndex < 0 ||
  typeof parsedClipsMigrationIf !== "string" ||
  !parsedClipsMigrationIf.includes("inputs.target == 'production'") ||
  !parsedClipsMigrationIf.includes("inputs.deploy") ||
  !parsedClipsMigrationIf.includes("inputs.deploy_mode == 'production'") ||
  !parsedClipsMigrationIf.includes("source_template == 'clips'") ||
  !reusable.includes("CLIPS_DATABASE_URL")
) {
  issues.push(
    `${reusablePath} must run Clips release migrations against CLIPS_DATABASE_URL before a production prebuilt deploy`,
  );
}
if (
  parsedPauseIndex < 0 ||
  parsedUnlockIndex < 0 ||
  parsedUploadIndex < 0 ||
  parsedPublishWaitIndex < 0 ||
  parsedPurgeIndex < 0 ||
  parsedLockIndex < 0 ||
  parsedResumeIndex < 0 ||
  parsedCleanupIndex < 0
) {
  issues.push(
    `${reusablePath} must define pause, unlock, upload, publish-wait, lock, resume, and failure-cleanup steps in parsed YAML`,
  );
} else if (
  parsedPauseIndex >= parsedUnlockIndex ||
  parsedUnlockIndex >= parsedUploadIndex ||
  parsedUploadIndex >= parsedPublishWaitIndex ||
  parsedPublishWaitIndex >= parsedPurgeIndex ||
  parsedPurgeIndex >= parsedLockIndex ||
  parsedLockIndex >= parsedResumeIndex ||
  parsedResumeIndex >= parsedCleanupIndex
) {
  issues.push(
    `${reusablePath} parsed YAML steps must order unlock before upload before publish-wait before purge before lock before resume before cleanup`,
  );
}
const parsedUnlockIf = reusableSteps[parsedUnlockIndex]?.if;
if (
  typeof parsedUnlockIf !== "string" ||
  !parsedUnlockIf.includes("inputs.target == 'production'") ||
  !parsedUnlockIf.includes("inputs.deploy") ||
  !parsedUnlockIf.includes("inputs.deploy_mode == 'production'")
) {
  issues.push(
    `${reusablePath} must restrict the production unlock step to production uploads`,
  );
}
const parsedResumeIf = reusableSteps[parsedResumeIndex]?.if;
if (
  typeof parsedResumeIf !== "string" ||
  !parsedResumeIf.includes("inputs.target == 'production'") ||
  !parsedResumeIf.includes("inputs.deploy") ||
  !parsedResumeIf.includes("inputs.deploy_mode == 'production'") ||
  !parsedResumeIf.includes("always()")
) {
  issues.push(
    `${reusablePath} must always attempt automatic-build restoration after a production cutover`,
  );
}
issues.push(
  ...validateProductionPurgeCondition(reusableSteps[parsedPurgeIndex]?.if),
);

const uploadStart = reusable.indexOf("name: Upload the prebuilt deploy");
const uploadEnd = reusable.indexOf(
  "name: Wait for the Netlify deploy to publish",
  uploadStart,
);
const purgeStart = reusable.indexOf("name: Purge the production Netlify cache");
const purgeEnd = reusable.indexOf(
  "name: Lock the published production deploy",
  purgeStart,
);
const unlockStart = reusable.indexOf(
  "name: Unlock the published production deploy",
);
if (unlockStart < 0 || (uploadStart >= 0 && unlockStart >= uploadStart)) {
  issues.push(
    `${reusablePath} must unlock the published deploy before a production upload`,
  );
} else {
  const unlock = reusable.slice(unlockStart, uploadStart);
  if (
    !unlock.includes("/unlock") ||
    !unlock.includes("locked !== false") ||
    !unlock.includes("/deploys?per_page=100&production=true&state=") ||
    !unlock.includes("nextPageUrl") ||
    !unlock.includes("ACTIVE_PRODUCTION_DEPLOY_STATES") ||
    !unlock.includes('"pending"') ||
    !unlock.includes('"uploaded"') ||
    !unlock.includes('"prepared"') ||
    !unlock.includes('"processed"') ||
    !unlock.includes('"pending_review"') ||
    !unlock.includes('"accepted"') ||
    !unlock.includes('"retrying"') ||
    !unlock.includes("encodeURIComponent(state)") ||
    !unlock.includes("production=true") ||
    !unlock.includes("Promise.all(states.map") ||
    !unlock.includes(
      '["error", "canceled", "rejected"].includes(candidate.state)',
    ) ||
    !unlock.includes("const preexistingDeployIds = new Set") ||
    !unlock.includes("preexistingDeployIds.has(candidate.id)") ||
    !unlock.includes('candidate.state !== "ready"') ||
    (
      unlock.match(/drainPendingDeploys\(deployId, preexistingDeployIds\)/g) ??
      []
    ).length < 2 ||
    !unlock.includes("candidate.published_at") ||
    !unlock.includes("Netlify pre-existing production ready deploy lookup") ||
    !unlock.includes('["ready"]') ||
    !unlock.includes("finalBeforeUnlock") ||
    (
      unlock.match(
        /pendingProductionDeploys\([\s\S]*?publishedId,\s*preexistingDeployIds/g,
      ) ?? []
    ).length < 2
  ) {
    issues.push(
      `${reusablePath} production unlock must ignore pre-existing ready deploys and block ready deploys created during this run`,
    );
  }
  const baselineIndex = unlock.indexOf("const preexistingDeployIds = new Set");
  const siteLookupIndex = unlock.indexOf("const site = await readJson(");
  if (
    baselineIndex < 0 ||
    siteLookupIndex < 0 ||
    baselineIndex > siteLookupIndex
  ) {
    issues.push(
      `${reusablePath} must capture the ready production baseline before reading site/deploy state`,
    );
  }
}
if (purgeStart < 0 || purgeEnd <= purgeStart) {
  issues.push(
    `${reusablePath} must purge the production cache before locking the published deploy`,
  );
} else {
  const purge = reusable.slice(purgeStart, purgeEnd);
  if (
    !purge.includes('const api = "https://api.netlify.com/api/v1"') ||
    !purge.includes("requestNetlifyApi(`${api}/purge`") ||
    !purge.includes('method: "POST"') ||
    !purge.includes(
      "JSON.stringify({ site_id: process.env.NETLIFY_SITE_ID })",
    ) ||
    !purge.includes("response.ok")
  ) {
    issues.push(
      `${reusablePath} production cache purge must POST the site_id to Netlify and fail on a non-success response`,
    );
  }
}
const lockStart = reusable.indexOf(
  "name: Lock the published production deploy",
);
const pauseStart = reusable.indexOf(
  "name: Pause automatic Netlify builds for production cutover",
);
const cleanupStart = reusable.indexOf(
  "name: Restore the production deploy lock after a failed cutover",
);
if (
  pauseStart < 0 ||
  lockStart < 0 ||
  cleanupStart < 0 ||
  pauseStart >= unlockStart ||
  lockStart >= cleanupStart ||
  !reusable.slice(lockStart, cleanupStart).includes("/lock") ||
  !reusable.slice(lockStart, cleanupStart).includes("published_deploy") ||
  !reusable.slice(cleanupStart).includes("failure()") ||
  !reusable.slice(cleanupStart).includes("cutoverPublishedDeployId") ||
  !reusable.slice(cleanupStart).includes("cutoverNewDeployId") ||
  !reusable.slice(cleanupStart).includes("cutoverWasLocked") ||
  !reusable.slice(cleanupStart).includes("/lock") ||
  !reusable.slice(cleanupStart).includes("currentDeployId === newDeployId") ||
  !reusable.slice(cleanupStart).includes("newly published deploy")
) {
  issues.push(
    `${reusablePath} must pause automatic builds before cutover, lock the new published deploy, and fail-safe the production lock after cutover errors`,
  );
}
const pause = reusable.slice(pauseStart, unlockStart);
const cutoverAcquiredIndex = pause.indexOf("cutover_acquired=true");
const pauseVerificationIndex = pause.indexOf("await waitForBuildSetting");
if (
  !pause.includes("stop_builds") ||
  !pause.includes('method: "PATCH"') ||
  !pause.includes("was_stopped") ||
  cutoverAcquiredIndex < 0 ||
  pauseVerificationIndex <= cutoverAcquiredIndex
) {
  issues.push(
    `${reusablePath} production cutovers must record acquisition before fallible pause verification and preserve the prior stop_builds setting`,
  );
}
const cleanup = reusable.slice(cleanupStart);
if (!cleanup.includes("cutoverWasPaused") || cleanup.includes("stop_builds")) {
  issues.push(
    `${reusablePath} production cleanup must restore the prior automatic-build setting`,
  );
}
if (!cleanup.includes("!process.env.cutoverPublishedDeployId")) {
  issues.push(
    `${reusablePath} production cleanup must leave lock state unchanged without a recorded unlock state`,
  );
}
const resumeStart = reusable.indexOf(
  "name: Resume automatic Netlify builds after production cutover",
);
const noCutoverStateCheck = 'process.env.cutoverWasPaused !== "true"';
if (
  resumeStart < 0 ||
  !reusable.slice(resumeStart, cleanupStart).includes(noCutoverStateCheck)
) {
  issues.push(
    `${reusablePath} production resume must leave automatic builds unchanged when pause state was not acquired`,
  );
}
if (
  !cleanup.includes(noCutoverStateCheck) ||
  !cleanup.includes("!process.env.cutoverPublishedDeployId")
) {
  issues.push(
    `${reusablePath} production cleanup must leave lock state unchanged without a recorded unlock state`,
  );
}
if (uploadStart < 0 || uploadEnd <= uploadStart) {
  issues.push(
    `${reusablePath} must retain an ordered prebuilt upload step and publish-wait step`,
  );
} else {
  const upload = reusable.slice(uploadStart, uploadEnd);
  if (
    !/\bnetlify\s+deploy\b/.test(upload) ||
    !/(^|\s)--no-build(?:\s|$)/m.test(upload)
  ) {
    issues.push(
      `${reusablePath} upload step must invoke netlify deploy with --no-build`,
    );
  }
  if (/--context(?:\s|=|\)|$)/m.test(upload)) {
    issues.push(
      "prebuilt uploads must not pass --context with --no-build; the Netlify CLI rejects that combination",
    );
  }
}

for (const [path, target, buildContext] of [
  [productionPath, "production", "production"],
  [betaPath, "beta", "branch-deploy"],
] as const) {
  const document = parsedWorkflows.get(path);
  const deployJob = asRecord(asRecord(document?.jobs)?.deploy);
  const deployWith = asRecord(deployJob?.with);
  if (deployJob?.uses !== "./.github/workflows/deploy-netlify-prebuilt.yml") {
    issues.push(`${path} deploy job must call the reusable Netlify workflow`);
  }
  if (deployWith?.target !== target) {
    issues.push(`${path} deploy job must pass target=${target}`);
  }
  if (deployWith?.build_context !== buildContext) {
    issues.push(`${path} deploy job must pass build_context=${buildContext}`);
  }
  const expectedCaller =
    path === betaPath
      ? "${{ github.event_name == 'workflow_dispatch' && inputs.migrated_source_sha != '' && 'recovery' || 'fleet' }}"
      : "fleet";
  if (deployWith?.caller !== expectedCaller) {
    issues.push(
      `${path} deploy job must explicitly select the reusable workflow child queue`,
    );
  }
  if (
    path === betaPath &&
    asRecord(deployJob?.strategy)?.["max-parallel"] !== 8
  ) {
    issues.push(`${path} must allow beta artifact builds to run concurrently`);
  }
}

const betaMigrateJob = asRecord(
  asRecord(parsedWorkflows.get(betaPath)?.jobs)?.migrate,
);
const betaDeployJob = asRecord(
  asRecord(parsedWorkflows.get(betaPath)?.jobs)?.deploy,
);
const betaSchemaGateJob = asRecord(
  asRecord(parsedWorkflows.get(betaPath)?.jobs)?.["schema-gate"],
);
const betaSchemaGateStep = (
  (betaSchemaGateJob?.steps as Array<Record<string, unknown>> | undefined) ?? []
).find(
  (step) =>
    step.name ===
    "Detect schema-dependent beta code without production migration",
);
const betaSchemaGateBlockStep = (
  (betaSchemaGateJob?.steps as Array<Record<string, unknown>> | undefined) ?? []
).find(
  (step) =>
    step.name === "Block schema-dependent beta code until production migration",
);
const betaMigrationMarkerStep = (
  (betaSchemaGateJob?.steps as Array<Record<string, unknown>> | undefined) ?? []
).find((step) => step.name === "Record pending beta migration marker");
const betaSchemaGateCheckoutStep = (
  (betaSchemaGateJob?.steps as Array<Record<string, unknown>> | undefined) ?? []
).find(
  (step) =>
    typeof step.uses === "string" && step.uses.startsWith("actions/checkout@"),
);
const betaDeployNeeds = Array.isArray(betaDeployJob?.needs)
  ? betaDeployJob.needs
  : [];
const productionMigrationMarkerJob = asRecord(
  asRecord(parsedWorkflows.get(productionPath)?.jobs)?.[
    "record-beta-migration"
  ],
);
const productionMigrationMarkerSteps =
  (productionMigrationMarkerJob?.steps as
    | Array<Record<string, unknown>>
    | undefined) ?? [];
if (betaMigrateJob || betaDeployNeeds.includes("migrate")) {
  issues.push(
    `${betaPath} must not run release migrations against masked beta site secrets`,
  );
}
if (
  asRecord(parsedWorkflows.get(betaPath)?.permissions)?.contents !== "write"
) {
  issues.push(`${betaPath} must write immutable migration markers`);
}
if (
  betaSchemaGateJob?.needs !== "resolve-source" ||
  typeof betaSchemaGateStep?.run !== "string" ||
  !betaSchemaGateStep.run.includes("migrated_source_sha") ||
  !betaSchemaGateStep.run.includes("base_sha_input") ||
  asRecord(betaSchemaGateStep.env)?.base_sha_input !==
    "${{ github.event.before }}" ||
  !betaSchemaGateStep.run.includes("git hash-object -t tree /dev/null") ||
  !betaSchemaGateStep.run.includes("git diff --name-only") ||
  !betaSchemaGateStep.run.includes(
    "git tag --list 'agent-native-beta-pending/*'",
  ) ||
  !betaSchemaGateStep.run.includes("agent-native-beta-migrated/*") ||
  !betaSchemaGateStep.run.includes("unresolved_pending_sha") ||
  !betaSchemaGateStep.run.includes("required_source_sha") ||
  !betaSchemaGateStep.run.includes("schema_files") ||
  asRecord(betaSchemaGateCheckoutStep?.with)?.["fetch-depth"] !== 0 ||
  typeof betaSchemaGateBlockStep?.run !== "string" ||
  !betaSchemaGateBlockStep.run.includes("required_source_sha") ||
  typeof betaMigrationMarkerStep?.with !== "object" ||
  !String(betaSchemaGateStep.run).includes(
    "No production-owned migration marker exists",
  ) ||
  !String(betaMigrationMarkerStep.if).includes("record_pending") ||
  !String(asRecord(betaMigrationMarkerStep.with)?.script).includes(
    "Concurrent beta pending marker",
  ) ||
  !String(asRecord(betaMigrationMarkerStep.with)?.script).includes(
    "createRef",
  ) ||
  !betaDeployNeeds.includes("schema-gate")
) {
  issues.push(
    `${betaPath} must block schema-dependent beta code until production migration is confirmed`,
  );
}

if (
  !productionMigrationMarkerJob ||
  !String(productionMigrationMarkerJob.if).includes("inputs.sites == 'all'") ||
  !String(productionMigrationMarkerJob.if).includes(
    "needs.deploy.result == 'success'",
  ) ||
  !Array.isArray(productionMigrationMarkerJob.needs) ||
  !productionMigrationMarkerJob.needs.includes("resolve-source") ||
  !productionMigrationMarkerJob.needs.includes("deploy") ||
  asRecord(productionMigrationMarkerJob.permissions)?.contents !== "write" ||
  !productionMigrationMarkerSteps.some(
    (step) =>
      typeof step.with === "object" &&
      String(asRecord(step.with)?.script).includes(
        "agent-native-beta-migrated",
      ) &&
      String(asRecord(step.with)?.script).includes(
        "Concurrent production migration marker",
      ) &&
      String(asRecord(step.with)?.script).includes("createRef"),
  )
) {
  issues.push(
    `${productionPath} must create the beta migration marker only after a successful all-sites cutover`,
  );
}

if (issues.length) {
  for (const issue of issues) console.error(`::error::${issue}`);
  process.exit(1);
}

console.log(
  "Netlify prebuilt workflows preserve context and publish serialization.",
);
