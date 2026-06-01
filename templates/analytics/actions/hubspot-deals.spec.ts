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
    expect(result.guidance).toContain("Searched HubSpot deals directly");
  });
});
