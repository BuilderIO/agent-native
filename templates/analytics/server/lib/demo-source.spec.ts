import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearDemoQueryCache,
  DEFAULT_DEMO_PROMETHEUS_URL,
  DEMO_QUERY_CACHE_TTL_MS,
  DEMO_PROMETHEUS_ENV,
  parseDemoDescriptor,
  resolveDemoPrometheusConfig,
  runDemoPanelWithConfig,
  serializeDemoDescriptorInput,
} from "./demo-source";

describe("demo source", () => {
  afterEach(() => {
    clearDemoQueryCache();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("serializes and parses Prometheus panel descriptors", () => {
    const raw = {
      promql: 'up{job="node"}',
      mode: "range",
      range: "1h",
      step: "30s",
    };

    const serialized = serializeDemoDescriptorInput(raw);
    expect(parseDemoDescriptor(serialized)).toEqual(raw);
  });

  it("rejects malformed Prometheus descriptors", () => {
    expect(() => parseDemoDescriptor("not json")).toThrow(
      /demo Prometheus panel sql must be a JSON object/,
    );
    expect(() =>
      parseDemoDescriptor(JSON.stringify({ mode: "instant" })),
    ).toThrow(/promql/);
    expect(() => serializeDemoDescriptorInput(["not", "an", "object"])).toThrow(
      /JSON string or object/,
    );
  });

  it("resolves dedicated demo Prometheus config from non-slot env keys", () => {
    const config = resolveDemoPrometheusConfig({
      [DEMO_PROMETHEUS_ENV.url]: "https://demo-prometheus.example.com/",
      [DEMO_PROMETHEUS_ENV.username]: "demo-user",
      [DEMO_PROMETHEUS_ENV.password]: "demo-password",
      PROMETHEUS_URL: "https://real-prometheus-slot.example.com",
    });

    expect(config).toEqual({
      url: "https://demo-prometheus.example.com",
      username: "demo-user",
      password: "demo-password",
      bearer: undefined,
    });
  });

  it("defaults to the public read-only demo Prometheus endpoint", () => {
    expect(
      resolveDemoPrometheusConfig({
        PROMETHEUS_URL: "https://real-prometheus-slot.example.com",
      }),
    ).toEqual({
      url: DEFAULT_DEMO_PROMETHEUS_URL,
      username: undefined,
      password: undefined,
      bearer: undefined,
    });
  });

  it("runs instant descriptors against the demo endpoint with basic auth", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        status: "success",
        data: {
          resultType: "vector",
          result: [
            {
              metric: { __name__: "up", job: "node", instance: "demo:9100" },
              value: [1781131200, "1"],
            },
          ],
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runDemoPanelWithConfig(
      JSON.stringify({ promql: "up", mode: "instant" }),
      {
        url: "https://demo-prometheus.example.com",
        username: "demo-user",
        password: "demo-password",
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://demo-prometheus.example.com/api/v1/query?query=up",
      {
        headers: {
          Accept: "application/json",
          Authorization: "Basic ZGVtby11c2VyOmRlbW8tcGFzc3dvcmQ=",
        },
      },
    );
    expect(result.rows).toEqual([
      {
        timestamp: "2026-06-10T22:40:00.000Z",
        series: 'up{job="node",instance="demo:9100"}',
        value: 1,
      },
    ]);
  });

  it("runs range descriptors against the demo endpoint", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        status: "success",
        data: {
          resultType: "matrix",
          result: [
            {
              metric: { __name__: "node_load1", instance: "demo:9100" },
              values: [
                [1781131200, "1.2"],
                [1781131260, "1.4"],
              ],
            },
          ],
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runDemoPanelWithConfig(
      JSON.stringify({
        promql: "node_load1",
        mode: "range",
        startTime: "2026-06-10T20:00:00.000Z",
        endTime: "2026-06-10T20:01:00.000Z",
        step: "60s",
      }),
      { url: "https://demo-prometheus.example.com" },
    );

    const fetchCalls = fetchMock.mock.calls as unknown as Array<
      [string, unknown]
    >;
    expect(String(fetchCalls[0][0])).toContain("/api/v1/query_range?");
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({
      timestamp: "2026-06-10T22:40:00.000Z",
      series: 'node_load1{instance="demo:9100"}',
      value: 1.2,
    });
  });

  it("caches successful demo query results for a short TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T20:00:00.000Z"));
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        status: "success",
        data: {
          resultType: "vector",
          result: [
            {
              metric: { __name__: "up" },
              value: [1781131200, "1"],
            },
          ],
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const descriptor = JSON.stringify({ promql: "up", mode: "instant" });
    const config = { url: "https://demo-prometheus.example.com" };

    const first = await runDemoPanelWithConfig(descriptor, config);
    const second = await runDemoPanelWithConfig(descriptor, config);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(DEMO_QUERY_CACHE_TTL_MS + 1);
    await runDemoPanelWithConfig(descriptor, config);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("deduplicates in-flight demo Prometheus requests", async () => {
    let resolveFetch: (value: any) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<any>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const descriptor = JSON.stringify({ promql: "up", mode: "instant" });
    const config = { url: "https://demo-prometheus.example.com" };
    const first = runDemoPanelWithConfig(descriptor, config);
    const second = runDemoPanelWithConfig(descriptor, config);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch?.({
      ok: true,
      json: async () => ({
        status: "success",
        data: {
          resultType: "vector",
          result: [
            {
              metric: { __name__: "up" },
              value: [1781131200, "1"],
            },
          ],
        },
      }),
    });

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
