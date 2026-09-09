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
      ],
      total: 1,
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
      filterGroups: [
        {
          filters: [
            {
              propertyName: "pipeline",
              operator: "IN",
              values: ["pipeline-1"],
            },
          ],
        },
      ],
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
    searchHubSpotObjects.mockResolvedValue({
      records: [
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
      ],
      total: 1,
      nextAfter: null,
      properties: ["dealname", "dealstage", "products", "closedate"],
    });
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

    expect(searchHubSpotObjects).toHaveBeenCalledWith(
      expect.objectContaining({
        objectType: "deals",
        query: undefined,
        after: "0",
        filterGroups: [
          {
            filters: expect.arrayContaining([
              {
                propertyName: "pipeline",
                operator: "IN",
                values: ["enterprise-new-business"],
              },
              {
                propertyName: "products",
                operator: "CONTAINS_TOKEN",
                value: "Publish",
              },
              {
                propertyName: "dealstage",
                operator: "IN",
                values: ["closed-won"],
              },
            ]),
          },
        ],
      }),
    );
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

  it("bounds the structured-filter cohort by limit/offset and reports the true total", async () => {
    const deals = Array.from({ length: 30 }, (_, index) => ({
      id: `lost-${index}`,
      properties: {
        dealname: `Lost deal ${index}`,
        dealstage: "closed-lost",
        amount: "1000",
        closedate: "2026-04-15",
        pipeline: "enterprise-new-business",
        hubspot_owner_id: "owner-1",
        createdate: "2025-12-01T00:00:00Z",
        hs_lastmodifieddate: "2026-05-01T00:00:00Z",
        products: "Publish",
      },
    }));
    searchHubSpotObjects
      .mockResolvedValueOnce({
        records: deals.slice(0, 10),
        total: 30,
        nextAfter: "10",
        properties: [],
      })
      .mockResolvedValueOnce({
        records: deals.slice(20, 30),
        total: 30,
        nextAfter: null,
        properties: [],
      })
      .mockResolvedValueOnce({
        records: deals,
        total: 30,
        nextAfter: null,
        properties: [],
      });
    getDealPipelines.mockResolvedValue([
      {
        id: "enterprise-new-business",
        label: "Enterprise: New Business",
        stages: [
          {
            id: "closed-lost",
            label: "Closed Lost",
            displayOrder: 1,
            metadata: { probability: "0" },
          },
        ],
      },
    ]);
    getDealOwners.mockResolvedValue({ "owner-1": "Alice Seller" });

    const result = (await hubspotDeals.run({
      closedStatus: "lost",
      limit: 10,
    })) as Record<string, any>;

    expect(getAllDeals).not.toHaveBeenCalled();
    expect(searchHubSpotObjects).toHaveBeenCalledWith(
      expect.objectContaining({ after: "0", limit: 10 }),
    );
    expect(result.deals).toHaveLength(10);
    expect(result.count).toBe(10);
    expect(result.total).toBe(30);
    expect(result.truncated).toBe(true);
    expect(result.hasMore).toBe(true);
    expect(result.nextOffset).toBe(10);
    expect(result.guidance).toContain("partial slice");

    // Last page: still only a slice of the cohort (count < total), so
    // `truncated` stays true even though there is no next page.
    const page3 = (await hubspotDeals.run({
      closedStatus: "lost",
      limit: 10,
      offset: 20,
    })) as Record<string, any>;
    expect(page3.deals).toHaveLength(10);
    expect(page3.count).toBe(10);
    expect(page3.total).toBe(30);
    expect(page3.truncated).toBe(true);
    expect(page3.hasMore).toBe(false);
    expect(page3.nextOffset).toBe(null);

    // Whole cohort in one page: not a partial slice.
    const full = (await hubspotDeals.run({
      closedStatus: "lost",
      limit: 50,
    })) as Record<string, any>;
    expect(full.count).toBe(30);
    expect(full.total).toBe(30);
    expect(full.truncated).toBe(false);
    expect(full.hasMore).toBe(false);
    expect(full.nextOffset).toBe(null);
  });

  it("bounds an unfiltered (no query, no filters) call too", async () => {
    const deals = Array.from({ length: 40 }, (_, index) => ({
      id: `deal-${index}`,
      properties: {
        dealname: `Deal ${index}`,
        dealstage: "open",
        amount: "1000",
        closedate: null,
        pipeline: "enterprise-new-business",
        hubspot_owner_id: "owner-1",
        createdate: "2025-12-01T00:00:00Z",
        hs_lastmodifieddate: "2026-05-01T00:00:00Z",
      },
    }));
    searchHubSpotObjects.mockResolvedValue({
      records: deals.slice(0, 25),
      total: 40,
      nextAfter: "25",
      properties: [],
    });
    getDealPipelines.mockResolvedValue([
      {
        id: "enterprise-new-business",
        label: "Enterprise: New Business",
        stages: [
          {
            id: "open",
            label: "Discovery",
            displayOrder: 1,
            metadata: { probability: "0.3" },
          },
        ],
      },
    ]);
    getDealOwners.mockResolvedValue({ "owner-1": "Alice Seller" });

    const result = (await hubspotDeals.run({})) as Record<string, any>;

    expect(getAllDeals).not.toHaveBeenCalled();
    expect(searchHubSpotObjects).toHaveBeenCalledWith(
      expect.objectContaining({ after: "0", limit: 25 }),
    );
    expect(result.count).toBe(25);
    expect(result.total).toBe(40);
    expect(result.truncated).toBe(true);
    expect(result.hasMore).toBe(true);
    expect(result.nextOffset).toBe(25);
  });

  it("reports HubSpot's 10,000-result search ceiling without exposing an invalid next page", async () => {
    searchHubSpotObjects.mockResolvedValue({
      records: [],
      total: 10_000,
      nextAfter: "10000",
      properties: [],
    });
    getDealPipelines.mockResolvedValue([
      {
        id: "enterprise-new-business",
        label: "Enterprise: New Business",
        stages: [],
      },
    ]);
    getDealOwners.mockResolvedValue({});

    const result = (await hubspotDeals.run({
      limit: 200,
      offset: 9_900,
    })) as Record<string, any>;

    expect(searchHubSpotObjects).toHaveBeenCalledWith(
      expect.objectContaining({ after: "9900", limit: 100 }),
    );
    expect(result.searchResultCap).toBe(10_000);
    expect(result.searchCoverageComplete).toBe(false);
    expect(result.searchCoverageLimited).toBe(true);
    expect(result.hasMore).toBe(false);
    expect(result.nextAfter).toBe(null);
    expect(result.nextOffset).toBe(null);
    expect(result.guidance).toContain("non-overlapping closed-date windows");
  });

  it("rejects impossible closed date filter boundaries", async () => {
    await expect(
      hubspotDeals.run({
        closedDateFrom: "2026-02-30",
      }),
    ).rejects.toThrow(/Invalid closedDateFrom/);
  });
});
