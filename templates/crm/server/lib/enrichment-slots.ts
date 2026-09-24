/**
 * Named enrichment provider slots.
 *
 * A slot is a capability the CRM buys — "who is this company", "what is this
 * person's work email" — bound to exactly one provider in the registry below.
 * Nothing outside this file names a vendor: not an action schema, not a wire
 * field, not a UI string. Swapping a provider is one line here.
 *
 * Every slot answers with a five-state outcome, and the states stay separate all
 * the way to the grid. A slot with no credential, a slot the record cannot be
 * asked (no domain to look up), a slot that answered with nothing, and a slot
 * that threw are four different facts about the world. Collapsing any pair of
 * them into "no data" is exactly the failure the root CLAUDE.md names: the UI
 * would then report something confidently wrong and nobody could see it.
 */

import {
  createProviderApiRuntime,
  type ProviderApiId,
  type ProviderApiRequestArgs,
} from "@agent-native/core/provider-api";
import { getCredentialContext } from "@agent-native/core/server";
import { resolveWorkspaceConnectionCredentialForApp } from "@agent-native/core/workspace-connections";

import { CRM_APP_ID } from "./provider-api.js";

export const CRM_ENRICHMENT_SLOTS = [
  "company",
  "person",
  "contact",
  "web",
  "calls",
] as const;

export type CrmEnrichmentSlot = (typeof CRM_ENRICHMENT_SLOTS)[number];

export function isCrmEnrichmentSlot(
  value: unknown,
): value is CrmEnrichmentSlot {
  return (
    typeof value === "string" &&
    (CRM_ENRICHMENT_SLOTS as readonly string[]).includes(value)
  );
}

/** What a slot can be asked about one record. */
export interface CrmEnrichmentTarget {
  recordId: string;
  displayName: string;
  domain?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
}

/** One normalized value a slot produced, with the page it came from. */
export interface CrmSlotFact {
  key: string;
  value: string | number | boolean;
  sourceUrl?: string;
}

export type CrmEnrichmentSlotOutcome =
  /** No credential is granted for this slot. Nothing was called, nothing spent. */
  | { slot: CrmEnrichmentSlot; status: "unconfigured"; reason: string }
  /** The record lacks the identifier this slot resolves against. Not called. */
  | { slot: CrmEnrichmentSlot; status: "skipped"; reason: string }
  /** Called, answered, carried facts. */
  | {
      slot: CrmEnrichmentSlot;
      status: "ok";
      facts: CrmSlotFact[];
      observedAt: string;
    }
  /** Called, answered, carried nothing. A real (and different) answer. */
  | { slot: CrmEnrichmentSlot; status: "empty"; observedAt: string }
  /** Called and threw. The provider's message is preserved verbatim. */
  | { slot: CrmEnrichmentSlot; status: "error"; error: string };

export type CrmEnrichmentPhase = "verify" | "spend";

/** Longest fact string persisted; facts are metadata, never payload bodies. */
const MAX_FACT_CHARS = 500;
const MAX_FACTS_PER_SLOT = 20;

interface CrmEnrichmentSlotDriver {
  provider: ProviderApiId;
  /** Credential the slot needs. Checked for presence; its value is never read here. */
  credentialKey: string;
  /**
   * True when the response can carry an email or phone number. Phase A (the
   * unpaid verification pass) may never run one of these — see `verifySlots`.
   */
  carriesContactData: boolean;
  /** Normalized fact key -> dot path into the provider response body. */
  factPaths: Readonly<Record<string, string>>;
  /** null when the target lacks the identifier this provider resolves against. */
  buildRequest(target: CrmEnrichmentTarget): ProviderApiRequestArgs | null;
}

/**
 * The registry. One line per slot.
 *
 * ponytail: the request recipes are each provider's documented entry point, not
 * a tuned per-tenant query — the ceiling is recall, not correctness. A tenant
 * that needs a narrower query refines it through `provider-api-docs` and
 * `provider-api-request` rather than by editing this table.
 */
const SLOT_DRIVERS: Record<CrmEnrichmentSlot, CrmEnrichmentSlotDriver> = {
  company: {
    provider: "apollo",
    credentialKey: "APOLLO_API_KEY",
    carriesContactData: false,
    factPaths: {
      industry: "organization.industry",
      employeeCount: "organization.estimated_num_employees",
      country: "organization.country",
      city: "organization.city",
      foundedYear: "organization.founded_year",
      websiteUrl: "organization.website_url",
      linkedinUrl: "organization.linkedin_url",
      description: "organization.short_description",
    },
    buildRequest: (target) =>
      target.domain
        ? {
            provider: "apollo",
            method: "GET",
            path: "/api/v1/organizations/enrich",
            query: { domain: target.domain },
          }
        : null,
  },
  person: {
    provider: "apollo",
    credentialKey: "APOLLO_API_KEY",
    carriesContactData: false,
    factPaths: {
      title: "person.title",
      seniority: "person.seniority",
      linkedinUrl: "person.linkedin_url",
      city: "person.city",
      country: "person.country",
      organizationName: "person.organization.name",
    },
    buildRequest: (target) =>
      target.firstName && (target.domain || target.companyName)
        ? {
            provider: "apollo",
            method: "POST",
            path: "/api/v1/people/match",
            body: {
              first_name: target.firstName,
              last_name: target.lastName ?? undefined,
              domain: target.domain ?? undefined,
              organization_name: target.companyName ?? undefined,
            },
          }
        : null,
  },
  contact: {
    provider: "apollo",
    credentialKey: "APOLLO_API_KEY",
    // The reveal flags below are what makes this request billable, and they are
    // the only reason phase A exists.
    carriesContactData: true,
    factPaths: {
      email: "person.email",
      phone: "person.sanitized_phone",
    },
    buildRequest: (target) =>
      target.firstName && (target.domain || target.companyName)
        ? {
            provider: "apollo",
            method: "POST",
            path: "/api/v1/people/match",
            body: {
              first_name: target.firstName,
              last_name: target.lastName ?? undefined,
              domain: target.domain ?? undefined,
              organization_name: target.companyName ?? undefined,
              reveal_personal_emails: true,
              reveal_phone_number: true,
            },
          }
        : null,
  },
  web: {
    provider: "dataforseo",
    credentialKey: "DATAFORSEO_LOGIN",
    carriesContactData: false,
    factPaths: {
      topResultTitle: "tasks.0.result.0.items.0.title",
      topResultUrl: "tasks.0.result.0.items.0.url",
      topResultSnippet: "tasks.0.result.0.items.0.description",
    },
    buildRequest: (target) =>
      target.companyName || target.displayName
        ? {
            provider: "dataforseo",
            method: "POST",
            path: "/serp/google/organic/live/advanced",
            body: [
              {
                keyword: `${target.companyName ?? target.displayName} company news`,
                language_code: "en",
                location_code: 2840,
                depth: 10,
              },
            ],
          }
        : null,
  },
  calls: {
    provider: "gong",
    credentialKey: "GONG_ACCESS_KEY",
    carriesContactData: false,
    factPaths: {
      lastCallTitle: "calls.0.metaData.title",
      lastCallStartedAt: "calls.0.metaData.started",
      lastCallUrl: "calls.0.metaData.url",
    },
    buildRequest: (target) =>
      target.domain
        ? {
            provider: "gong",
            method: "POST",
            path: "/calls/extensive",
            body: {
              filter: { companyIds: [target.domain] },
              contentSelector: { exposedFields: { parties: true } },
            },
          }
        : null,
  },
};

const ENRICHMENT_PROVIDER_IDS = Array.from(
  new Set(Object.values(SLOT_DRIVERS).map((driver) => driver.provider)),
) as ProviderApiId[];

// A second runtime rather than the CRM one: `server/lib/provider-api.ts` is the
// user-facing HubSpot/Salesforce escape hatch, and widening its allow-list would
// let `provider-api-request` reach enrichment vendors it has no business
// reaching. Same app id, so credentials still resolve through the same grants.
const enrichmentRuntime = createProviderApiRuntime({
  appId: CRM_APP_ID,
  providerIds: ENRICHMENT_PROVIDER_IDS,
  localCredentialSource: "crm_workspace_connection",
  getCredentialContext: () => {
    const context = getCredentialContext();
    if (!context) {
      throw new Error(
        "CRM enrichment requires an authenticated request context.",
      );
    }
    return context;
  },
});

/** Seam the tests drive; production binds it to the provider API substrate. */
export interface CrmEnrichmentSlotDeps {
  checkCredential(input: {
    provider: ProviderApiId;
    key: string;
  }): Promise<{ available: boolean; reason: string }>;
  execute(args: ProviderApiRequestArgs): Promise<unknown>;
}

export const providerApiSlotDeps: CrmEnrichmentSlotDeps = {
  checkCredential: async ({ provider, key }) => {
    const context = getCredentialContext();
    if (!context) {
      throw new Error(
        "CRM enrichment requires an authenticated request context.",
      );
    }
    const resolution = await resolveWorkspaceConnectionCredentialForApp({
      appId: CRM_APP_ID,
      provider,
      key,
      userEmail: context.userEmail,
      orgId: context.orgId ?? null,
    });
    // Deliberately does not read `resolution.value` — presence is the question.
    // The resolver's own `reason` names the provider ("no available apollo
    // workspace connection…"), which would put a vendor on the wire; its
    // `status` is a vendor-free enum and carries the same distinction.
    return {
      available: resolution.available,
      reason: resolution.available
        ? resolution.status
        : `No workspace connection backs this slot (${resolution.status}). Grant one to CRM in workspace connection settings.`,
    };
  },
  execute: (args) => enrichmentRuntime.executeRequest(args),
};

/**
 * Whether a slot can be used right now.
 *
 * `unknown` is not a synonym for `missing`: a credential lookup that itself
 * failed tells us nothing about whether the credential exists, and rendering
 * that as "not connected" sends the user to configure something already set up.
 */
export type CrmEnrichmentSlotCredential =
  | { status: "granted" }
  | { status: "missing"; reason: string }
  | { status: "unknown"; error: string };

export interface CrmEnrichmentSlotDescription {
  slot: CrmEnrichmentSlot;
  /** Which pass the slot belongs to: the free evidence pass or the paid one. */
  phase: CrmEnrichmentPhase;
  carriesContactData: boolean;
  /** Normalized fact keys the slot can produce. Never provider field names. */
  factKeys: string[];
  credential: CrmEnrichmentSlotCredential;
}

/** Every slot with its live credential state. Reads nothing, spends nothing. */
export async function describeEnrichmentSlots(
  deps: CrmEnrichmentSlotDeps = providerApiSlotDeps,
): Promise<CrmEnrichmentSlotDescription[]> {
  return Promise.all(
    CRM_ENRICHMENT_SLOTS.map(async (slot) => {
      const driver = SLOT_DRIVERS[slot];
      let credential: CrmEnrichmentSlotCredential;
      try {
        const resolved = await deps.checkCredential({
          provider: driver.provider,
          key: driver.credentialKey,
        });
        credential = resolved.available
          ? { status: "granted" }
          : { status: "missing", reason: resolved.reason };
      } catch (error) {
        credential = { status: "unknown", error: messageOf(error) };
      }
      return {
        slot,
        phase: driver.carriesContactData
          ? ("spend" as const)
          : ("verify" as const),
        carriesContactData: driver.carriesContactData,
        factKeys: Object.keys(driver.factPaths),
        credential,
      };
    }),
  );
}

/**
 * The slots phase A may run: every requested slot that cannot carry contact
 * data. Phase A produces evidence a human approves; it must never be the pass
 * that buys an email, or the approval gate guards nothing.
 */
export function verifySlots(
  requested: readonly CrmEnrichmentSlot[],
): CrmEnrichmentSlot[] {
  return requested.filter((slot) => !SLOT_DRIVERS[slot].carriesContactData);
}

/** The slots phase B pays for: the contact-bearing ones among those requested. */
export function spendSlots(
  requested: readonly CrmEnrichmentSlot[],
): CrmEnrichmentSlot[] {
  return requested.filter((slot) => SLOT_DRIVERS[slot].carriesContactData);
}

export function slotCarriesContactData(slot: CrmEnrichmentSlot): boolean {
  return SLOT_DRIVERS[slot].carriesContactData;
}

/** Value at a dot path, walking objects and numeric array indexes. */
function readPath(body: unknown, path: string): unknown {
  let cursor: unknown = body;
  for (const segment of path.split(".")) {
    if (cursor === null || cursor === undefined) return undefined;
    if (Array.isArray(cursor)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      cursor = cursor[index];
      continue;
    }
    if (typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/**
 * The provider's response body. `executeRequest` wraps it, and the wrapper shape
 * varies by staging options, so unwrap what is there rather than assuming.
 */
function responseBody(response: unknown): unknown {
  if (response && typeof response === "object" && !Array.isArray(response)) {
    const record = response as Record<string, unknown>;
    if ("body" in record) return record.body;
    if ("data" in record) return record.data;
  }
  return response;
}

export function extractSlotFacts(
  slot: CrmEnrichmentSlot,
  response: unknown,
): CrmSlotFact[] {
  const body = responseBody(response);
  const facts: CrmSlotFact[] = [];
  for (const [key, path] of Object.entries(SLOT_DRIVERS[slot].factPaths)) {
    if (facts.length >= MAX_FACTS_PER_SLOT) break;
    const value = readPath(body, path);
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) facts.push({ key, value: trimmed.slice(0, MAX_FACT_CHARS) });
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      facts.push({ key, value });
      continue;
    }
    if (typeof value === "boolean") facts.push({ key, value });
  }
  return facts;
}

/**
 * Run one slot against one record.
 *
 * Never throws for a provider problem — the problem becomes an `error` outcome
 * so a five-record run reports four successes and one preserved failure instead
 * of losing all five. It DOES throw when asked to run a contact-bearing slot in
 * the verification phase: that is a programming error in the caller, and
 * degrading it to an outcome would let phase A quietly spend money.
 */
export async function runEnrichmentSlot(input: {
  slot: CrmEnrichmentSlot;
  target: CrmEnrichmentTarget;
  phase: CrmEnrichmentPhase;
  deps?: CrmEnrichmentSlotDeps;
}): Promise<CrmEnrichmentSlotOutcome> {
  const { slot, target, phase } = input;
  const driver = SLOT_DRIVERS[slot];
  const deps = input.deps ?? providerApiSlotDeps;

  if (phase === "verify" && driver.carriesContactData) {
    throw new Error(
      `Slot "${slot}" carries contact data and cannot run in the verification phase.`,
    );
  }

  let credential: { available: boolean; reason: string };
  try {
    credential = await deps.checkCredential({
      provider: driver.provider,
      key: driver.credentialKey,
    });
  } catch (error) {
    // A credential check that itself failed is NOT "unconfigured" — we do not
    // know whether the credential exists.
    return { slot, status: "error", error: messageOf(error) };
  }
  if (!credential.available) {
    return { slot, status: "unconfigured", reason: credential.reason };
  }

  const request = driver.buildRequest(target);
  if (!request) {
    return {
      slot,
      status: "skipped",
      reason: `Record ${target.recordId} has none of the identifiers this slot resolves against.`,
    };
  }

  try {
    const response = await deps.execute(request);
    const facts = extractSlotFacts(slot, response);
    const observedAt = new Date().toISOString();
    return facts.length === 0
      ? { slot, status: "empty", observedAt }
      : { slot, status: "ok", facts, observedAt };
  } catch (error) {
    return { slot, status: "error", error: messageOf(error) };
  }
}

/** Run a set of slots for one record, concurrently. */
export async function runEnrichmentSlots(input: {
  slots: readonly CrmEnrichmentSlot[];
  target: CrmEnrichmentTarget;
  phase: CrmEnrichmentPhase;
  deps?: CrmEnrichmentSlotDeps;
}): Promise<CrmEnrichmentSlotOutcome[]> {
  return Promise.all(
    input.slots.map((slot) =>
      runEnrichmentSlot({
        slot,
        target: input.target,
        phase: input.phase,
        deps: input.deps,
      }),
    ),
  );
}

/** True when a record produced at least one usable fact worth paying to enrich. */
export function hasVerifiedEvidence(
  outcomes: readonly CrmEnrichmentSlotOutcome[],
): boolean {
  return outcomes.some(
    (outcome) => outcome.status === "ok" && outcome.facts.length > 0,
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
