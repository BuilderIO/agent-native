import { beforeEach, describe, expect, it, vi } from "vitest";

const getAllDeals = vi.fn();
const getDealOwners = vi.fn();
const getDealPipelines = vi.fn();
const getVisiblePipelines = vi.fn((pipelines) => pipelines);
const searchHubSpotObjects = vi.fn();

vi.mock("../server/lib/hubspot", () => ({
  getAllDeals,
  getDealOwners,
  getDealPipelines,
  getVisiblePipelines,
  searchHubSpotObjects,
}));

const { default: hubspotDeals } = await import("./hubspot-deals");

describe("hubspot-deals action", () => {
  beforeEach(() => {
    getAllDeals.mockReset();
    getDealOwners.mockReset();
    getDealPipelines.mockReset();
    getVisiblePipelines.mockClear();
    searchHubSpotObjects.mockReset();
  });

  it("uses targeted HubSpot search for named deal/account queries", async () => {
    searchHubSpotObjects.mockResolvedValue({
      records: [
        {
          id: "deal-1",
          properties: {
            dealname: "The Knot renewal",
            dealstage: "stage-1",
            amount: "250000",
            pipeline: "pipeline-1",
            hubspot_owner_id: "owner-1",
            createdate: "2026-01-01T00:00:00Z",
            hs_lastmodifieddate: "2026-05-01T00:00:00Z",
          },
        },
        {
          id: "deal-hidden",
          properties: {
            dealname: "Hidden renewal",
            dealstage: "stage-hidden",
            amount: "100000",
            pipeline: "pipeline-hidden",
            hubspot_owner_id: "owner-2",
            createdate: "2026-01-01T00:00:00Z",
            hs_lastmodifieddate: "2026-05-01T00:00:00Z",
          },
        },
      ],
      total: 2,
      nextAfter: null,
      properties: ["dealname", "dealstage", "amount", "pipeline"],
    });
    const visiblePipeline = {
      id: "pipeline-1",
      label: "Enterprise",
      stages: [
        {
          id: "stage-1",
          label: "Negotiation",
          displayOrder: 1,
          metadata: { probability: "0.7" },
        },
      ],
    };
    getDealPipelines.mockResolvedValue([
      visiblePipeline,
      {
        id: "pipeline-hidden",
        label: "Hidden",
        stages: [
          {
            id: "stage-hidden",
            label: "Hidden stage",
            displayOrder: 1,
            metadata: { probability: "0.1" },
          },
        ],
      },
    ]);
    getVisiblePipelines.mockReturnValueOnce([visiblePipeline]);
    getDealOwners.mockResolvedValue({ "owner-1": "Alice Seller" });

    const result = (await hubspotDeals.run({
      query: "The Knot",
      limit: 10,
    })) as Record<string, any>;

    expect(getAllDeals).not.toHaveBeenCalled();
    expect(searchHubSpotObjects).toHaveBeenCalledWith({
      objectType: "deals",
      query: "The Knot",
      properties: undefined,
      limit: 10,
      after: undefined,
    });
    expect(result.count).toBe(1);
    expect(result.total).toBe(1);
    expect(result.deals).toHaveLength(1);
    expect(result.deals[0].id).toBe("deal-1");
    expect(result.deals[0].properties.stage_name).toBe("Negotiation");
    expect(result.deals[0].properties.pipeline_name).toBe("Enterprise");
    expect(result.deals[0].properties.owner_name).toBe("Alice Seller");
    expect(result.guidance).toContain("full-text deal search");
  });

  it("filters deal cohorts by structured product, pipeline, closed status, and close date", async () => {
    getAllDeals.mockResolvedValue([
      {
        id: "publish-won",
        properties: {
          dealname: "Browns Shoes",
          dealstage: "closed-won",
          amount: "158000",
          closedate: "2026-02-15",
          pipeline: "enterprise-new-business",
          hubspot_owner_id: "owner-1",
          createdate: "2025-12-01T00:00:00Z",
          hs_lastmodifieddate: "2026-05-01T00:00:00Z",
          products: "Publish;Develop",
        },
      },
      {
        id: "keyword-only",
        properties: {
          dealname: "Publish migration services",
          dealstage: "closed-won",
          amount: "90000",
          closedate: "2026-03-15",
          pipeline: "enterprise-new-business",
          hubspot_owner_id: "owner-1",
          createdate: "2025-12-01T00:00:00Z",
          hs_lastmodifieddate: "2026-05-01T00:00:00Z",
          products: "Develop",
        },
      },
      {
        id: "closed-lost",
        properties: {
          dealname: "Publish lost deal",
          dealstage: "closed-lost",
          amount: "50000",
          closedate: "2026-04-15",
          pipeline: "enterprise-new-business",
          hubspot_owner_id: "owner-1",
          createdate: "2025-12-01T00:00:00Z",
          hs_lastmodifieddate: "2026-05-01T00:00:00Z",
          products: "Publish",
        },
      },
      {
        id: "old-publish-won",
        properties: {
          dealname: "Old Publish win",
          dealstage: "closed-won",
          amount: "40000",
          closedate: "2024-05-15",
          pipeline: "enterprise-new-business",
          hubspot_owner_id: "owner-1",
          createdate: "2024-01-01T00:00:00Z",
          hs_lastmodifieddate: "2024-05-01T00:00:00Z",
          products: "Publish",
        },
      },
    ]);
    getDealPipelines.mockResolvedValue([
      {
        id: "enterprise-new-business",
        label: "Enterprise: New Business",
        stages: [
          {
            id: "closed-won",
            label: "Closed Won",
            displayOrder: 1,
            metadata: { probability: "1" },
          },
          {
            id: "closed-lost",
            label: "Closed Lost",
            displayOrder: 2,
            metadata: { probability: "0" },
          },
        ],
      },
    ]);
    getDealOwners.mockResolvedValue({ "owner-1": "Alice Seller" });

    const result = (await hubspotDeals.run({
      product: "Publish",
      pipeline: "New Business",
      closedStatus: "won",
      closedDateFrom: "2025-06-01",
      closedDateTo: "2026-06-01",
    })) as Record<string, any>;

    expect(searchHubSpotObjects).not.toHaveBeenCalled();
    expect(result.count).toBe(1);
    expect(result.deals.map((deal: any) => deal.id)).toEqual(["publish-won"]);
    expect(result.deals[0].properties.is_closed_won).toBe(true);
    expect(result.filters).toEqual({
      products: "Publish",
      productMatch: "token",
      pipeline: "New Business",
      closedStatus: "won",
      closedDateFrom: "2025-06-01",
      closedDateTo: "2026-06-01",
    });
    expect(result.guidance).toContain("Structured filters were applied");
  });

  it("rejects impossible closed date filter boundaries", async () => {
    await expect(
      hubspotDeals.run({
        closedDateFrom: "2026-02-30",
      }),
    ).rejects.toThrow(/Invalid closedDateFrom/);
  });
});
