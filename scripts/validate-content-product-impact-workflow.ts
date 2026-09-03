import { readFileSync } from "node:fs";

import { parse } from "yaml";

export type ContentImpactWorkflowGuardResult = {
  ok: boolean;
  issues: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function permissionIsRead(value: unknown): boolean {
  return value === "read";
}

const ALLOWED_GITHUB_EXPRESSIONS = new Set([
  "github.event.pull_request.number",
  "github.event.pull_request.base.sha",
  "github.event.pull_request.head.repo.full_name",
  "github.event.pull_request.head.sha",
]);
const CHECKOUT_ACTION =
  "actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5";
const PNPM_ACTION =
  "pnpm/action-setup@fc06bc1257f339d1d5d8b3a19a8cae5388b55320";
const NODE_ACTION =
  "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020";
const CONTROLLER_REVISION = "03caa13fd5bf6176ee01ab223452db9932b7ca8c";
const CHECKER_COMMAND =
  "pnpm --dir controller exec tsx scripts/validate-content-product-impact.ts";
const BASE_FETCH_COMMAND =
  "git -C candidate fetch --no-tags https://github.com/BuilderIO/agent-native.git ${{ github.event.pull_request.base.sha }}";

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => key in value)
  );
}

function hasExpectedSteps(steps: Array<Record<string, unknown>>): boolean {
  if (steps.length !== 7) return false;
  const [controller, candidate, fetchBase, pnpm, node, install, checker] =
    steps;
  return (
    hasExactKeys(controller, ["name", "uses", "with"]) &&
    controller.name === "Check out immutable conformance controller" &&
    controller.uses === CHECKOUT_ACTION &&
    isRecord(controller.with) &&
    hasExactKeys(controller.with, [
      "ref",
      "path",
      "fetch-depth",
      "persist-credentials",
    ]) &&
    controller.with.ref === CONTROLLER_REVISION &&
    controller.with.path === "controller" &&
    controller.with["fetch-depth"] === 1 &&
    controller.with["persist-credentials"] === false &&
    hasExactKeys(candidate, ["name", "uses", "with"]) &&
    candidate.name === "Check out candidate as inert data" &&
    candidate.uses === CHECKOUT_ACTION &&
    isRecord(candidate.with) &&
    hasExactKeys(candidate.with, [
      "repository",
      "ref",
      "path",
      "fetch-depth",
      "persist-credentials",
    ]) &&
    candidate.with.repository ===
      "${{ github.event.pull_request.head.repo.full_name }}" &&
    candidate.with.ref === "${{ github.event.pull_request.head.sha }}" &&
    candidate.with.path === "candidate" &&
    candidate.with["fetch-depth"] === 0 &&
    candidate.with["persist-credentials"] === false &&
    hasExactKeys(fetchBase, ["name", "run"]) &&
    fetchBase.name === "Fetch exact target revision" &&
    fetchBase.run === BASE_FETCH_COMMAND &&
    hasExactKeys(pnpm, ["uses", "with"]) &&
    pnpm.uses === PNPM_ACTION &&
    isRecord(pnpm.with) &&
    hasExactKeys(pnpm.with, ["package_json_file"]) &&
    pnpm.with.package_json_file === "controller/package.json" &&
    hasExactKeys(node, ["uses", "with"]) &&
    node.uses === NODE_ACTION &&
    isRecord(node.with) &&
    hasExactKeys(node.with, [
      "node-version",
      "cache",
      "cache-dependency-path",
    ]) &&
    node.with["node-version"] === "22" &&
    node.with.cache === "pnpm" &&
    node.with["cache-dependency-path"] === "controller/pnpm-lock.yaml" &&
    hasExactKeys(install, ["run"]) &&
    install.run ===
      "pnpm --dir controller install --frozen-lockfile --ignore-scripts" &&
    hasExactKeys(checker, ["name", "env", "run"]) &&
    checker.name === "Check Content product impact" &&
    isRecord(checker.env) &&
    hasExactKeys(checker.env, [
      "CONTENT_IMPACT_REPOSITORY",
      "CONTENT_IMPACT_BASE_SHA",
      "CONTENT_IMPACT_HEAD_SHA",
    ]) &&
    checker.env.CONTENT_IMPACT_REPOSITORY === "../candidate" &&
    checker.env.CONTENT_IMPACT_BASE_SHA ===
      "${{ github.event.pull_request.base.sha }}" &&
    checker.env.CONTENT_IMPACT_HEAD_SHA ===
      "${{ github.event.pull_request.head.sha }}" &&
    checker.run === CHECKER_COMMAND
  );
}

function containsCredentialContext(value: unknown): boolean {
  if (typeof value === "string") {
    for (const match of value.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
      const expression = match[1].trim().toLowerCase();
      if (/\bsecrets\b/i.test(expression)) return true;
      if (
        /\bgithub\b/i.test(expression) &&
        !ALLOWED_GITHUB_EXPRESSIONS.has(expression)
      ) {
        return true;
      }
    }
    return false;
  }
  if (Array.isArray(value)) return value.some(containsCredentialContext);
  return (
    isRecord(value) && Object.values(value).some(containsCredentialContext)
  );
}

export function validateContentProductImpactWorkflow(
  source: string,
): ContentImpactWorkflowGuardResult {
  const issues: string[] = [];
  let workflow: unknown;
  try {
    workflow = parse(source);
  } catch {
    return { ok: false, issues: ["workflow must be valid YAML"] };
  }
  if (!isRecord(workflow)) {
    return { ok: false, issues: ["workflow must be a YAML mapping"] };
  }

  const trigger = workflow.on;
  if (!isRecord(trigger) || !isRecord(trigger.pull_request)) {
    issues.push("workflow must use pull_request");
  } else {
    const pullRequest = trigger.pull_request;
    const requiredTypes = [
      "opened",
      "synchronize",
      "reopened",
      "edited",
      "ready_for_review",
      "labeled",
      "unlabeled",
    ];
    const eventTypes = pullRequest.types;
    if (
      !Array.isArray(eventTypes) ||
      requiredTypes.some((type) => !eventTypes.includes(type))
    ) {
      issues.push(
        "pull_request must include every advisory recalibration event",
      );
    }
    if ("paths" in pullRequest || "paths-ignore" in pullRequest) {
      issues.push("workflow must not use path filters");
    }
  }
  if ("pull_request_target" in (isRecord(trigger) ? trigger : {})) {
    issues.push("workflow must not use pull_request_target");
  }

  const permissions = workflow.permissions;
  if (
    !isRecord(permissions) ||
    !permissionIsRead(permissions.contents) ||
    !permissionIsRead(permissions["pull-requests"]) ||
    Object.keys(permissions).some(
      (key) => key !== "contents" && key !== "pull-requests",
    )
  ) {
    issues.push(
      "permissions must be exactly contents: read and pull-requests: read",
    );
  }

  const jobs = workflow.jobs;
  if (!isRecord(jobs) || Object.keys(jobs).some((key) => key !== "check")) {
    issues.push("workflow must contain only the guarded check job");
  }
  const check = isRecord(jobs) ? jobs.check : undefined;
  if (!isRecord(check)) {
    issues.push("workflow must define the check job");
    return { ok: false, issues };
  }
  if ("permissions" in check) {
    issues.push(
      "check job must inherit the exact read-only workflow permissions",
    );
  }
  if (check["runs-on"] !== "ubuntu-latest") {
    issues.push("check job must use the approved GitHub-hosted runner");
  }
  if ("environment" in check || containsCredentialContext(workflow)) {
    issues.push(
      "advisory check must not receive an environment, secrets, or explicit credentials",
    );
  }
  if ("if" in check || "needs" in check) {
    issues.push("check job must run unconditionally");
  }
  if (typeof check["timeout-minutes"] !== "number") {
    issues.push("check job must have an explicit timeout");
  }
  const steps = Array.isArray(check.steps) ? check.steps.filter(isRecord) : [];
  if (!hasExpectedSteps(steps)) {
    issues.push(
      "check job steps must exactly match the pinned checkout, setup, install, and checker sequence",
    );
  }
  if (
    ("continue-on-error" in check && check["continue-on-error"] !== false) ||
    steps.some(
      (step) =>
        "continue-on-error" in step && step["continue-on-error"] !== false,
    )
  ) {
    issues.push(
      "workflow must not hide checker input or infrastructure failures",
    );
  }
  const checkoutSteps = steps.filter(
    (step) =>
      typeof step.uses === "string" &&
      step.uses.startsWith("actions/checkout@"),
  );
  const controllerCheckout = checkoutSteps[0];
  const candidateCheckout = checkoutSteps[1];
  if (checkoutSteps.length !== 2) {
    issues.push("check job must contain exactly two checkout steps");
  }
  if (
    !controllerCheckout ||
    !isRecord(controllerCheckout.with) ||
    controllerCheckout.with.ref !== CONTROLLER_REVISION
  ) {
    issues.push("controller checkout must use the immutable trusted revision");
  }
  if (!candidateCheckout || !isRecord(candidateCheckout.with)) {
    issues.push("workflow must check out the exact candidate revision");
  } else {
    if (
      candidateCheckout.with.repository !==
        "${{ github.event.pull_request.head.repo.full_name }}" ||
      candidateCheckout.with.ref !== "${{ github.event.pull_request.head.sha }}"
    ) {
      issues.push("checkout ref must be the exact pull request head SHA");
    }
    if (candidateCheckout.with["fetch-depth"] !== 0) {
      issues.push("checkout must fetch base history");
    }
  }
  if (
    checkoutSteps.some(
      (checkout) =>
        !isRecord(checkout.with) ||
        checkout.with["persist-credentials"] !== false,
    )
  ) {
    issues.push("checkout must not persist GitHub credentials");
  }
  const runStep = steps.find((step) => step.run === CHECKER_COMMAND);
  if (!runStep || !isRecord(runStep.env)) {
    issues.push("workflow must invoke the standalone impact checker");
  } else if ("if" in runStep) {
    issues.push("impact checker step must run unconditionally");
  } else if (
    runStep.env.CONTENT_IMPACT_REPOSITORY !== "../candidate" ||
    runStep.env.CONTENT_IMPACT_BASE_SHA !==
      "${{ github.event.pull_request.base.sha }}" ||
    runStep.env.CONTENT_IMPACT_HEAD_SHA !==
      "${{ github.event.pull_request.head.sha }}"
  ) {
    issues.push("checker must receive exact base and head SHAs");
  }
  if (!steps.some((step) => step.run === BASE_FETCH_COMMAND)) {
    issues.push("workflow must fetch the exact target revision from upstream");
  }

  return { ok: issues.length === 0, issues };
}

function main(): void {
  const result = validateContentProductImpactWorkflow(
    readFileSync(".github/workflows/content-product-conformance.yml", "utf8"),
  );
  if (!result.ok) {
    for (const issue of result.issues) {
      console.error(`[content-product-conformance] ${issue}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log("Content product conformance workflow boundary checks passed.");
}

if (process.argv[1]?.endsWith("validate-content-product-impact-workflow.ts")) {
  main();
}
