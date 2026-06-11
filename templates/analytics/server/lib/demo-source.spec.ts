import { describe, expect, it } from "vitest";
import {
  parseDemoDescriptor,
  runDemoPanelAt,
  serializeDemoDescriptorInput,
} from "./demo-source";

const NOW = new Date("2026-06-10T12:00:00.000Z");

describe("demo source", () => {
  it("serializes and parses fixed-query descriptors", () => {
    const raw = {
      adapter: "prometheus",
      dataset: "node-exporter",
      query: "cpu-busy-by-mode",
      mode: "range",
      params: { instance: "demo-host-02" },
    };

    const serialized = serializeDemoDescriptorInput(raw);
    expect(parseDemoDescriptor(serialized)).toEqual(raw);
  });

  it("rejects malformed descriptors", () => {
    expect(() => parseDemoDescriptor("not json")).toThrow(
      /demo panel sql must be a JSON object/,
    );
    expect(() =>
      parseDemoDescriptor(
        JSON.stringify({
          adapter: "prometheus",
          dataset: "node-exporter",
        }),
      ),
    ).toThrow(/query/);
    expect(() => serializeDemoDescriptorInput(["not", "an", "object"])).toThrow(
      /JSON string or object/,
    );
  });

  it("routes only supported adapter and dataset combinations", () => {
    expect(() =>
      runDemoPanelAt(
        JSON.stringify({
          adapter: "postgres",
          dataset: "node-exporter",
          query: "database-health",
        }),
        NOW,
      ),
    ).toThrow(/requires dataset "postgres-saas"/);

    expect(() =>
      runDemoPanelAt(
        JSON.stringify({
          adapter: "events",
          dataset: "product-analytics",
          query: "arbitrary-sql",
        }),
        NOW,
      ),
    ).toThrow(/Unknown product-analytics demo query/);
  });

  it("returns deterministic Prometheus-shaped range rows", () => {
    const query = JSON.stringify({
      adapter: "prometheus",
      dataset: "node-exporter",
      query: "cpu-busy-by-mode",
      mode: "range",
      params: { instance: "demo-host-01" },
    });

    const first = runDemoPanelAt(query, NOW);
    const second = runDemoPanelAt(query, NOW);

    expect(first).toEqual(second);
    expect(first.schema).toEqual([
      { name: "timestamp", type: "string" },
      { name: "series", type: "string" },
      { name: "value", type: "number" },
    ]);
    expect(first.rows).toHaveLength(72);
    expect(first.rows[0]).toEqual(
      expect.objectContaining({
        timestamp: expect.stringMatching(/^2026-06-10T/),
        series: expect.stringContaining(
          'node_cpu_seconds_total{instance="demo-host-01"',
        ),
        value: expect.any(Number),
      }),
    );
  });

  it("returns bounded postgres demo rows", () => {
    const result = runDemoPanelAt(
      JSON.stringify({
        adapter: "postgres",
        dataset: "postgres-saas",
        query: "slow-queries",
      }),
      NOW,
    );

    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.length).toBeLessThanOrEqual(10);
    expect(result.schema.map((field) => field.name)).toEqual([
      "query",
      "calls",
      "meanMs",
      "p95Ms",
    ]);
    expect(result.rows[0]).toEqual(
      expect.objectContaining({
        query: expect.any(String),
        calls: expect.any(Number),
        meanMs: expect.any(Number),
        p95Ms: expect.any(Number),
      }),
    );
  });

  it("returns product analytics event/session rows", () => {
    const result = runDemoPanelAt(
      JSON.stringify({
        adapter: "events",
        dataset: "product-analytics",
        query: "activation-funnel",
      }),
      NOW,
    );

    expect(result.rows).toEqual([
      { stage: "Visited", users: 42000 },
      { stage: "Started demo", users: 12300 },
      { stage: "Created workspace", users: 4100 },
      { stage: "Connected source", users: 1760 },
      { stage: "Saved dashboard", users: 980 },
    ]);
    expect(result.schema).toEqual([
      { name: "stage", type: "string" },
      { name: "users", type: "number" },
    ]);
  });
});
