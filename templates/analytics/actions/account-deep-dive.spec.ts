import { beforeEach, describe, expect, it, vi } from "vitest";

const searchHubSpotObjects = vi.fn();
const getDealPipelines = vi.fn();
const getDealOwners = vi.fn();
const getVisiblePipelines = vi.fn();
const getAssociatedHubSpotObjects = vi.fn();
const searchCallsForQueries = vi.fn();
const getCallDetail = vi.fn();
const getCallTranscript = vi.fn();

vi.mock("../server/lib/hubspot", () => ({
  getAssociatedHubSpotObjects,
  getDealOwners,
  getDealPipelines,
  getVisiblePipelines,
  searchHubSpotObjects,
  stripHubSpotHtml: (value: string) =>
    value
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim(),
}));

vi.mock("../server/lib/gong", () => ({
  getCallDetail,
  getCallTranscript,
  searchCallsForQueries,
}));

const { default: accountDeepDive } = await import("./account-deep-dive");

const dealRecord = {
  id: "deal-1",
  properties: {
    dealname: "The Knot Worldwide - New Business",
    dealstage: "stage-pov",
    amount: "69300",
    closedate: "2026-07-20",
    createdate: "2026-01-30T00:00:00Z",
    hs_lastmodifieddate: "2026-05-26T00:00:00Z",
    pipeline: "pipeline-enterprise",
    hubspot_owner_id: "42",
    company_name: "The Knot Worldwide",
    hs_primary_company_name: "The Knot Worldwide",
    products: "Publish",
    hs_next_step: "Re-engage procurement",
  },
};

const companyRecord = {
  id: "company-1",
  properties: {
    name: "The Knot Worldwide",
    domain: "theknotww.com",
    industry: "Consumer Services",
    numberofemployees: "2000",
  },
};

const contactRecord = {
  id: "contact-1",
  properties: {
    firstname: "Susan",
    lastname: "Cunningham",
    email: "susan@theknotww.com",
    jobtitle: "Lead Engineer",
  },
};

function setupHappyPath() {
  searchHubSpotObjects.mockResolvedValue({
    records: [dealRecord],
    total: 1,
    properties: ["dealname", "dealstage", "amount"],
  });
  getDealPipelines.mockResolvedValue([
    {
      id: "pipeline-enterprise",
      label: "Enterprise",
      stages: [{ id: "stage-pov", label: "S2 - POV Active" }],
    },
  ]);
  getVisiblePipelines.mockImplementation((pipelines) => pipelines);
  getDealOwners.mockResolvedValue({ "42": "Ari AE" });
  getAssociatedHubSpotObjects.mockImplementation(async (args) => {
    if (args.toObjectType === "companies") return [companyRecord];
    if (args.toObjectType === "contacts") return [contactRecord];
    if (args.toObjectType === "tickets") {
      return [
        {
          id: "ticket-1",
          properties: {
            subject: "POC support",
            content: "POC met all acceptance criteria.",
          },
        },
      ];
    }
    if (args.toObjectType === "notes") {
      return [
        {
          id: "note-1",
          properties: {
            hs_timestamp: "2026-04-16T00:00:00Z",
            hs_note_body: "<p>VP of Marketing gave a verbal green light.</p>",
          },
        },
      ];
    }
    if (args.toObjectType === "emails") {
      return [
        {
          id: "email-1",
          properties: {
            hs_timestamp: "2026-05-26T00:00:00Z",
            hs_email_text:
              "<div>No response yet after procurement follow-up.</div>",
          },
        },
      ];
    }
    return [];
  });
  searchCallsForQueries.mockResolvedValue({
    calls: [
      {
        id: "call-1",
        title: "The Knot Worldwide POC readout",
        started: "2026-03-27T17:00:00Z",
        matchedQueries: ["theknotww.com"],
      },
    ],
    limit: 3,
    truncated: false,
    searchedCallCount: 1,
    matchedCallCount: 1,
    queryCount: 3,
    coverageTruncated: false,
  });
  getCallDetail.mockResolvedValue({
    id: "call-1",
    title: "The Knot Worldwide POC readout",
    url: "https://gong.example/call-1",
    started: "2026-03-27T17:00:00Z",
    duration: 1800,
    parties: [{ name: "Susan Cunningham", affiliation: "External" }],
    brief: "Successful POC readout.",
    keyPoints: ["They have what they need."],
    outline: ["POC validation", "Procurement next steps"],
  });
  getCallTranscript.mockResolvedValue({
    callTranscripts: [
      {
        callId: "call-1",
        transcript: [
          {
            speakerId: "buyer",
            sentences: [
              { start: 0, text: "I think we have what we need." },
              { start: 1500, text: "Procurement can move after approval." },
            ],
          },
        ],
      },
    ],
  });
}

describe("account-deep-dive action", () => {
  beforeEach(() => {
    searchHubSpotObjects.mockReset();
    getDealPipelines.mockReset();
    getDealOwners.mockReset();
    getVisiblePipelines.mockReset();
    getAssociatedHubSpotObjects.mockReset();
    searchCallsForQueries.mockReset();
    getCallDetail.mockReset();
    getCallTranscript.mockReset();
    setupHappyPath();
  });

  it("builds a Fusion-style evidence bundle across HubSpot associations and Gong", async () => {
    const result = (await accountDeepDive.run({
      query: "The Knot",
      dealLimit: 1,
      days: 180,
      gongLimit: 3,
      includeTranscripts: true,
      transcriptLimit: 1,
      transcriptMaxChars: 5_000,
    })) as Record<string, any>;

    expect(searchHubSpotObjects).toHaveBeenCalledWith(
      expect.objectContaining({
        objectType: "deals",
        query: "The Knot",
        limit: 1,
        properties: expect.arrayContaining([
          "dealname",
          "products",
          "hs_next_step",
        ]),
      }),
    );
    expect(getAssociatedHubSpotObjects).toHaveBeenCalledWith(
      expect.objectContaining({
        fromObjectType: "deals",
        fromObjectId: "deal-1",
        toObjectType: "companies",
      }),
    );
    expect(getAssociatedHubSpotObjects).toHaveBeenCalledWith(
      expect.objectContaining({
        fromObjectType: "companies",
        fromObjectId: "company-1",
        toObjectType: "contacts",
      }),
    );
    expect(searchCallsForQueries).toHaveBeenCalledWith(
      expect.arrayContaining(["susan@theknotww.com", "theknotww.com"]),
      180,
      3,
    );
    expect(getCallDetail).toHaveBeenCalledWith("call-1");
    expect(getCallTranscript).toHaveBeenCalledWith("call-1");

    expect(result.hubspot.deals[0].properties.stage_name).toBe(
      "S2 - POV Active",
    );
    expect(result.hubspot.deals[0].properties.owner_name).toBe("Ari AE");
    expect(result.hubspot.companies).toHaveLength(1);
    expect(result.hubspot.contacts).toHaveLength(1);
    expect(result.hubspot.notes[0].properties.hs_note_body).toBe(
      "VP of Marketing gave a verbal green light.",
    );
    expect(result.gong.searchQueries).toContain("susan@theknotww.com");
    expect(result.gong.searchQueries).toContain("theknotww.com");
    expect(result.gong.searchCoverage).toEqual({
      searchedCallCount: 1,
      matchedCallCount: 1,
      coverageTruncated: false,
    });
    expect(result.gong.callDetails[0].keyPoints).toContain(
      "They have what they need.",
    );
    expect(result.gong.transcripts[0].text).toContain(
      "Procurement can move after approval.",
    );
    expect(result.coverage).toMatchObject({
      dealCount: 1,
      companyCount: 1,
      contactCount: 1,
      gongCallCount: 1,
      transcriptCount: 1,
      gaps: [],
    });
    expect(result.guidance).toContain("Fusion-style deal deep dive");
  });

  it("honors string false for transcript loading from GET query params", async () => {
    const result = (await accountDeepDive.run({
      query: "The Knot",
      dealLimit: 1,
      days: 180,
      gongLimit: 3,
      includeTranscripts: "false",
      transcriptLimit: 1,
      transcriptMaxChars: 5_000,
    })) as Record<string, any>;

    expect(getCallTranscript).not.toHaveBeenCalled();
    expect(result.gong.transcripts).toEqual([]);
  });

  it("degrades gracefully with a gap when pipelines and owners lookups fail", async () => {
    getDealPipelines.mockRejectedValue(new Error("pipelines endpoint down"));
    getDealOwners.mockRejectedValue(new Error("owners endpoint down"));

    const result = (await accountDeepDive.run({
      query: "The Knot",
      dealLimit: 1,
      days: 180,
      gongLimit: 3,
      includeTranscripts: true,
      transcriptLimit: 1,
      transcriptMaxChars: 5_000,
    })) as Record<string, any>;

    expect(result.hubspot.deals[0].properties.stage_name).toBe("stage-pov");
    expect(result.hubspot.deals[0].properties.owner_name).toBe("42");
    expect(result.coverage.gaps).toEqual(
      expect.arrayContaining([
        "HubSpot deal pipelines: pipelines endpoint down",
        "HubSpot deal owners: owners endpoint down",
      ]),
    );
    expect(result.hubspot.deals).toHaveLength(1);
  });

  it("surfaces a contextual error when the primary deal search fails", async () => {
    searchHubSpotObjects.mockRejectedValue(new Error("HubSpot 500"));

    await expect(
      accountDeepDive.run({
        query: "The Knot",
        dealLimit: 1,
        days: 180,
        gongLimit: 3,
        includeTranscripts: true,
        transcriptLimit: 1,
        transcriptMaxChars: 5_000,
      }),
    ).rejects.toThrow('HubSpot deal search failed for "The Knot": HubSpot 500');
  });
});
