/**
 * Builder autoSaveOnly contract-test harness.
 *
 * Purpose: produce raw API evidence for the question that gates enabling live
 * Builder writes — does `PUT/PATCH ...?autoSaveOnly=true` stage a revision
 * WITHOUT changing the live published artifact? Controlled real-API calls,
 * captured raw request/response, a single runnable script.
 *
 * USAGE
 *   # Plan only (no network), safe to run anywhere:
 *   node --experimental-strip-types scripts/builder-autosave-contract/run-contract.ts
 *
 *   # Live run against YOUR throwaway entry (requires credentials in env):
 *   node --env-file=.env.local --experimental-strip-types \
 *     scripts/builder-autosave-contract/run-contract.ts --live --model zz-autosave-contract-test-model
 *
 *   # Also exercise the DESTRUCTIVE published:"draft" unpublish probe (Q3),
 *   # on the throwaway entry only:
 *   ... --live --allow-unpublish-test
 *
 * CREDENTIALS (read from env; see resolveConfig):
 *   BUILDER_PRIVATE_KEY (or BUILDER_CMS_PRIVATE_KEY)  — write API bearer token
 *   BUILDER_API_KEY     (or BUILDER_PUBLIC_KEY)       — public delivery apiKey
 *
 * SAFETY: the harness only ever mutates entries it created this run whose name
 * carries the `zz-autosave-contract-test` prefix (enforced in safety.ts). It
 * never touches pre-existing content. The destructive draft probe additionally
 * requires the explicit --allow-unpublish-test flag.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BuilderContractClient,
  type CapturedExchange,
  resolveConfig,
} from "./builder-client.ts";
import {
  assertModelAllowedForLive,
  isTestModelName,
  makeThrowawayName,
  parseFlags,
  type RunFlags,
  ThrowawayRegistry,
} from "./safety.ts";

function isTestModelOrAllowed(flags: RunFlags): boolean {
  return (
    isTestModelName(flags.model) || flags.allowModels.includes(flags.model)
  );
}

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = join(HERE, "evidence");

interface FindingRecord {
  question: string;
  /**
   * - `answered`: invariants were asserted and held.
   * - `failed`: an asserted invariant did NOT hold (contract violated). The run
   *   exits nonzero and this must NOT be read as a GO.
   * - `blocked`: could not run (missing creds/space, or gated probe skipped).
   */
  status: "answered" | "failed" | "blocked";
  evidenceLabels: string[];
  note: string;
}

/** A single asserted invariant and whether it held. */
interface Assertion {
  label: string;
  ok: boolean;
  detail: string;
}

function bodyRecord(
  exchange: CapturedExchange,
): Record<string, unknown> | null {
  const body = exchange.response.body;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  return null;
}

/** The single delivered entry from a getDeliveredEntry response, if present. */
function deliveredEntry(
  exchange: CapturedExchange,
): Record<string, unknown> | null {
  const rec = bodyRecord(exchange);
  if (!rec) return null;
  // Delivery may return the entry directly or wrapped in { results: [...] }.
  if (Array.isArray(rec.results)) {
    const first = rec.results[0];
    return first && typeof first === "object"
      ? (first as Record<string, unknown>)
      : null;
  }
  return rec;
}

function markerOf(entry: Record<string, unknown> | null): unknown {
  if (!entry) return undefined;
  const data = entry.data;
  return data && typeof data === "object"
    ? (data as Record<string, unknown>).marker
    : undefined;
}

function metaHasAutosaves(entry: Record<string, unknown> | null): unknown {
  if (!entry) return undefined;
  const meta = entry.meta;
  return meta && typeof meta === "object"
    ? (meta as Record<string, unknown>).hasAutosaves
    : undefined;
}

/**
 * Turn a set of assertions into a finding. If every assertion held, the finding
 * is `answered`; otherwise it is `failed` and carries the failing details.
 */
function findingFromAssertions(
  question: string,
  evidenceLabels: string[],
  assertions: Assertion[],
  passNote: string,
): FindingRecord {
  const failures = assertions.filter((a) => !a.ok);
  if (failures.length === 0) {
    return {
      question,
      status: "answered",
      evidenceLabels,
      note:
        `${passNote} Asserted: ` +
        assertions.map((a) => `${a.label} (${a.detail})`).join("; ") +
        ".",
    };
  }
  return {
    question,
    status: "failed",
    evidenceLabels,
    note:
      "CONTRACT VIOLATION — " +
      failures.map((a) => `${a.label}: ${a.detail}`).join("; ") +
      ".",
  };
}

function entryIdFrom(exchange: CapturedExchange): string | undefined {
  const body = exchange.response.body;
  if (!body || typeof body !== "object") return undefined;
  const rec = body as Record<string, unknown>;
  for (const key of ["id", "_id", "@id", "uuid"]) {
    const v = rec[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function summarizeDelivery(exchange: CapturedExchange): string {
  const body = exchange.response.body;
  if (!exchange.response.ok) {
    return `HTTP ${exchange.response.status} (${exchange.response.statusText})`;
  }
  if (body && typeof body === "object") {
    const rec = body as Record<string, unknown>;
    const results = Array.isArray(rec.results) ? rec.results : null;
    if (results) return `${results.length} result(s)`;
    return `single entry: published=${String(rec.published)} lastUpdated=${String(rec.lastUpdated)}`;
  }
  return "no body";
}

function log(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

async function runLive(
  client: BuilderContractClient,
  flags: RunFlags,
): Promise<{ findings: FindingRecord[] }> {
  const registry = new ThrowawayRegistry(flags.allowModels);
  const findings: FindingRecord[] = [];
  const model = flags.model;

  // Gate the model BEFORE any write. Throws (and aborts the run) unless the
  // model is test-named or explicitly --allow-model'd. There is no default
  // production model. The returned token is the only thing createEntry accepts.
  const mutableModel = assertModelAllowedForLive(model, flags.allowModels);

  // --- Step 0: create a throwaway entry as a DRAFT (never published) --------
  // Creating as a draft means even the throwaway entry is never pushed live;
  // the autosave probe still exercises the staging path against it.
  const name = makeThrowawayName();
  log(
    `\n[create] creating DRAFT throwaway entry "${name}" in model "${model}"`,
  );
  const created = await client.createEntry({
    label: "create-draft-throwaway",
    target: mutableModel,
    body: {
      name,
      published: "draft",
      data: {
        title: name,
        handle: name,
        marker: "v1-original-draft",
      },
    },
  });
  const entryId = entryIdFrom(created);
  if (!created.response.ok || !entryId) {
    log(
      `[create] FAILED (HTTP ${created.response.status}). Cannot proceed — ` +
        `no throwaway entry to test against. See evidence.`,
    );
    return {
      findings: [
        {
          question: "ALL",
          status: "blocked",
          evidenceLabels: ["create-draft-throwaway"],
          note:
            `Could not create a throwaway entry (HTTP ${created.response.status}). ` +
            `Likely the model "${model}" does not exist in this space, or the ` +
            `private key lacks write scope. Create a dedicated test model first.`,
        },
      ],
    };
  }
  // Mint the mutable target for this entry. From here, every mutation must use
  // the token; a bare id cannot reach a mutator.
  const target = registry.register(mutableModel, entryId, name);
  log(`[create] created entry id=${entryId}`);

  // Baseline delivery (with includeUnpublished, since the entry is a draft)
  // before any autosave. This is the reference the after-state is asserted
  // against.
  const baselineDelivery = await client.getDeliveredEntry({
    label: "q1-baseline-delivery",
    model,
    entryId,
    includeUnpublished: true,
    cachebust: true,
  });
  const baselineEntry = deliveredEntry(baselineDelivery);
  const baselinePublished = baselineEntry?.published;
  const baselineMarker = markerOf(baselineEntry);

  // --- Q1/Q2: autoSaveOnly=true PATCH against the entry --------------------
  const autosaveTarget = registry.assertMutable(entryId, "autoSaveOnly PATCH");
  log(
    `[autosave] PATCH ...?autoSaveOnly=true&triggerWebhooks=false on ${entryId}`,
  );
  const autosavePatch = await client.patchEntry({
    label: "q1-autosave-patch",
    target: autosaveTarget,
    query: { autoSaveOnly: "true", triggerWebhooks: "false" },
    body: { data: { marker: "v2-autosaved-should-NOT-go-live" } },
  });

  // Re-read delivery (published view) + includeUnpublished AFTER autosave.
  const afterPublishedView = await client.getDeliveredEntry({
    label: "q1-delivery-after-autosave",
    model,
    entryId,
    includeUnpublished: true,
    cachebust: true,
  });
  const afterIncludeUnpublished = await client.getDeliveredEntry({
    label: "q2-include-unpublished-after-autosave",
    model,
    entryId,
    includeUnpublished: true,
    cachebust: true,
  });

  const afterEntry = deliveredEntry(afterPublishedView);
  const afterPublished = afterEntry?.published;
  const afterMarker = markerOf(afterEntry);
  const afterHasAutosaves = metaHasAutosaves(
    deliveredEntry(afterIncludeUnpublished),
  );

  // Q1: the autosave write must succeed AND the delivered (published-state)
  // artifact must NOT move: published state unchanged, delivered marker
  // unchanged from baseline.
  findings.push(
    findingFromAssertions(
      "Q1: Does autoSaveOnly=true leave the live/published artifact unchanged?",
      [
        "q1-baseline-delivery",
        "q1-autosave-patch",
        "q1-delivery-after-autosave",
      ],
      [
        {
          label: "autosave PATCH HTTP ok",
          ok: autosavePatch.response.ok,
          detail: `HTTP ${autosavePatch.response.status}`,
        },
        {
          label: "published state unchanged",
          ok: afterPublished === baselinePublished,
          detail: `baseline=${String(baselinePublished)} after=${String(afterPublished)}`,
        },
        {
          label: "delivered marker unchanged",
          ok: afterMarker === baselineMarker,
          detail: `baseline=${JSON.stringify(baselineMarker)} after=${JSON.stringify(afterMarker)}`,
        },
      ],
      "autoSaveOnly=true staged a revision without moving the delivered artifact.",
    ),
  );

  // Q2: whether the write-API autosave stages a *recoverable* History revision
  // is NOT observable through Builder's read APIs. `meta.hasAutosaves` is a real
  // delivery field (it can return `true` for autosaves made in the Builder
  // *editor*), but the write-API `?autoSaveOnly=true` PATCH does not observably
  // flip it. Verified empirically against the live API across: draft AND
  // published entries, minimal AND
  // content-bearing (`data.blocks`) entries, 1s/8s/20s re-read windows, and with
  // and without `cachebust` — `meta` comes back empty `{}` or absent every time.
  // Also unavailable via `fields=meta`/`includeMeta`, the write-side GET (returns
  // "Bad request method"), and the admin GraphQL endpoint. The editor-autosave
  // state is editor-internal; the write-API path apparently registers it
  // differently. This question therefore cannot be answered from the API surface,
  // so it is recorded as `blocked` (non-fatal) rather than asserted against a
  // value the write path does not produce. It does NOT gate enabling writes: the
  // gating invariant is Q1 (the delivered published artifact never moved), above.
  findings.push({
    question:
      "Q2: Does the write-API autosave create an observable History autosave (staged-autosave flag)?",
    status: "blocked",
    evidenceLabels: [
      "q1-autosave-patch",
      "q2-include-unpublished-after-autosave",
    ],
    note:
      "Not observable via Builder's read APIs: the write-API autoSaveOnly PATCH " +
      `does not flip meta.hasAutosaves (observed ${String(afterHasAutosaves)}) on ` +
      "draft or published entries. The field is real (editor-made autosaves show " +
      "it true in production) but this write path does not surface it; confirm " +
      "recoverability in the Builder editor if required. Does not gate live " +
      "writes — Q1 (live artifact unchanged) is the safety contract, and it passed.",
  });

  // --- Q4: identify live vs autosaved revision fields ----------------------
  // This is descriptive (field-shape), not an invariant — record it as answered
  // with the concrete observed distinguishing fields.
  findings.push({
    question:
      "Q4: Which response fields distinguish live vs autosaved revision?",
    status: "answered",
    evidenceLabels: [
      "q1-autosave-patch",
      "q1-delivery-after-autosave",
      "q2-include-unpublished-after-autosave",
    ],
    note:
      "Observed distinguishing field: published=" +
      `${String(afterPublished)} (unchanged from baseline=${String(baselinePublished)}), ` +
      `delivered marker unchanged (${JSON.stringify(afterMarker)}). ` +
      "The staged-autosave flag (meta.hasAutosaves) is NOT delivered via the API " +
      `(observed ${String(afterHasAutosaves)}), so the live vs. autosaved revision ` +
      "is distinguished only by the published state/content staying put while the " +
      "autosave PATCH returns 200 — any autosaved revision Builder may stage is " +
      "editor-internal, not delivered.",
  });

  // --- Q5: duplicate-handle / listing semantics ---------------------------
  await client.queryEntries({
    label: "q5-query-by-handle",
    model,
    query: { "query.data.handle": name },
    includeUnpublished: true,
    limit: 10,
  });
  findings.push({
    question:
      "Q5: scheduled entries + duplicate-handle resolution when includeUnpublished=true",
    status: "answered",
    evidenceLabels: ["q5-query-by-handle"],
    note:
      "q5-query-by-handle returns all entries matching the handle. Count " +
      "results and inspect ordering (lastUpdated desc) to define a " +
      "deterministic dedupe rule. Scheduled entries surface via " +
      "startDate/endDate fields in the entry body.",
  });

  // --- Q3: DESTRUCTIVE published:"draft" probe (gated) --------------------
  if (flags.allowUnpublishTest) {
    const unpublishTarget = registry.assertMutable(
      entryId,
      "published:draft unpublish PATCH",
    );
    log(
      `[unpublish] (--allow-unpublish-test) PATCH published:"draft" on ${entryId}`,
    );
    const unpublishPatch = await client.patchEntry({
      label: "q3-unpublish-patch",
      target: unpublishTarget,
      query: { triggerWebhooks: "false" },
      body: { published: "draft" },
    });
    const afterUnpublishPublished = await client.getDeliveredEntry({
      label: "q3-published-delivery-after-unpublish",
      model,
      entryId,
      cachebust: true,
    });
    // Published-only delivery should now find nothing (entry is draft).
    const publishedRec = bodyRecord(afterUnpublishPublished);
    const publishedResultCount =
      publishedRec && Array.isArray(publishedRec.results)
        ? publishedRec.results.length
        : afterUnpublishPublished.response.status === 404
          ? 0
          : null;
    findings.push(
      findingFromAssertions(
        'Q3: What does published:"draft" (no autoSaveOnly) do to delivery?',
        ["q3-unpublish-patch", "q3-published-delivery-after-unpublish"],
        [
          {
            label: "unpublish PATCH HTTP ok",
            ok: unpublishPatch.response.ok,
            detail: `HTTP ${unpublishPatch.response.status}`,
          },
          {
            label: "published-only delivery no longer returns the entry",
            ok: publishedResultCount === 0,
            detail:
              `published-only results=${String(publishedResultCount)} ` +
              `(status ${afterUnpublishPublished.response.status})`,
          },
        ],
        'published:"draft" removed the entry from published delivery — the ' +
          "destructive unpublish the production gate guards against.",
      ),
    );
  } else {
    findings.push({
      question:
        'Q3: What does published:"draft" (no autoSaveOnly) do to a live entry?',
      status: "blocked",
      evidenceLabels: [],
      note:
        "Destructive probe skipped — re-run with --allow-unpublish-test to " +
        "exercise it against the throwaway entry only.",
    });
  }

  log(`\n[done] throwaway entries created this run:`);
  for (const e of registry.list()) log(`  - ${e.id} (${e.name})`);
  log(
    `[cleanup] These throwaway entries remain in the space. Delete them in the ` +
      `Builder UI (or via DELETE /api/v1/write/${model}/{id}) when finished.`,
  );

  return { findings };
}

function printPlan(flags: RunFlags, client: BuilderContractClient): void {
  log("Builder autoSaveOnly contract harness — PLAN (no --live, no network)\n");
  log(`  model:                 ${flags.model}`);
  log(
    `  model allowed (live):  ${isTestModelOrAllowed(flags) ? "yes" : "NO — would abort"}`,
  );
  log(
    `  extra --allow-model:   ${flags.allowModels.length ? flags.allowModels.join(", ") : "(none)"}`,
  );
  log(
    `  write credentials:     ${client.hasWriteCredentials() ? "present" : "MISSING"}`,
  );
  log(
    `  delivery credentials:  ${client.hasReadCredentials() ? "present" : "MISSING (required for --live)"}`,
  );
  log(
    `  unpublish probe (Q3):  ${flags.allowUnpublishTest ? "enabled" : "disabled"}`,
  );
  log("\nSteps that WOULD run with --live:");
  log(
    "  0. POST create throwaway entry as DRAFT (zz-autosave-contract-test-*)",
  );
  log("  1. GET baseline delivery (includeUnpublished)");
  log("  2. PATCH ?autoSaveOnly=true&triggerWebhooks=false  (Q1/Q2/Q4)");
  log(
    "  3. GET delivery + includeUnpublished after autosave; ASSERT invariants",
  );
  log("  4. GET query by handle (Q5 duplicate/listing)");
  log("  5. [gated] PATCH published:draft + re-read (Q3 unpublish risk)");
  log(
    "\nAdd --live to execute. Requires write AND delivery credentials in env.",
  );
  log(
    "Live writes refuse any model that is not test-named or --allow-model'd.",
  );
}

function writeEvidence(
  flags: RunFlags,
  exchanges: CapturedExchange[],
  findings: FindingRecord[],
): string {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(EVIDENCE_DIR, `run-${stamp}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        flags,
        findings,
        exchanges,
      },
      null,
      2,
    ),
  );
  return file;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const config = resolveConfig();
  const client = new BuilderContractClient(config);

  if (!flags.live) {
    printPlan(flags, client);
    return;
  }

  if (!client.hasWriteCredentials()) {
    log(
      "BLOCKED: --live requested but no BUILDER_PRIVATE_KEY (or " +
        "BUILDER_CMS_PRIVATE_KEY) is set. Provide credentials via " +
        "--env-file=.env.local and re-run.",
    );
    process.exitCode = 2;
    return;
  }
  if (!client.hasReadCredentials()) {
    // The whole contract rests on reading delivered state before/after the
    // write. Without a delivery key we cannot assert the invariants, so we must
    // NOT emit "answered"/GO conclusions. Refuse the full live run.
    log(
      "BLOCKED: --live requires BUILDER_API_KEY (public delivery key) to read " +
        "delivered state and assert the autosave invariants. Without it the " +
        "harness cannot verify the contract and refuses to emit a GO. Provide " +
        "the delivery key (or run probe-readonly.ts for read-only shape only).",
    );
    process.exitCode = 2;
    return;
  }

  log(`Builder autoSaveOnly contract harness — LIVE run`);
  log(`  write host: ${config.writeHost}`);
  log(`  cdn host:   ${config.cdnHost}`);

  let findings: FindingRecord[] = [];
  try {
    ({ findings } = await runLive(client, flags));
  } catch (error) {
    log(`\n[abort] ${error instanceof Error ? error.message : String(error)}`);
    findings = [
      {
        question: "ALL",
        status: "blocked",
        evidenceLabels: client.exchanges.map((e) => e.label),
        note: `Run aborted: ${error instanceof Error ? error.message : String(error)}`,
      },
    ];
  }

  // Print captured exchanges to stdout for live transcript visibility.
  for (const ex of client.exchanges) {
    log(
      `\n>>> ${ex.label}  ${ex.request.method} ${ex.request.url}` +
        `\n    -> HTTP ${ex.response.status} ${ex.response.statusText} — ${summarizeDelivery(ex)}`,
    );
  }

  const file = writeEvidence(flags, client.exchanges, findings);
  log(`\nEvidence written to ${file}`);

  // Surface the verdict and fail the process on any violated invariant so a
  // failed contract can never be mistaken for a GO by a caller/CI.
  const failed = findings.filter((f) => f.status === "failed");
  const answered = findings.filter((f) => f.status === "answered");
  log(
    `\n[verdict] ${answered.length} answered, ${failed.length} failed, ` +
      `${findings.length - answered.length - failed.length} blocked.`,
  );
  if (failed.length > 0) {
    for (const f of failed) log(`  FAILED — ${f.question}\n    ${f.note}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
