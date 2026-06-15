import { defineAction } from "@agent-native/core";
import { z } from "zod";
import hubspotDeals from "./hubspot-deals";
import { extractTranscriptText } from "./gong-calls";
import { cliBoolean } from "./schema-helpers";
import {
  getAssociatedHubSpotObjects,
  type HubSpotObjectRecord,
} from "../server/lib/hubspot";
import {
  getCallTranscript,
  searchCallsForQueries,
  type GongCall,
} from "../server/lib/gong";

const TermsSchema = z.preprocess((value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return undefined;
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}, z.array(z.string()).min(1));

const TextMatchSchema = z.enum(["contains", "word", "exact"]);
const DEFAULT_GONG_DAYS = 540;
const DEFAULT_DEAL_LIMIT = 75;
const DEFAULT_CALL_LIMIT = 200;
const DEFAULT_TRANSCRIPT_LIMIT = 200;
const DEFAULT_SNIPPETS_PER_TERM = 5;
const DEFAULT_TRANSCRIPT_MAX_CHARS = 100_000;

type DealRecord = {
  id: string;
  properties: Record<string, unknown>;
};

type TermSource =
  | "deal-name"
  | "deal-company"
  | "company-name"
  | "company-domain"
  | "contact-email"
  | "contact-domain";

type SearchTerm = {
  value: string;
  source: TermSource;
};

type CallWithMatches = GongCall & { matchedQueries?: string[] };

type TranscriptMention = {
  term: string;
  count: number;
  snippets: string[];
};

type CallMention = {
  callId: string;
  title?: string;
  started?: string;
  matchedVia: TermSource[];
  mentions: TranscriptMention[];
  inspectedChars: number;
  transcriptTruncated: boolean;
};

type DealMentionSummary = {
  dealId: string;
  dealName: string;
  companyName: string | null;
  closeDate: string | null;
  amount: string | null;
  pipeline: string | null;
  product: string | null;
  searchTermCount: number;
  matchedCallCount: number;
  inspectedCallCount: number;
  mentionCount: number;
  callsWithMentions: CallMention[];
};

function asDealRecord(value: unknown): DealRecord {
  const record = value as {
    id?: unknown;
    properties?: Record<string, unknown>;
  };
  return {
    id: String(record.id ?? ""),
    properties: record.properties ?? {},
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dealName(deal: DealRecord): string {
  return (
    stringValue(deal.properties.deal_name) ??
    stringValue(deal.properties.dealname) ??
    deal.id
  );
}

function dealCompanyName(deal: DealRecord): string | null {
  return (
    stringValue(deal.properties.company_name) ??
    stringValue(deal.properties.hs_primary_company_name)
  );
}

function dealCloseDate(deal: DealRecord): string | null {
  return stringValue(deal.properties.closedate);
}

function parseDateMs(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function addSearchTerm(
  terms: SearchTerm[],
  seen: Set<string>,
  value: string | null | undefined,
  source: TermSource,
) {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length < 3) return;
  const key = normalizeKey(trimmed);
  if (seen.has(key)) return;
  seen.add(key);
  terms.push({ value: trimmed, source });
}

function contactEmail(record: HubSpotObjectRecord): string | null {
  return stringValue(record.properties.email);
}

function emailDomain(email: string | null): string | null {
  if (!email || !email.includes("@")) return null;
  const domain = email.split("@").pop()?.trim();
  return domain && domain.includes(".") ? domain : null;
}

function companyDomain(record: HubSpotObjectRecord): string | null {
  return stringValue(record.properties.domain);
}

function companyName(record: HubSpotObjectRecord): string | null {
  return stringValue(record.properties.name);
}

async function mapLimit<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, values.length)) },
    async () => {
      while (next < values.length) {
        const index = next;
        next += 1;
        results[index] = await mapper(values[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function loadAssociations(
  deal: DealRecord,
  gaps: string[],
): Promise<{ contacts: HubSpotObjectRecord[]; companies: HubSpotObjectRecord[] }> {
  const load = async (
    toObjectType: "contacts" | "companies",
    limit: number,
  ) => {
    try {
      return await getAssociatedHubSpotObjects({
        fromObjectType: "deals",
        fromObjectId: deal.id,
        toObjectType,
        limit,
      });
    } catch (err) {
      gaps.push(
        `HubSpot deal ${deal.id} ${toObjectType}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }
  };

  const [contacts, companies] = await Promise.all([
    load("contacts", 50),
    load("companies", 10),
  ]);
  return { contacts, companies };
}

function buildDealTerms(input: {
  deal: DealRecord;
  contacts: HubSpotObjectRecord[];
  companies: HubSpotObjectRecord[];
}): SearchTerm[] {
  const terms: SearchTerm[] = [];
  const seen = new Set<string>();
  addSearchTerm(terms, seen, dealName(input.deal), "deal-name");
  addSearchTerm(terms, seen, dealCompanyName(input.deal), "deal-company");
  for (const company of input.companies) {
    addSearchTerm(terms, seen, companyName(company), "company-name");
    addSearchTerm(terms, seen, companyDomain(company), "company-domain");
  }
  for (const contact of input.contacts) {
    const email = contactEmail(contact);
    addSearchTerm(terms, seen, email, "contact-email");
    addSearchTerm(terms, seen, emailDomain(email), "contact-domain");
  }
  return terms;
}

function countMatches(text: string, term: string, mode: z.infer<typeof TextMatchSchema>) {
  if (!text || !term) return 0;
  if (mode === "exact") return text === term ? 1 : 0;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const flags = "gi";
  const regex =
    mode === "word"
      ? new RegExp(`\\b${escaped}\\b`, flags)
      : new RegExp(escaped, flags);
  return Array.from(text.matchAll(regex)).length;
}

function findSnippets(text: string, term: string, maxSnippets: number): string[] {
  if (!text || !term || maxSnippets <= 0) return [];
  const lower = text.toLowerCase();
  const needle = term.toLowerCase();
  const snippets: string[] = [];
  let index = 0;
  while (snippets.length < maxSnippets) {
    const found = lower.indexOf(needle, index);
    if (found === -1) break;
    const start = Math.max(0, found - 140);
    const end = Math.min(text.length, found + term.length + 180);
    const prefix = start > 0 ? "... " : "";
    const suffix = end < text.length ? " ..." : "";
    snippets.push(
      `${prefix}${text.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`,
    );
    index = found + needle.length;
  }
  return snippets;
}

function callStartedMs(call: GongCall): number | null {
  const ms = Date.parse(call.started);
  return Number.isFinite(ms) ? ms : null;
}

function callMatchesDeal(
  call: CallWithMatches,
  terms: SearchTerm[],
): { matched: boolean; sources: TermSource[] } {
  const termSources = new Map<string, Set<TermSource>>();
  for (const term of terms) {
    const key = normalizeKey(term.value);
    if (!termSources.has(key)) termSources.set(key, new Set());
    termSources.get(key)?.add(term.source);
  }
  const sources = new Set<TermSource>();
  for (const query of call.matchedQueries ?? []) {
    for (const source of termSources.get(normalizeKey(query)) ?? []) {
      sources.add(source);
    }
  }
  return { matched: sources.size > 0, sources: Array.from(sources).sort() };
}

function normalizeTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const term of terms) {
    const trimmed = term.trim();
    if (!trimmed) continue;
    const key = normalizeKey(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

export default defineAction({
  description:
    "Search full Gong transcript text for terms across a structured HubSpot deal cohort. " +
    "Use this for questions like whether customers mentioned a phrase/tool/topic across closed-won deals. " +
    "It filters HubSpot deals, loads deal-associated companies/contacts, exhaustively scans Gong call metadata by deal/contact terms, fetches matched post-close transcripts, and returns compact mention snippets plus coverage metadata.",
  schema: z.object({
    terms: TermsSchema.describe(
      "Terms or phrases to search inside transcript text, e.g. 'Figma MCP'. Comma-separated strings are accepted.",
    ),
    termMatch: TextMatchSchema.default("contains").describe(
      "How to match terms in transcript text: contains, word, or exact.",
    ),
    product: z
      .string()
      .optional()
      .describe("Structured HubSpot products field filter, e.g. fusion."),
    productMatch: z.enum(["token", "contains", "exact"]).default("token"),
    pipeline: z
      .string()
      .optional()
      .describe("Structured HubSpot pipeline id or label filter."),
    closedStatus: z.enum(["any", "won", "lost", "closed", "open"]).default("won"),
    closedDateFrom: z
      .string()
      .optional()
      .describe("Inclusive HubSpot close date lower bound, YYYY-MM-DD or ISO."),
    closedDateTo: z
      .string()
      .optional()
      .describe("Inclusive HubSpot close date upper bound, YYYY-MM-DD or ISO."),
    dealLimit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(DEFAULT_DEAL_LIMIT)
      .describe("Maximum HubSpot deals to inspect from the filtered cohort."),
    gongDays: z.coerce
      .number()
      .int()
      .min(7)
      .max(730)
      .default(DEFAULT_GONG_DAYS)
      .describe("Gong lookback window in days for calls matched to deal contacts/companies."),
    gongCallLimit: z.coerce
      .number()
      .int()
      .min(1)
      .max(200)
      .default(DEFAULT_CALL_LIMIT)
      .describe(
        "Maximum matched Gong calls returned from the exhaustive metadata scan. Scanning still exhausts the lookback window before slicing.",
      ),
    maxTranscriptCalls: z.coerce
      .number()
      .int()
      .min(1)
      .max(300)
      .default(DEFAULT_TRANSCRIPT_LIMIT)
      .describe("Maximum matched post-close calls whose transcripts will be fetched and searched."),
    transcriptMaxChars: z.coerce
      .number()
      .int()
      .min(5_000)
      .max(100_000)
      .default(DEFAULT_TRANSCRIPT_MAX_CHARS)
      .describe("Maximum transcript characters to inspect per call."),
    snippetsPerTerm: z.coerce
      .number()
      .int()
      .min(0)
      .max(10)
      .default(DEFAULT_SNIPPETS_PER_TERM)
      .describe("Maximum snippets to return per term per call."),
    includeZeroMentionDeals: cliBoolean
      .default(true)
      .describe("Include deals with inspected calls but zero transcript mentions."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const terms = normalizeTerms(args.terms);
    const gaps: string[] = [];
    const dealResult = (await hubspotDeals.run({
      product: args.product,
      productMatch: args.productMatch,
      pipeline: args.pipeline,
      closedStatus: args.closedStatus,
      closedDateFrom: args.closedDateFrom,
      closedDateTo: args.closedDateTo,
      limit: args.dealLimit,
      properties: [
        "dealname",
        "company_name",
        "hs_primary_company_name",
        "products",
        "closedate",
        "amount",
        "pipeline",
      ],
    },
    })) as { deals?: unknown[]; total?: number; filters?: unknown };

    const deals = (dealResult.deals ?? [])
      .map(asDealRecord)
      .filter((deal) => deal.id);

    const associationBundles = await mapLimit(deals, 5, (deal) =>
      loadAssociations(deal, gaps),
    );

    const dealInputs = deals.map((deal, index) => ({
      deal,
      closeMs: parseDateMs(dealCloseDate(deal)),
      terms: buildDealTerms({
        deal,
        contacts: associationBundles[index]?.contacts ?? [],
        companies: associationBundles[index]?.companies ?? [],
      }),
    }));

    for (const item of dealInputs) {
      if (item.closeMs == null) {
        gaps.push(`HubSpot deal ${item.deal.id} has no parseable close date.`);
      }
      if (!item.terms.length) {
        gaps.push(`HubSpot deal ${item.deal.id} had no usable Gong search terms.`);
      }
    }

    const allSearchTerms = normalizeTerms(
      dealInputs.flatMap((item) => item.terms.map((term) => term.value)),
    );

    const fromCandidates = [
      args.closedDateFrom ? parseDateMs(args.closedDateFrom) : null,
      ...dealInputs.map((item) => item.closeMs),
    ].filter((value): value is number => value != null);
    const earliestCloseMs = fromCandidates.length
      ? Math.min(...fromCandidates)
      : Date.now() - args.gongDays * 24 * 60 * 60 * 1000;
    const fromDateTime = new Date(
      Math.max(
        earliestCloseMs,
        Date.now() - args.gongDays * 24 * 60 * 60 * 1000,
      ),
    ).toISOString();

    const gongResult = allSearchTerms.length
      ? await searchCallsForQueries(allSearchTerms, args.gongDays, args.gongCallLimit, {
          exhaustive: true,
          fromDateTime,
        })
      : {
          calls: [],
          limit: args.gongCallLimit,
          truncated: false,
          searchedCallCount: 0,
          matchedCallCount: 0,
          queryCount: 0,
          coverageTruncated: false,
        };

    const callAssignments = new Map<
      string,
      {
        call: CallWithMatches;
        deals: Array<{ dealId: string; matchedVia: TermSource[] }>;
      }
    >();

    for (const call of gongResult.calls as CallWithMatches[]) {
      const startedMs = callStartedMs(call);
      for (const item of dealInputs) {
        if (item.closeMs != null && startedMs != null && startedMs < item.closeMs) {
          continue;
        }
        const match = callMatchesDeal(call, item.terms);
        if (!match.matched) continue;
        const entry =
          callAssignments.get(call.id) ??
          { call, deals: [] as Array<{ dealId: string; matchedVia: TermSource[] }> };
        entry.deals.push({ dealId: item.deal.id, matchedVia: match.sources });
        callAssignments.set(call.id, entry);
      }
    }

    const assignedCalls = Array.from(callAssignments.values()).sort((left, right) => {
      return (callStartedMs(right.call) ?? 0) - (callStartedMs(left.call) ?? 0);
    });
    const transcriptCandidates = assignedCalls.slice(0, args.maxTranscriptCalls);
    if (assignedCalls.length > transcriptCandidates.length) {
      gaps.push(
        `Transcript inspection capped at ${transcriptCandidates.length} of ${assignedCalls.length} matched post-close calls.`,
      );
    }
    if (gongResult.coverageTruncated) {
      gaps.push(
        `Gong metadata scan reached the provider/page cap after ${gongResult.searchedCallCount} searched calls.`,
      );
    }
    if (gongResult.truncated) {
      gaps.push(
        `Gong returned ${gongResult.calls.length} matched calls from ${gongResult.matchedCallCount} metadata matches; increase gongCallLimit for broader transcript inspection.`,
      );
    }

    const transcriptResults = await mapLimit(
      transcriptCandidates,
      5,
      async (assignment) => {
        try {
          const transcript = await getCallTranscript(assignment.call.id);
          const extracted = extractTranscriptText(
            transcript,
            args.transcriptMaxChars,
          );
          const mentions = terms
            .map((term) => {
              const count = countMatches(extracted.text, term, args.termMatch);
              return {
                term,
                count,
                snippets: count
                  ? findSnippets(extracted.text, term, args.snippetsPerTerm)
                  : [],
              };
            })
            .filter((mention) => mention.count > 0);
          return {
            assignment,
            textLength: extracted.text.length,
            truncated: extracted.truncated,
            mentions,
            error: null as string | null,
          };
        } catch (err) {
          return {
            assignment,
            textLength: 0,
            truncated: false,
            mentions: [] as TranscriptMention[],
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },
    );

    const byDeal = new Map<string, DealMentionSummary>();
    for (const item of dealInputs) {
      byDeal.set(item.deal.id, {
        dealId: item.deal.id,
        dealName: dealName(item.deal),
        companyName: dealCompanyName(item.deal),
        closeDate: dealCloseDate(item.deal),
        amount: stringValue(item.deal.properties.amount),
        pipeline: stringValue(item.deal.properties.pipeline_name) ?? stringValue(item.deal.properties.pipeline),
        product: stringValue(item.deal.properties.products),
        searchTermCount: item.terms.length,
        matchedCallCount: assignedCalls.filter((assignment) =>
          assignment.deals.some((deal) => deal.dealId === item.deal.id),
        ).length,
        inspectedCallCount: 0,
        mentionCount: 0,
        callsWithMentions: [],
      });
    }

    for (const result of transcriptResults) {
      if (result.error) {
        gaps.push(`Gong transcript ${result.assignment.call.id}: ${result.error}`);
        continue;
      }
      for (const dealMatch of result.assignment.deals) {
        const summary = byDeal.get(dealMatch.dealId);
        if (!summary) continue;
        summary.inspectedCallCount += 1;
        const mentionCount = result.mentions.reduce(
          (sum, mention) => sum + mention.count,
          0,
        );
        summary.mentionCount += mentionCount;
        if (mentionCount > 0) {
          summary.callsWithMentions.push({
            callId: result.assignment.call.id,
            title: result.assignment.call.title,
            started: result.assignment.call.started,
            matchedVia: dealMatch.matchedVia,
            mentions: result.mentions,
            inspectedChars: result.textLength,
            transcriptTruncated: result.truncated,
          });
        }
      }
    }

    const dealSummaries = Array.from(byDeal.values()).filter(
      (summary) =>
        args.includeZeroMentionDeals ||
        summary.mentionCount > 0 ||
        summary.matchedCallCount === 0,
    );

    const totalMentions = dealSummaries.reduce(
      (sum, summary) => sum + summary.mentionCount,
      0,
    );
    const dealsWithMentions = dealSummaries.filter(
      (summary) => summary.mentionCount > 0,
    ).length;
    const inspectedTranscriptCount = transcriptResults.filter(
      (result) => !result.error,
    ).length;

    const complete =
      gaps.length === 0 &&
      !gongResult.truncated &&
      assignedCalls.length <= transcriptCandidates.length &&
      transcriptResults.every((result) => !result.error && !result.truncated);

    return {
      terms,
      generatedAt: new Date().toISOString(),
      filters: dealResult.filters ?? {
        product: args.product ?? null,
        pipeline: args.pipeline ?? null,
        closedStatus: args.closedStatus,
        closedDateFrom: args.closedDateFrom ?? null,
        closedDateTo: args.closedDateTo ?? null,
      },
      coverage: {
        complete,
        hubspotDealCount: deals.length,
        hubspotTotal: dealResult.total ?? deals.length,
        gongSearchTermCount: allSearchTerms.length,
        gongSearchedCallCount: gongResult.searchedCallCount,
        gongMatchedCallCount: gongResult.matchedCallCount,
        postCloseMatchedCallCount: assignedCalls.length,
        inspectedTranscriptCount,
        dealsWithMentions,
        totalMentions,
        gaps,
      },
      deals: dealSummaries,
      guidance:
        complete || totalMentions > 0
          ? "Answer from these transcript-search results. Cite coverage and snippets; do not imply raw transcripts were fully quoted."
          : "No transcript mentions were found in the inspected coverage. Because coverage is incomplete when gaps are present, phrase the answer as no mentions found in inspected calls rather than proof the topic never occurred.",
    };
  },
});
