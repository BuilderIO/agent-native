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
            unused_property: null,
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
    expect(result.deals[0].properties).not.toHaveProperty("unused_property");
    expect(JSON.stringify(result).indexOf('"total"')).toBeLessThan(
      JSON.stringify(result).indexOf('"deals"'),
    );
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

  it("serializes deals before lookup maps and trims oversized pages without skipping unseen deals", async () => {
    const deals = Array.from({ length: 30 }, (_, index) => ({
      id: `big-${index}`,
      properties: {
        dealname: `Big deal ${index} ${"x".repeat(3_000)}`,
        dealstage: "closed-lost",
        pipeline: "enterprise-new-business",
        hubspot_owner_id: "owner-1",
      },
    }));
    searchHubSpotObjects.mockResolvedValue({
      records: deals,
      total: 100,
      nextAfter: "30",
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
      limit: 30,
      offset: 60,
    })) as Record<string, any>;

    const json = JSON.stringify(result);
    expect(json.indexOf('"total"')).toBeLessThan(json.indexOf('"deals"'));
    expect(json.indexOf('"nextOffset"')).toBeLessThan(json.indexOf('"deals"'));
    expect(json.indexOf('"deals"')).toBeLessThan(json.indexOf('"stageLabels"'));
    expect(json.indexOf('"deals"')).toBeLessThan(
      json.indexOf('"pipelineLabels"'),
    );
    expect(JSON.stringify(result, null, 2).length).toBeLessThan(50_000);
    expect(result.total).toBe(100);
    expect(result.sizeTrimmed).toBe(true);
    expect(result.deals.length).toBeLessThan(30);
    expect(result.count).toBe(result.deals.length);
    expect(result.hasMore).toBe(true);
    expect(result.nextOffset).toBe(60 + result.deals.length);
  });

  it("keeps the pretty-printed result the agent serializes under its cap", async () => {
    // Compact JSON is ~36k here but the agent's 2-space pretty form is ~66k.
    const deals = Array.from({ length: 30 }, (_, index) => ({
      id: `narrow-${index}`,
      properties: {
        dealname: `Narrow deal ${index}`,
        dealstage: "closed-lost",
        pipeline: "enterprise-new-business",
        ...Object.fromEntries(
          Array.from({ length: 100 }, (_, i) => [`p${i}`, "v"]),
        ),
      },
    }));
    searchHubSpotObjects.mockResolvedValue({
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
    getDealOwners.mockResolvedValue({});

    const result = (await hubspotDeals.run({
      closedStatus: "lost",
      limit: 30,
    })) as Record<string, any>;

    expect(JSON.stringify(result, null, 2).length).toBeLessThan(50_000);
    expect(result.sizeTrimmed).toBe(true);
    expect(result.deals.length).toBeGreaterThan(0);
    expect(result.deals.length).toBeLessThan(30);
    expect(result.nextOffset).toBe(result.deals.length);
  });

  it("refits the deals when the rest of the result pushes the whole past the cap", async () => {
    const deals = Array.from({ length: 30 }, (_, index) => ({
      id: `fat-${index}`,
      properties: {
        dealname: `Fat deal ${index} ${"x".repeat(1_300)}`,
        dealstage: "stage-0",
        pipeline: "enterprise-new-business",
      },
    }));
    searchHubSpotObjects.mockResolvedValue({
      records: deals,
      total: 30,
      nextAfter: null,
      properties: [],
    });
    getDealPipelines.mockResolvedValue([
      {
        id: "enterprise-new-business",
        label: "Enterprise: New Business",
        stages: Array.from({ length: 300 }, (_, i) => ({
          id: `stage-${i}`,
          label: `Stage ${i} ${"s".repeat(30)}`,
          displayOrder: i,
          metadata: { probability: "0.5" },
        })),
      },
    ]);
    getDealOwners.mockResolvedValue({});

    const result = (await hubspotDeals.run({ limit: 30 })) as Record<
      string,
      any
    >;

    expect(JSON.stringify(result, null, 2).length).toBeLessThan(50_000);
    expect(result.sizeTrimmed).toBe(true);
    expect(result.deals.length).toBeGreaterThan(0);
    expect(result.nextOffset).toBe(result.deals.length);
  });

  it("shortens an oversized lone deal instead of returning it past the output cap", async () => {
    searchHubSpotObjects.mockResolvedValue({
      records: [
        {
          id: "huge-1",
          properties: {
            dealname: "Huge deal",
            dealstage: "closed-lost",
            pipeline: "enterprise-new-business",
            description: "d".repeat(100_000),
          },
        },
      ],
      total: 1,
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
    getDealOwners.mockResolvedValue({});

    const result = (await hubspotDeals.run({ closedStatus: "lost" })) as Record<
      string,
      any
    >;

    expect(JSON.stringify(result, null, 2).length).toBeLessThan(50_000);
    expect(result.sizeTrimmed).toBe(true);
    expect(result.count).toBe(1);
    expect(result.deals[0].id).toBe("huge-1");
    expect(result.deals[0].properties.description).toMatch(
      /…\[truncated \d+ chars\]$/,
    );
    expect(result.deals[0].properties.dealname).toBe("Huge deal");
    expect(result.truncatedProperties).toEqual([
      { id: "huge-1", properties: ["description"] },
    ]);
    expect(result.hasMore).toBe(false);
    expect(result.nextOffset).toBeNull();
    expect(result.guidance).toContain("1 property was shortened");
  });

  describe("lone deal that cannot be shortened by prefix", () => {
    const pipelines = [
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
    ];
    const run = async (extra: Record<string, string>, nextAfter = "1") => {
      searchHubSpotObjects.mockResolvedValue({
        records: [
          {
            id: "wide-1",
            properties: {
              dealname: "Wide deal",
              dealstage: "closed-lost",
              pipeline: "enterprise-new-business",
              ...extra,
            },
          },
        ],
        total: 5,
        nextAfter,
        properties: [],
      });
      getDealPipelines.mockResolvedValue(pipelines);
      getDealOwners.mockResolvedValue({});
      return (await hubspotDeals.run({ closedStatus: "lost" })) as Record<
        string,
        any
      >;
    };

    it("terminates and flags many properties sitting exactly at the floor", async () => {
      const props = Object.fromEntries(
        Array.from({ length: 300 }, (_, i) => [`prop_${i}`, "f".repeat(200)]),
      );
      const result = await run(props);

      expect(JSON.stringify(result, null, 2).length).toBeLessThan(50_000);
      expect(result.sizeTrimmed).toBe(true);
      expect(result.deals).toHaveLength(1);
      expect(result.truncatedProperties[0].id).toBe("wide-1");
      expect(result.truncatedProperties[0].properties.length).toBeGreaterThan(
        0,
      );
      expect(result.nextOffset).toBe(1);
    });

    it("fits a deal whose pass-1 prefixes alone stay over budget by replacing them with markers", async () => {
      const props = Object.fromEntries(
        Array.from({ length: 250 }, (_, i) => [`prop_${i}`, "g".repeat(300)]),
      );
      const result = await run(props);

      expect(JSON.stringify(result, null, 2).length).toBeLessThan(50_000);
      expect(result.oversizedDealIds).toBeUndefined();
      expect(result.deals).toHaveLength(1);
      const listed = result.truncatedProperties[0].properties as string[];
      expect(new Set(listed).size).toBe(listed.length);
      expect(listed.length + result.truncatedProperties[0].moreTruncated).toBe(
        250,
      );
    });

    it("keeps the complete result under the cap when ~1,000 properties are truncated", async () => {
      const props = Object.fromEntries(
        Array.from({ length: 950 }, (_, i) => [`p${i}`, "h".repeat(400)]),
      );
      const result = await run(props);

      expect(JSON.stringify(result, null, 2).length).toBeLessThan(50_000);
      expect(result.oversizedDealIds).toBeUndefined();
      expect(result.deals).toHaveLength(1);
      expect(result.truncatedProperties).toHaveLength(1);
      expect(result.truncatedProperties[0].properties).toHaveLength(20);
      expect(result.truncatedProperties[0].moreTruncated).toBe(930);
      expect(result.guidance).toContain("950 properties were shortened");
      expect(result.guidance).not.toContain("p999");
    });

    it("terminates on thousands of short properties and reports the deal as oversized", async () => {
      const props = Object.fromEntries(
        Array.from({ length: 5_000 }, (_, i) => [`p${i}`, "short-value"]),
      );
      const result = await run(props);

      expect(JSON.stringify(result, null, 2).length).toBeLessThan(50_000);
      expect(result.sizeTrimmed).toBe(true);
      expect(result.deals).toEqual([]);
      expect(result.oversizedDealIds).toEqual(["wide-1"]);
      expect(result.nextOffset).toBe(1);
      expect(result.guidance).toContain("provider-api-request");
      expect(result.guidance).toContain("advances past this deal");
    });
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
