import { readFileSync } from "node:fs";

import { parse } from "yaml";

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

if (fleet && !fleet.includes("netlify-beta-sites.json")) {
  issues.push(
    `${fleetPath} no longer reads ${sitesPath}. The suite must derive its host list from the deploy list so a new beta site is covered without a second edit.`,
  );
}

if (fleet && !fleet.includes('startsWith("beta.")')) {
  issues.push(
    `${fleetPath} dropped its beta-host check. Without it this suite can be pointed at production, where it would sign in as a real user and write to live data.`,
  );
}

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

if (globalSetup && !/throw new Error/.test(globalSetup)) {
  issues.push(
    `${globalSetupPath} no longer throws. An authenticated run that degrades to an anonymous one reports green while testing nothing.`,
  );
}
if (globalSetup && !globalSetup.includes("withHostDeadline")) {
  issues.push(
    `${globalSetupPath} no longer runs each host's setup under a deadline. One host that accepts a request and goes silent stalls the whole job until its timeout kills it, which GitHub reports as "cancelled" with no test results.`,
  );
}
if (providerKey && !providerKey.includes("AbortSignal.timeout")) {
  issues.push(
    `${providerKeyPath} no longer bounds the in-page OpenAI key install with an abort signal. Playwright's page.evaluate has no timeout of its own, so an unbounded fetch inside it can hang global setup indefinitely.`,
  );
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

if (config && /ignoreHTTPSErrors/.test(stripComments(config))) {
  issues.push(
    `${configPath} sets ignoreHTTPSErrors. "The connection isn't private" was a real beta report; only a browser that still validates certificates can catch it.`,
  );
}
if (config && !/globalTimeout\s*:/.test(stripComments(config))) {
  issues.push(
    `${configPath} sets no globalTimeout. Without one a hung global setup runs until the job's timeout kills it, and a killed job leaves no results file for the failure digest.`,
  );
}
if (config && !/maxFailures\s*:/.test(stripComments(config))) {
  issues.push(
    `${configPath} sets no maxFailures. A broad regression should stop the run in minutes rather than run every remaining test to its own timeout.`,
  );
}

if (workflow) {
  try {
    const parsed = parse(workflow) as Record<string, unknown>;
    const on = parsed.on as Record<string, unknown> | undefined;
    if (!on || !("workflow_dispatch" in on)) {
      issues.push(
        `${workflowPath} must offer workflow_dispatch — it is the manual promotion gate.`,
      );
    }
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
    !workflow.includes(
      'pnpm e2e:beta --project=fleet --grep "$BETA_E2E_GREP" --pass-with-no-tests',
    )
  ) {
    issues.push(
      `${workflowPath} no longer passes BETA_E2E_GREP through the fleet lane without failing when no fleet test matches.`,
    );
  }
  if (!workflow.includes("--project=advisory")) {
    issues.push(
      `${workflowPath} no longer runs the advisory lane. Non-blocking findings that stop being reported stop being fixed.`,
    );
  }
  if (
    !workflow.includes(
      'pnpm e2e:beta --project=advisory --grep "$BETA_E2E_GREP" --pass-with-no-tests',
    )
  ) {
    issues.push(
      `${workflowPath} no longer passes BETA_E2E_GREP through the advisory lane without failing when no advisory test matches.`,
    );
  }
  if (!/continue-on-error:\s*true/.test(workflow)) {
    issues.push(
      `${workflowPath} no longer marks the advisory lane non-gating. Gating on advisory findings trains people to ignore a red run.`,
    );
  }
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
  if (!workflow.includes('apps=${apps.join(",")}')) {
    issues.push(
      `${workflowPath} no longer publishes the canonical app selection from discover for downstream non-sharded lanes.`,
    );
  }
  if (!workflow.includes("BETA_E2E_APPS: ${{ needs.discover.outputs.apps }}")) {
    issues.push(
      `${workflowPath} passes raw inputs.apps to a non-sharded lane instead of discover's canonical app selection.`,
    );
  }
}

if (workflow) {
  try {
    type ShardEntry = {
      slot?: unknown;
      project?: unknown;
      app?: unknown;
      cluster?: unknown;
      shard?: unknown;
      timeout?: unknown;
      global_timeout?: unknown;
    };
    type WorkflowJob = {
      needs?: string | string[];
      if?: string;
      "timeout-minutes"?: unknown;
      env?: Record<string, unknown>;
      steps?: Array<{ name?: unknown; run?: unknown }>;
      strategy?: {
        "max-parallel"?: unknown;
        matrix?: {
          include?: ShardEntry[];
        };
      };
    };
    const parsed = parse(workflow) as {
      concurrency?: { group?: unknown };
      jobs?: Record<string, WorkflowJob>;
    };
    const jobs = parsed.jobs ?? {};
    const hasNeed = (job: string, dependency: string): boolean => {
      const needs = jobs[job]?.needs;
      return Array.isArray(needs)
        ? needs.includes(dependency)
        : needs === dependency;
    };

    // The lanes are independent, so they overlap. What keeps that safe for the
    // shared CDN and databases is the matrix caps and per-job timeouts below,
    // not an ordering.
    for (const job of ["public", "fleet", "advisory", "authed"] as const) {
      if (!hasNeed(job, "discover")) {
        issues.push(
          `${workflowPath} must run ${job} after discover; it supplies the canonical app selection.`,
        );
      }
    }
    if (!hasNeed("authed", "gate")) {
      issues.push(
        `${workflowPath} must run authed after the gate job, so a type error stops the authenticated shards before any token is spent.`,
      );
    }
    const gateRuns = (jobs.gate?.steps ?? [])
      .map((step) => String(step.run ?? ""))
      .join("\n");
    if (!gateRuns.includes("pnpm typecheck:e2e")) {
      issues.push(
        `${workflowPath} gate no longer runs typecheck:e2e. e2e/ is outside the workspace typecheck sweep.`,
      );
    }

    const concurrencyGroup = String(parsed.concurrency?.group ?? "");
    if (!concurrencyGroup.includes("inputs.lane")) {
      issues.push(
        `${workflowPath} concurrency group must depend on inputs.lane. A single group makes the production pre-flight and the signup canary queue behind a scheduled authenticated run.`,
      );
    }

    const publicParallel = jobs.public?.strategy?.["max-parallel"];
    if (
      typeof publicParallel !== "number" ||
      publicParallel < 1 ||
      publicParallel > 8
    ) {
      issues.push(
        `${workflowPath} must cap the public matrix at eight runners or fewer so the sharded sweep cannot burst the CDN that throttles datacenter traffic.`,
      );
    }
    const authedParallel = jobs.authed?.strategy?.["max-parallel"];
    if (
      typeof authedParallel !== "number" ||
      authedParallel < 1 ||
      authedParallel > 5
    ) {
      issues.push(
        `${workflowPath} must cap the authenticated matrix at five runners or fewer so concurrent sessions cannot exhaust shared beta databases.`,
      );
    }

    // A hung run must end inside its job's timeout so it is reported rather
    // than cancelled with no results.
    const jobTimeout = (job: string): number | null => {
      const value = jobs[job]?.["timeout-minutes"];
      return typeof value === "number" ? value : null;
    };
    for (const job of ["discover", "gate", "public", "fleet", "advisory"]) {
      const timeout = jobTimeout(job);
      if (timeout === null || timeout > 15) {
        issues.push(
          `${workflowPath} ${job} must set a numeric timeout-minutes of 15 or less; an unbounded or generous timeout is how a hung run cost 45 minutes.`,
        );
      }
    }
    for (const job of ["public", "fleet", "advisory"] as const) {
      const globalTimeout = Number(
        jobs[job]?.env?.BETA_E2E_GLOBAL_TIMEOUT_MINUTES,
      );
      const timeout = jobTimeout(job);
      if (
        !Number.isInteger(globalTimeout) ||
        timeout === null ||
        globalTimeout >= timeout
      ) {
        issues.push(
          `${workflowPath} ${job} must set BETA_E2E_GLOBAL_TIMEOUT_MINUTES below its timeout-minutes, so Playwright ends the run and writes results before the job is killed.`,
        );
      }
    }
    if (
      String(jobs.authed?.["timeout-minutes"] ?? "").replace(/\s/g, "") !==
      "${{matrix.timeout}}"
    ) {
      issues.push(
        `${workflowPath} authed must take timeout-minutes from its matrix entries, so each slot's limit is sized to that slot.`,
      );
    }
    if (
      String(jobs.authed?.env?.BETA_E2E_GLOBAL_TIMEOUT_MINUTES ?? "").replace(
        /\s/g,
        "",
      ) !== "${{matrix.global_timeout}}"
    ) {
      issues.push(
        `${workflowPath} authed must pass each slot's global_timeout as BETA_E2E_GLOBAL_TIMEOUT_MINUTES.`,
      );
    }

    const authedShards = jobs.authed?.strategy?.matrix?.include ?? [];
    const configuredProjects = new Set(
      [...config.matchAll(/\bname:\s*["']([^"']+)["']/g)].map(
        (match) => match[1],
      ),
    );
    if (authedShards.length === 0) {
      issues.push(
        `${workflowPath} authed must declare authenticated matrix shards so registry, chat, journey, and design failures remain independently visible.`,
      );
    }
    const seenSlots = new Set<string>();
    const seenChatApps = new Set<string>();
    for (const shard of authedShards) {
      const { slot, project, app, timeout, global_timeout } = shard;
      if (typeof project !== "string" || !project) {
        issues.push(
          `${workflowPath} authed contains an authenticated matrix entry without a project name.`,
        );
        continue;
      }
      if (typeof slot !== "string" || !slot) {
        issues.push(
          `${workflowPath} authed ${project} entry has no slot. The slot names its artifact and report folder.`,
        );
      } else {
        if (seenSlots.has(slot)) {
          issues.push(
            `${workflowPath} authed lists slot ${slot} more than once; artifact names would collide.`,
          );
        }
        seenSlots.add(slot);
      }
      if (!configuredProjects.has(project)) {
        issues.push(
          `${workflowPath} authed matrix project ${project} is not configured in ${configPath}.`,
        );
      }
      if (
        typeof timeout !== "number" ||
        typeof global_timeout !== "number" ||
        timeout > 30 ||
        global_timeout < 1 ||
        global_timeout >= timeout
      ) {
        issues.push(
          `${workflowPath} authed slot ${String(slot)} needs a numeric timeout of 30 minutes or less and a smaller global_timeout.`,
        );
      }
      if (project === "chat") {
        if (typeof app !== "string" || !app) {
          issues.push(
            `${workflowPath} authed chat slot ${String(slot)} must name one app. Chat is sharded per app so a hang on one host is isolated and named.`,
          );
        } else if (seenChatApps.has(app)) {
          issues.push(
            `${workflowPath} authed runs the chat project for ${app} more than once.`,
          );
        } else {
          seenChatApps.add(app);
        }
      }
      // Global setup writes the e2e account's user-scoped OpenAI key on every
      // host of a `chat` cluster slot. Keeping that to the chat project, one
      // slot per host, is what stops two jobs writing one host's key at once.
      if ((project === "chat") !== (shard.cluster === "chat")) {
        issues.push(
          `${workflowPath} authed slot ${String(slot)} must use cluster chat exactly when it runs the chat project (cluster ${JSON.stringify(shard.cluster)}, project ${project}). Only chat slots install the OpenAI key, one per host.`,
        );
      }
    }

    // A project the config defines but no slot runs is a lane that silently
    // never executes; one selection in two slots runs twice; a shard set that
    // is not exactly 1/m..m/m drops or repeats part of a project.
    const slotProjects = new Set(authedShards.map((entry) => entry.project));
    for (const project of configuredProjects) {
      if (["public", "fleet", "advisory"].includes(project ?? "")) continue;
      if (!slotProjects.has(project)) {
        issues.push(
          `${configPath} defines project ${project}, but no authed slot in ${workflowPath} runs it, so its tests would never execute.`,
        );
      }
    }
    const slotsByProject = new Map<string, ShardEntry[]>();
    for (const entry of authedShards) {
      if (typeof entry.project !== "string") continue;
      slotsByProject.set(entry.project, [
        ...(slotsByProject.get(entry.project) ?? []),
        entry,
      ]);
    }
    for (const [project, entries] of slotsByProject) {
      const selections = new Set<string>();
      for (const entry of entries) {
        const selection = `${String(entry.app ?? "")}|${String(entry.shard ?? "")}`;
        if (selections.has(selection)) {
          issues.push(
            `${workflowPath} authed runs project ${project} (app "${String(entry.app ?? "")}", shard "${String(entry.shard ?? "")}") in more than one slot, so those tests would run twice.`,
          );
        }
        selections.add(selection);
      }
      const sharded = entries.filter((entry) => entry.shard !== undefined);
      if (sharded.length === 0) continue;
      if (sharded.length !== entries.length) {
        issues.push(
          `${workflowPath} authed mixes sharded and unsharded slots for project ${project}; the unsharded slot would repeat every sharded test.`,
        );
      }
      const indexes: number[] = [];
      const counts = new Set<number>();
      for (const entry of sharded) {
        const match =
          typeof entry.shard === "string"
            ? entry.shard.match(/^(\d+)\/(\d+)$/)
            : null;
        if (!match) {
          issues.push(
            `${workflowPath} authed slot ${String(entry.slot)} has shard ${JSON.stringify(entry.shard)}; use "<n>/<m>".`,
          );
          continue;
        }
        indexes.push(Number(match[1]));
        counts.add(Number(match[2]));
      }
      const [count] = [...counts];
      const expected = Array.from({ length: count ?? 0 }, (_, i) => i + 1);
      if (
        counts.size !== 1 ||
        indexes.sort((a, b) => a - b).join(",") !== expected.join(",")
      ) {
        issues.push(
          `${workflowPath} authed shards for project ${project} must be exactly 1/m through m/m, once each, or part of the project's tests are dropped or repeated.`,
        );
      }
    }
    if (
      String(jobs.authed?.env?.BETA_E2E_PROJECT ?? "").replace(/\s/g, "") !==
        "${{matrix.project}}" ||
      String(jobs.authed?.env?.BETA_E2E_SHARD ?? "").replace(/\s/g, "") !==
        "${{matrix.shard||''}}"
    ) {
      issues.push(
        `${workflowPath} authed must pass each slot's project and shard as BETA_E2E_PROJECT and BETA_E2E_SHARD, or a shard would silently run the whole project.`,
      );
    }

    // The authed step lists its selection with auth disabled before any
    // credentialed setup. Only an explicit empty result may skip, and only
    // for a narrowed run; every other failure must propagate.
    const authedRun = String(
      (jobs.authed?.steps ?? []).find((step) =>
        String(step.name ?? "").startsWith("Authenticated"),
      )?.run ?? "",
    );
    const listCommand = authedRun.search(
      /set \+e\s+BETA_E2E_AUTHED=0 pnpm e2e:beta "\$\{select_args\[@\]\}" --list >"\$selection_file" 2>&1\s+selection_status="\$\?"\s+set -e/,
    );
    const emptyCheck = authedRun.indexOf('grep -q "Total: 0 tests in 0 files"');
    const propagate = authedRun.indexOf('exit "$selection_status"');
    const finalRun = authedRun.lastIndexOf('pnpm e2e:beta "${select_args[@]}"');
    if (
      !authedRun.includes('select_args=("--project=$BETA_E2E_PROJECT")') ||
      !authedRun.includes('select_args+=("--shard=$BETA_E2E_SHARD")') ||
      !authedRun.includes('select_args+=(--grep "$BETA_E2E_GREP")') ||
      listCommand < 0 ||
      emptyCheck < listCommand ||
      !authedRun.includes('grep -q "Error: No tests found"') ||
      !authedRun.includes('"$BETA_E2E_NARROWED" = "true"') ||
      propagate < emptyCheck ||
      finalRun < propagate
    ) {
      issues.push(
        `${workflowPath} authed step must capture and propagate failed authenticated discovery, skip only an explicit no-tests result for a narrowed run, and run the same project, shard and grep selection it listed. A public-only grep must not require session credentials.`,
      );
    }

    if (
      !config.includes(
        'const isAuthedCiRun = isCi && process.env.BETA_E2E_AUTHED === "1";',
      ) ||
      !config.includes("workers: isCi ? (isAuthedCiRun ? 1 : 3) : 4")
    ) {
      issues.push(
        `${configPath} must serialize CI authenticated workers so shared beta databases cannot be exhausted by parallel journeys.`,
      );
    }

    const conjunctionParts = (condition: unknown): string[] | null => {
      if (typeof condition !== "string") return null;
      const expression = condition.match(
        /^\s*\$\{\{\s*([\s\S]*?)\s*\}\}\s*$/,
      )?.[1];
      if (!expression || expression.includes("||")) return null;
      const parts = expression
        .split("&&")
        .map((part) => part.trim())
        .filter(Boolean);
      return parts.length === 0 ? null : parts;
    };

    for (const job of ["fleet", "advisory", "authed"] as const) {
      const parts = conjunctionParts(jobs[job]?.if);
      if (!parts?.includes("always()") || !parts.includes("!cancelled()")) {
        issues.push(
          `${workflowPath} ${job} must use always() and !cancelled() as top-level conjunctions so ordinary failures do not suppress later evidence or cancellation starts new work.`,
        );
      }
    }

    for (const job of ["public", "fleet", "advisory"] as const) {
      if (
        !conjunctionParts(jobs[job]?.if)?.includes("inputs.lane != 'authed'")
      ) {
        issues.push(
          `${workflowPath} ${job} must use inputs.lane != 'authed' as a top-level conjunction so authenticated-only runs skip it.`,
        );
      }
    }
    if (
      !conjunctionParts(jobs.authed?.if)?.includes("inputs.lane != 'public'")
    ) {
      issues.push(
        `${workflowPath} authed must use inputs.lane != 'public' as a top-level conjunction so public-only runs skip it.`,
      );
    }
  } catch (error) {
    issues.push(
      `${workflowPath} lane dependency graph could not be checked: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

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

  const reportingFragments = [
    "scripts/beta-e2e-digest.ts",
    "QA_SLACK_BOT_TOKEN",
    "method: chat.postMessage",
    "C0C4U4XRT6X",
    "Slack notification not configured",
  ];
  for (const fragment of reportingFragments) {
    if (!scheduledWorkflow.includes(fragment)) {
      issues.push(
        `${scheduledWorkflowPath} is missing ${JSON.stringify(fragment)}. A failed run must produce the digest issue and the #qa-agent-native Slack message, and an unconfigured Slack token must be reported rather than skipped silently.`,
      );
    }
  }
  if (
    !/uses:\s*slackapi\/slack-github-action@[0-9a-f]{40}\s+#\s*v\d/.test(
      scheduledWorkflow,
    )
  ) {
    issues.push(
      `${scheduledWorkflowPath} must pin slackapi/slack-github-action by full commit SHA with a version comment, like every other action in this repository.`,
    );
  }
  try {
    const parsed = parse(scheduledWorkflow) as {
      jobs?: Record<string, { permissions?: Record<string, string> }>;
    };
    const permissions = Object.entries(parsed.jobs?.report?.permissions ?? {})
      .map(([scope, level]) => `${scope}: ${level}`)
      .sort()
      .join(", ");
    const expected = "actions: read, contents: read, issues: write";
    if (permissions !== expected) {
      issues.push(
        `${scheduledWorkflowPath} report job permissions must be exactly "${expected}" (read the run's jobs and artifacts, write the issue) and nothing broader; found "${permissions}".`,
      );
    }
  } catch (error) {
    issues.push(
      `${scheduledWorkflowPath} report job permissions could not be checked: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

if (issues.length > 0) {
  console.error("guard:beta-e2e-suite found problems:\n");
  for (const issue of issues) console.error(`  - ${issue}`);
  process.exit(1);
}

console.log("guard:beta-e2e-suite passed");
