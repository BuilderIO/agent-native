import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  getCallDetail,
  getCallTranscript,
  searchCallsForQueries,
  type GongCall,
} from "../server/lib/gong";
import {
  getAssociatedHubSpotObjects,
  getDealOwners,
  getDealPipelines,
  getVisiblePipelines,
  searchHubSpotObjects,
  stripHubSpotHtml,
  type Deal,
  type HubSpotObjectRecord,
  type Pipeline,
} from "../server/lib/hubspot";
import { extractTranscriptText } from "./gong-calls";
import { cliBoolean } from "./schema-helpers";

const DEFAULT_DEAL_LIMIT = 3;
const DEFAULT_GONG_DAYS = 180;
const DEFAULT_TRANSCRIPT_LIMIT = 5;
const DEFAULT_TRANSCRIPT_MAX_CHARS = 6_000;

const DEAL_DEEP_DIVE_PROPERTIES = [
  "dealname",
  "dealstage",
  "amount",
  "closedate",
  "createdate",
  "hs_lastmodifieddate",
  "pipeline",
  "hubspot_owner_id",
  "company_name",
  "hs_primary_company_name",
  "products",
  "hs_manual_forecast_category",
  "hs_deal_stage_probability",
  "hs_deal_stage_probability_label",
  "closed_lost_reason",
  "hs_closed_lost_reason",
  "closed_lost_detail_reason",
  "notes_last_updated",
  "notes_last_contacted",
  "num_associated_contacts",
  "num_notes",
  "hs_next_step",
  "risk_status",
  "risk_summary",
  "risk_category",
  "risk_status_last_updated",
  "total_contract_value",
  "churn_notes",
  "hs_v2_date_entered_2121599",
  "hs_v2_date_entered_1308211734",
  "hs_v2_date_entered_1308211735",
  "hs_v2_date_entered_1166928645",
];

function stageLookups(pipelines: Pipeline[]) {
  const stageLabels: Record<string, string> = {};
  const pipelineLabels: Record<string, string> = {};

  for (const pipeline of pipelines) {
    pipelineLabels[pipeline.id] = pipeline.label;
    for (const stage of pipeline.stages) {
      stageLabels[stage.id] = stage.label || stage.id;
    }
  }

  return { stageLabels, pipelineLabels };
}

function recordToDeal(record: HubSpotObjectRecord): Deal {
  return {
    id: record.id,
    properties: {
      dealname: record.properties.dealname ?? "",
      dealstage: record.properties.dealstage ?? "",
      amount: record.properties.amount ?? null,
      closedate: record.properties.closedate ?? null,
      createdate: record.properties.createdate ?? "",
      hs_lastmodifieddate: record.properties.hs_lastmodifieddate ?? "",
      pipeline: record.properties.pipeline ?? "",
      hubspot_owner_id: record.properties.hubspot_owner_id ?? null,
      hs_deal_stage_probability:
        record.properties.hs_deal_stage_probability ?? null,
      ...record.properties,
    },
  };
}

function enrichDeal(
  record: HubSpotObjectRecord,
  lookups: ReturnType<typeof stageLookups>,
  owners: Record<string, string>,
) {
  const deal = recordToDeal(record);
  const stageId = String(deal.properties.dealstage ?? "");
  const pipelineId = String(deal.properties.pipeline ?? "");
  const ownerId = String(deal.properties.hubspot_owner_id ?? "");
  return {
    id: deal.id,
    properties: {
      ...deal.properties,
      deal_name: deal.properties.dealname ?? "",
      stage_name: lookups.stageLabels[stageId] ?? stageId,
      pipeline_name: lookups.pipelineLabels[pipelineId] ?? pipelineId,
      owner_name: ownerId ? (owners[ownerId] ?? ownerId) : "",
    },
  };
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function property(record: HubSpotObjectRecord, key: string): string | null {
  const value = record.properties[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeCrmRecord(record: HubSpotObjectRecord): HubSpotObjectRecord {
  const properties: Record<string, string | null | undefined> = {};
  for (const [key, value] of Object.entries(record.properties)) {
    if (typeof value !== "string") {
      properties[key] = value;
      continue;
    }
    const cleaned =
      key.includes("body") || key.includes("text") || key.includes("content")
        ? stripHubSpotHtml(value).slice(0, 1_200)
        : value;
    properties[key] = cleaned;
  }
  return { ...record, properties };
}

async function loadAssociated(
  gaps: string[],
  fromObjectType: "deals" | "companies",
  fromObjectId: string,
  toObjectType: "companies" | "contacts" | "tickets" | "notes" | "emails",
  limit: number,
) {
  try {
    return (
      await getAssociatedHubSpotObjects({
        fromObjectType,
        fromObjectId,
        toObjectType,
        limit,
      })
    ).map(normalizeCrmRecord);
  } catch (err) {
    gaps.push(
      `HubSpot ${fromObjectType}/${fromObjectId} -> ${toObjectType}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return [];
  }
}

function mergeRecords(records: HubSpotObjectRecord[]): HubSpotObjectRecord[] {
  const byId = new Map<string, HubSpotObjectRecord>();
  for (const record of records) {
    if (!byId.has(record.id)) byId.set(record.id, record);
  }
  return Array.from(byId.values());
}

function buildGongSearchQueries(input: {
  query: string;
  deals: ReturnType<typeof enrichDeal>[];
  companies: HubSpotObjectRecord[];
  contacts: HubSpotObjectRecord[];
}): string[] {
  const dealTerms = input.deals.flatMap((deal) => {
    const properties = deal.properties as Record<string, unknown>;
    return [
      String(properties.dealname ?? ""),
      String(properties.company_name ?? ""),
      String(properties.hs_primary_company_name ?? ""),
    ];
  });
  const companyTerms = input.companies.flatMap((company) => [
    property(company, "name"),
    property(company, "domain"),
  ]);
  const contactEmails = input.contacts
    .map((contact) => property(contact, "email"))
    .filter((email): email is string => Boolean(email));
  const contactDomains = contactEmails
    .map((email) => email.split("@")[1])
    .filter((domain): domain is string => Boolean(domain));

  return uniqueStrings([
    input.query,
    ...contactEmails,
    ...contactDomains,
    ...companyTerms,
    ...dealTerms,
  ])
    .filter((term) => term.length >= 3)
    .slice(0, 8);
}

function recordTimestampMs(record: HubSpotObjectRecord) {
  const value =
    property(record, "hs_timestamp") ??
    property(record, "createdate") ??
    record.createdAt ??
    "";
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

async function loadGongEvidence(options: {
  queries: string[];
  days: number;
  gongLimit: number;
  includeTranscripts: boolean;
  transcriptLimit: number;
  transcriptMaxChars: number;
}) {
  const gaps: string[] = [];
  let calls: Array<GongCall & { matchedQueries?: string[] }> = [];
  let searchCoverage: {
    searchedCallCount: number;
    matchedCallCount: number;
    coverageTruncated: boolean;
  } | null = null;

  try {
    const result = await searchCallsForQueries(
      options.queries,
      options.days,
      options.gongLimit,
    );
    calls = result.calls;
    searchCoverage = {
      searchedCallCount: result.searchedCallCount,
      matchedCallCount: result.matchedCallCount,
      coverageTruncated: result.coverageTruncated,
    };
    if (result.coverageTruncated) {
      gaps.push(
        `Gong search scanned ${result.searchedCallCount.toLocaleString()} calls and hit the provider page cap before exhausting the lookback window.`,
      );
    }
  } catch (err) {
    gaps.push(
      `Gong search: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const callDetails = await Promise.all(
    calls.slice(0, Math.min(5, options.gongLimit)).map(async (call) => {
      try {
        return await getCallDetail(call.id);
      } catch (err) {
        gaps.push(
          `Gong call detail ${call.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return null;
      }
    }),
  );

  const transcripts = options.includeTranscripts
    ? await Promise.all(
        calls.slice(0, options.transcriptLimit).map(async (call) => {
          try {
            const transcript = await getCallTranscript(call.id);
            return {
              callId: call.id,
              title: call.title,
              started: call.started,
              ...extractTranscriptText(transcript, options.transcriptMaxChars),
            };
          } catch (err) {
            gaps.push(
              `Gong transcript ${call.id}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
            return {
              callId: call.id,
              title: call.title,
              started: call.started,
              text: "",
              sentenceCount: 0,
              truncated: false,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }),
      )
    : [];

  return {
    calls,
    callDetails: callDetails.filter((detail) => detail !== null),
    transcripts,
    searchCoverage,
    gaps,
  };
}

export default defineAction({
  description:
    "Build a Fusion-quality account/deal deep-dive evidence bundle from HubSpot and Gong in one bounded read-only call. Use this first for named account, customer, deal, opportunity, renewal, risk, or 'deep dive' prompts before synthesizing the answer.",
  schema: z.object({
    query: z
      .string()
      .min(1)
      .describe(
        "Company, account, domain, deal name, or opportunity to inspect.",
      ),
    dealLimit: z.coerce
      .number()
      .int()
      .min(1)
      .max(10)
      .default(DEFAULT_DEAL_LIMIT)
      .describe("Maximum HubSpot deals to inspect (default 3, max 10)."),
    days: z.coerce
      .number()
      .int()
      .min(7)
      .max(730)
      .default(DEFAULT_GONG_DAYS)
      .describe("Gong lookback window in days (default 180)."),
    gongLimit: z.coerce
      .number()
      .int()
      .min(1)
      .max(25)
      .default(10)
      .describe("Maximum matched Gong calls to return (default 10, max 25)."),
    includeTranscripts: cliBoolean
      .default(true)
      .describe(
        "Return compact transcript excerpts for the top matched calls.",
      ),
    transcriptLimit: z.coerce
      .number()
      .int()
      .min(1)
      .max(8)
      .default(DEFAULT_TRANSCRIPT_LIMIT)
      .describe("Maximum matched calls to load transcripts for (default 5)."),
    transcriptMaxChars: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(20_000)
      .default(DEFAULT_TRANSCRIPT_MAX_CHARS)
      .describe("Maximum characters per transcript excerpt (default 6000)."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const trimmedQuery = args.query.trim();
    const gaps: string[] = [];
    const [dealResult, pipelines, owners] = await Promise.all([
      searchHubSpotObjects({
        objectType: "deals",
        query: trimmedQuery,
        properties: DEAL_DEEP_DIVE_PROPERTIES,
        limit: args.dealLimit,
      }),
      getDealPipelines(),
      getDealOwners(),
    ]);

    const lookups = stageLookups(getVisiblePipelines(pipelines));
    const deals = dealResult.records.map((deal) =>
      enrichDeal(deal, lookups, owners),
    );

    const dealCompanies = (
      await Promise.all(
        deals.map((deal) =>
          loadAssociated(gaps, "deals", deal.id, "companies", 5),
        ),
      )
    ).flat();
    let companies = mergeRecords(dealCompanies);
    if (!companies.length) {
      try {
        companies = (
          await searchHubSpotObjects({
            objectType: "companies",
            query: trimmedQuery,
            limit: 5,
          })
        ).records.map(normalizeCrmRecord);
      } catch (err) {
        gaps.push(
          `HubSpot company search: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    const [dealContacts, dealTickets, dealNotes, dealEmails] =
      await Promise.all([
        Promise.all(
          deals.map((deal) =>
            loadAssociated(gaps, "deals", deal.id, "contacts", 25),
          ),
        ),
        Promise.all(
          deals.map((deal) =>
            loadAssociated(gaps, "deals", deal.id, "tickets", 10),
          ),
        ),
        Promise.all(
          deals.map((deal) =>
            loadAssociated(gaps, "deals", deal.id, "notes", 10),
          ),
        ),
        Promise.all(
          deals.map((deal) =>
            loadAssociated(gaps, "deals", deal.id, "emails", 10),
          ),
        ),
      ]);

    const [companyContacts, companyTickets, companyNotes, companyEmails] =
      await Promise.all([
        Promise.all(
          companies.map((company) =>
            loadAssociated(gaps, "companies", company.id, "contacts", 50),
          ),
        ),
        Promise.all(
          companies.map((company) =>
            loadAssociated(gaps, "companies", company.id, "tickets", 15),
          ),
        ),
        Promise.all(
          companies.map((company) =>
            loadAssociated(gaps, "companies", company.id, "notes", 15),
          ),
        ),
        Promise.all(
          companies.map((company) =>
            loadAssociated(gaps, "companies", company.id, "emails", 15),
          ),
        ),
      ]);

    const contacts = mergeRecords([
      ...dealContacts.flat(),
      ...companyContacts.flat(),
    ]);
    const tickets = mergeRecords([
      ...dealTickets.flat(),
      ...companyTickets.flat(),
    ]);
    const notes = mergeRecords([...dealNotes.flat(), ...companyNotes.flat()])
      .sort((a, b) => recordTimestampMs(b) - recordTimestampMs(a))
      .slice(0, 20);
    const emails = mergeRecords([...dealEmails.flat(), ...companyEmails.flat()])
      .sort((a, b) => recordTimestampMs(b) - recordTimestampMs(a))
      .slice(0, 20);

    const gongSearchQueries = buildGongSearchQueries({
      query: trimmedQuery,
      deals,
      companies,
      contacts,
    });
    const gong = await loadGongEvidence({
      queries: gongSearchQueries,
      days: args.days,
      gongLimit: args.gongLimit,
      includeTranscripts: args.includeTranscripts,
      transcriptLimit: args.transcriptLimit,
      transcriptMaxChars: args.transcriptMaxChars,
    });
    gaps.push(...gong.gaps);

    return {
      query: trimmedQuery,
      generatedAt: new Date().toISOString(),
      hubspot: {
        deals,
        companies,
        contacts,
        tickets,
        notes,
        emails,
        searchedDealProperties: dealResult.properties,
      },
      gong: {
        searchQueries: gongSearchQueries,
        calls: gong.calls,
        callDetails: gong.callDetails,
        transcripts: gong.transcripts,
        searchCoverage: gong.searchCoverage,
      },
      coverage: {
        dealCount: deals.length,
        companyCount: companies.length,
        contactCount: contacts.length,
        ticketCount: tickets.length,
        noteCount: notes.length,
        emailCount: emails.length,
        gongCallCount: gong.calls.length,
        transcriptCount: gong.transcripts.length,
        gaps,
      },
      guidance:
        "Synthesize a Fusion-style deal deep dive from this evidence. Include: executive summary, company/deal overview, key contacts and roles, dated timeline, Gong conversation evidence with call dates/titles, current state and risk assessment, likely blockers, recommended next steps, and methodology/gaps. Attribute every claim to HubSpot or Gong evidence and distinguish customer statements from internal notes.",
    };
  },
});
