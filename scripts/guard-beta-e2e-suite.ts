import { readFileSync } from "node:fs";

import { parse } from "yaml";

/**
 * Keep the beta E2E suite honest about the two things it cannot check itself.
 *
 * 1. It must only ever point at beta hosts. Pointed at production it would
 *    sign in as a real identity, spend tokens, and write to live data — and the
 *    run would still report green, which is the worst possible outcome.
 * 2. It must stay budgeted on luna. The model id lives in one helper; a change
 *    there silently multiplies the cost of every run, and nothing else in CI
 *    would notice.
 *
 * Also checks the fleet list is not duplicated: the suite reads
 * `scripts/netlify-beta-sites.json`, so a newly deployed beta site is covered
 * automatically. A second hardcoded host list would quietly stop being updated.
 */

const workflowPath = ".github/workflows/beta-e2e.yml";
const scheduledWorkflowPath = ".github/workflows/beta-e2e-scheduled.yml";
const fleetPath = "e2e/beta/lib/fleet.ts";
const chatPath = "e2e/beta/lib/chat.ts";
const sitesPath = "scripts/netlify-beta-sites.json";
const configPath = "e2e/beta/playwright.config.ts";
const globalSetupPath = "e2e/beta/global-setup.ts";

const issues: string[] = [];

function read(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    issues.push(
      `${path} could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
    return "";
  }
}

const workflow = read(workflowPath);
const scheduledWorkflow = read(scheduledWorkflowPath);
const fleet = read(fleetPath);
const chat = read(chatPath);
const config = read(configPath);
const globalSetup = read(globalSetupPath);
const sitesRaw = read(sitesPath);

// 1. The fleet is derived, not duplicated.
if (fleet && !fleet.includes("netlify-beta-sites.json")) {
  issues.push(
    `${fleetPath} no longer reads ${sitesPath}. The suite must derive its host list from the deploy list so a new beta site is covered without a second edit.`,
  );
}

// 2. Non-beta hosts are refused at the boundary.
if (fleet && !fleet.includes('startsWith("beta.")')) {
  issues.push(
    `${fleetPath} dropped its beta-host check. Without it this suite can be pointed at production, where it would sign in as a real user and write to live data.`,
  );
}

// 3. Every host in the deploy list really is a beta host.
if (sitesRaw) {
  try {
    const sites = JSON.parse(sitesRaw) as { id?: string; host?: string }[];
    const nonBeta = sites.filter((site) => !site.host?.startsWith("beta."));
    if (nonBeta.length > 0) {
      issues.push(
        `${sitesPath} lists non-beta host(s): ${nonBeta.map((site) => site.host).join(", ")}. The beta E2E suite reads this file and would target them.`,
      );
    }
  } catch (error) {
    issues.push(
      `${sitesPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// 4. The budget model stays luna.
if (chat) {
  const lunaIds = [...chat.matchAll(/gpt-5[.-]6-luna/g)];
  if (lunaIds.length === 0) {
    issues.push(
      `${chatPath} no longer names a luna model id. This suite is budgeted for luna; changing the model changes what every run costs.`,
    );
  }
  if (!chat.includes("assertOnlyLuna")) {
    issues.push(
      `${chatPath} dropped assertOnlyLuna. Seeding a model without reading it back off the wire means a run can silently bill a different model.`,
    );
  }
}

// 5. The shared OpenAI key stays opt-in.
if (workflow && !workflow.includes("inputs.key_source == 'shared'")) {
  issues.push(
    `${workflowPath} no longer gates BETA_E2E_ALLOW_SHARED_KEY on an explicit dispatch choice. Billing the repository's shared OPENAI_API_KEY implicitly is precisely what a dedicated, separately-limited key exists to prevent.`,
  );
}
if (
  workflow &&
  !workflow.includes(
    "BETA_E2E_SHARED_OPENAI_API_KEY: ${{ inputs.key_source == 'shared' && secrets.OPENAI_API_KEY || '' }}",
  )
) {
  issues.push(
    `${workflowPath} exposes the shared OpenAI secret outside an explicit key_source=shared dispatch. Dedicated runs must not receive that credential.`,
  );
}
const providerKeyPath = "e2e/beta/lib/provider-key.ts";
const providerKey = read(providerKeyPath);
if (providerKey && !providerKey.includes("BETA_E2E_ALLOW_SHARED_KEY")) {
  issues.push(
    `${providerKeyPath} no longer requires an explicit opt-in before using the shared OpenAI key.`,
  );
}
if (
  providerKey &&
  providerKey.indexOf("const dedicated =") <
    providerKey.indexOf("if (allowShared)")
) {
  issues.push(
    `${providerKeyPath} resolves the dedicated key before the explicitly selected shared key. The selected source must win or a run can bill the wrong credential.`,
  );
}

// 6. Missing credentials must fail, never skip.
if (globalSetup && !/throw new Error/.test(globalSetup)) {
  issues.push(
    `${globalSetupPath} no longer throws. An authenticated run that degrades to an anonymous one reports green while testing nothing.`,
  );
}

/** Drop comments so prose explaining a rule cannot trip the rule. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

// 7. Certificate errors stay observable.
if (config && /ignoreHTTPSErrors/.test(stripComments(config))) {
  issues.push(
    `${configPath} sets ignoreHTTPSErrors. "The connection isn't private" was a real beta report; only a browser that still validates certificates can catch it.`,
  );
}

// 8. The promotion workflow stays a manual gate and keeps the lanes
// separated. workflow_call is the narrow reusable entrypoint used by the
// scheduled wrapper; it is not a push or pull-request trigger.
if (workflow) {
  try {
    const parsed = parse(workflow) as Record<string, unknown>;
    const on = parsed.on as Record<string, unknown> | undefined;
    if (!on || !("workflow_dispatch" in on)) {
      issues.push(
        `${workflowPath} must offer workflow_dispatch — it is the manual promotion gate.`,
      );
    }
    // `workflow_call` is allowed: a caller still has to be started by a
    // person. What must never appear is a trigger that fires on its own.
    const automaticTriggers = Object.keys(on ?? {}).filter(
      (key) => key !== "workflow_dispatch" && key !== "workflow_call",
    );
    if (automaticTriggers.length > 0) {
      issues.push(
        `${workflowPath} added automatic trigger(s): ${automaticTriggers.join(", ")}. This suite spends model tokens and runs against hosts sharing production data, so it stays manual until that changes deliberately.`,
      );
    }
  } catch (error) {
    issues.push(
      `${workflowPath} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!workflow.includes("--project=fleet")) {
    issues.push(
      `${workflowPath} no longer runs the fleet lane. The public lane is sharded one host per runner, so cross-host checks only mean something in a run that sees every host.`,
    );
  }
  if (
    !workflow.includes('pnpm e2e:beta --project=fleet --grep "$BETA_E2E_GREP"')
  ) {
    issues.push(
      `${workflowPath} no longer passes BETA_E2E_GREP through the fleet lane. Filtered dispatches must not run the full cross-host suite.`,
    );
  }
  if (!workflow.includes("--project=advisory")) {
    issues.push(
      `${workflowPath} no longer runs the advisory lane. Non-blocking findings that stop being reported stop being fixed.`,
    );
  }
  if (
    !workflow.includes(
      'pnpm e2e:beta --project=advisory --grep "$BETA_E2E_GREP"',
    )
  ) {
    issues.push(
      `${workflowPath} no longer passes BETA_E2E_GREP through the advisory lane. Filtered dispatches must not run the full advisory suite.`,
    );
  }
  if (!/continue-on-error:\s*true/.test(workflow)) {
    issues.push(
      `${workflowPath} no longer marks the advisory lane non-gating. Gating on advisory findings trains people to ignore a red run.`,
    );
  }
  // The preamble lives in a composite action shared by every lane, so look
  // there as well as in the workflow itself.
  const setupPath = ".github/actions/beta-e2e-setup/action.yml";
  const setup = read(setupPath);
  if (
    !workflow.includes("pnpm typecheck:e2e") &&
    !setup.includes("pnpm typecheck:e2e")
  ) {
    issues.push(
      `Neither ${workflowPath} nor ${setupPath} runs typecheck:e2e. e2e/ is outside the workspace typecheck sweep, so a type error would only surface after tokens were spent.`,
    );
  }

  // Sharding is what makes this gate usable; losing it silently returns the
  // sweep to ~28 minutes on one runner.
  if (!workflow.includes("fromJSON(needs.discover.outputs.matrix)")) {
    issues.push(
      `${workflowPath} no longer shards the public lane across runners. A page load against a beta host costs 20-40s from a GitHub runner, so one runner for the whole fleet is a ~28 minute gate nobody waits for.`,
    );
  }
  if (
    !workflow.includes("apps = [...new Set(known)]") ||
    !workflow.includes("...new Set(\n                raw")
  ) {
    issues.push(
      `${workflowPath} no longer deduplicates app IDs before emitting the shard matrix. Duplicate IDs would launch jobs with colliding artifact names.`,
    );
  }
}

// 9. An unrequested pre-flight must never hold up a deploy.
const prodDeployPath = ".github/workflows/deploy-production-sites-prebuilt.yml";
const prodDeploy = read(prodDeployPath);
if (prodDeploy && prodDeploy.includes("beta-e2e")) {
  type ProdDeploy = {
    on?: {
      workflow_dispatch?: {
        inputs?: Record<string, { default?: unknown }>;
      };
    };
    jobs?: Record<string, { needs?: unknown; if?: unknown }>;
  };

  let parsedDeploy: ProdDeploy | null = null;
  try {
    parsedDeploy = parse(prodDeploy) as ProdDeploy;
  } catch (error) {
    // Not skipped quietly: a workflow this guard cannot read is one it cannot
    // vouch for, and "unreadable" must not look like "fine".
    issues.push(
      `${prodDeployPath} is not valid YAML, so the deploy gate could not be checked: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const gateInput = parsedDeploy?.on?.workflow_dispatch?.inputs?.beta_e2e;
  if (!gateInput) {
    issues.push(
      `${prodDeployPath} wires the beta E2E gate but exposes no beta_e2e input, so it cannot be opted into.`,
    );
  } else if (gateInput.default !== false) {
    issues.push(
      `${prodDeployPath} defaults beta_e2e to ${JSON.stringify(gateInput.default)}. It must default to false — a deploy should never be gated on this suite unless someone asked for it.`,
    );
  }

  const deployIf = String(parsedDeploy?.jobs?.deploy?.if ?? "");
  if (!deployIf.includes("needs.beta-e2e.result != 'failure'")) {
    issues.push(
      `${prodDeployPath}'s deploy job must proceed when the beta E2E pre-flight was SKIPPED, which is its state whenever the deploy did not ask for it. Depend on \`needs.beta-e2e.result != 'failure'\`; requiring 'success' would block every deploy that opted out.`,
    );
  }
}

// 8. The scheduled wrapper runs the same reusable job every six hours and
// deduplicates failures into one open issue.
if (scheduledWorkflow) {
  try {
    const parsed = parse(scheduledWorkflow) as Record<string, unknown>;
    const on = parsed.on as Record<string, unknown> | undefined;
    const schedules = on?.schedule;
    const hasSixHourSchedule =
      Array.isArray(schedules) &&
      schedules.some(
        (entry) =>
          typeof entry === "object" &&
          entry !== null &&
          (entry as { cron?: unknown }).cron === "0 */6 * * *",
      );
    if (!hasSixHourSchedule) {
      issues.push(
        `${scheduledWorkflowPath} must run the beta E2E check on the 0 */6 * * * schedule.`,
      );
    }
  } catch (error) {
    issues.push(
      `${scheduledWorkflowPath} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const requiredFragments = [
    "uses: ./.github/workflows/beta-e2e.yml",
    "lane: public+authed",
    "issues: write",
    "[beta-e2e] Scheduled beta health check failing",
    "gh issue list",
    "--state open",
    "gh issue comment",
    "gh issue create",
    "gh issue close",
  ];
  for (const fragment of requiredFragments) {
    if (!scheduledWorkflow.includes(fragment)) {
      issues.push(
        `${scheduledWorkflowPath} is missing ${JSON.stringify(fragment)}. The scheduled check must reuse the full authenticated suite and deduplicate its GitHub issue lifecycle.`,
      );
    }
  }
}

if (issues.length > 0) {
  console.error("guard:beta-e2e-suite found problems:\n");
  for (const issue of issues) console.error(`  - ${issue}`);
  process.exit(1);
}

console.log("guard:beta-e2e-suite passed");
