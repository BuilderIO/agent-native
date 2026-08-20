import { readFileSync } from "node:fs";

import { parse } from "yaml";

const reusablePath = ".github/workflows/deploy-netlify-prebuilt.yml";
const clipsNetlifyPath = "templates/clips/netlify.toml";
const productionPath = ".github/workflows/deploy-production-sites-prebuilt.yml";
const betaPath = ".github/workflows/deploy-beta-sites-prebuilt.yml";
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
const production = readFileSync(productionPath, "utf8");
const beta = readFileSync(betaPath, "utf8");
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

try {
  for (const [path, source] of [
    [reusablePath, reusable],
    [productionPath, production],
    [betaPath, beta],
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
if (
  !clipsBuild.includes('[[ "$SOURCE_TEMPLATE" == "clips" ]]') ||
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
    `${reusablePath} must provide Clips build-only env overrides without running production migrations`,
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
    !unlock.includes("candidate.state !== \"ready\"") ||
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
    !purge.includes("fetch(`${api}/purge`") ||
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
const pauseVerificationIndex = pause.indexOf("const paused =");
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
  if (deployWith?.caller !== "fleet") {
    issues.push(
      `${path} deploy job must explicitly select the reusable workflow child queue`,
    );
  }
}

if (issues.length) {
  for (const issue of issues) console.error(`::error::${issue}`);
  process.exit(1);
}

console.log(
  "Netlify prebuilt workflows preserve context and publish serialization.",
);
