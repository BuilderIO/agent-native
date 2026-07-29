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
  const check = isRecord(jobs) ? jobs.check : undefined;
  if (!isRecord(check)) {
    issues.push("workflow must define the check job");
    return { ok: false, issues };
  }
  if ("environment" in check || /\bsecrets\./.test(source)) {
    issues.push("advisory check must not receive an environment or secrets");
  }
  if (typeof check["timeout-minutes"] !== "number") {
    issues.push("check job must have an explicit timeout");
  }
  const steps = Array.isArray(check.steps) ? check.steps.filter(isRecord) : [];
  const checkout = steps.find(
    (step) =>
      typeof step.uses === "string" &&
      step.uses.startsWith("actions/checkout@"),
  );
  if (!checkout || !isRecord(checkout.with)) {
    issues.push("workflow must check out the exact candidate revision");
  } else {
    if (checkout.with.ref !== "${{ github.event.pull_request.head.sha }}") {
      issues.push("checkout ref must be the exact pull request head SHA");
    }
    if (checkout.with["fetch-depth"] !== 0) {
      issues.push("checkout must fetch base history");
    }
    if (checkout.with["persist-credentials"] !== false) {
      issues.push("checkout must not persist GitHub credentials");
    }
  }
  const runStep = steps.find(
    (step) => step.run === "pnpm content-product-impact",
  );
  if (!runStep || !isRecord(runStep.env)) {
    issues.push("workflow must invoke the standalone impact checker");
  } else if (runStep["continue-on-error"] === true) {
    issues.push(
      "workflow must not hide checker input or infrastructure failures",
    );
  } else if (
    runStep.env.CONTENT_IMPACT_BASE_SHA !==
      "${{ github.event.pull_request.base.sha }}" ||
    runStep.env.CONTENT_IMPACT_HEAD_SHA !==
      "${{ github.event.pull_request.head.sha }}"
  ) {
    issues.push("checker must receive exact base and head SHAs");
  }

  return { ok: issues.length === 0, issues };
}
