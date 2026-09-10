import { describe, expect, it, vi } from "vitest";

// Stub the credential infrastructure so the spec can exercise the pure
// transform functions without dragging in OTel/SQL via the request context.
vi.mock("./credentials", () => ({
  resolveCredential: vi.fn(async () => null),
}));
vi.mock("./credentials-context", () => ({
  requireRequestCredentialContext: vi.fn(() => ({})),
  scopedCredentialCacheKey: (k: string) => k,
}));

const {
  buildAuthHeader,
  parsePanelDescriptor,
  serializePanelDescriptorInput,
  flattenMatrix,
  flattenVector,
  defaultStep,
} = await import("./prometheus");

describe("buildAuthHeader", () => {
  it("returns null when no auth creds are present", () => {
    expect(buildAuthHeader({})).toBeNull();
  });
  it("prefers basic auth when username+password are set", () => {
    const h = buildAuthHeader({
      username: "u",
      password: "p",
      bearer: "ignored",
    });
    expect(h).toBe(`Basic ${Buffer.from("u:p").toString("base64")}`);
  });
  it("falls back to bearer when only token is set", () => {
    expect(buildAuthHeader({ bearer: "t" })).toBe("Bearer t");
  });
  it("ignores partial basic auth (username without password)", () => {
    expect(buildAuthHeader({ username: "u", bearer: "t" })).toBe("Bearer t");
  });
});

describe("parsePanelDescriptor", () => {
  it("accepts a minimal {promql} descriptor", () => {
    const p = parsePanelDescriptor('{"promql":"up"}');
    expect(p.promql).toBe("up");
    expect(p.mode).toBe("range");
  });
  it("rejects missing promql", () => {
    expect(() => parsePanelDescriptor("{}")).toThrow(/promql/);
  });
  it("rejects non-JSON", () => {
    expect(() => parsePanelDescriptor("not json")).toThrow(/JSON/);
  });
  it("accepts mode=instant", () => {
    expect(parsePanelDescriptor('{"promql":"up","mode":"instant"}').mode).toBe(
      "instant",
    );
  });
});

describe("serializePanelDescriptorInput", () => {
  it("keeps serialized descriptors unchanged", () => {
    expect(serializePanelDescriptorInput('{"promql":"up"}')).toBe(
      '{"promql":"up"}',
    );
  });

  it("serializes object descriptors for legacy dashboard configs", () => {
    expect(
      serializePanelDescriptorInput({ promql: "up", mode: "instant" }),
    ).toBe('{"promql":"up","mode":"instant"}');
  });

  it("rejects non-object descriptors", () => {
    expect(() => serializePanelDescriptorInput(null)).toThrow(
      /JSON string or object/,
    );
    expect(() => serializePanelDescriptorInput(["up"])).toThrow(
      /JSON string or object/,
    );
  });
});

describe("defaultStep", () => {
  it("aims for ~250 points across the range", () => {
    expect(defaultStep(3600)).toBe(15); // 1h / 240 ≈ 15s, clamped to minimum
    expect(defaultStep(86400)).toBe(345); // 1d / 250
  });
  it("clamps to 15s minimum", () => {
    expect(defaultStep(60)).toBe(15);
  });
});

describe("flattenMatrix", () => {
  it("turns a matrix response into one row per (timestamp, series)", () => {
    const response = {
      resultType: "matrix",
      result: [
        {
          metric: { __name__: "up", instance: "a" },
          values: [
            [1700000000, "1"],
            [1700000060, "0"],
          ] as [number, string][],
        },
        {
          metric: { __name__: "up", instance: "b" },
          values: [[1700000000, "1"]] as [number, string][],
        },
      ],
    };
    const { rows, schema } = flattenMatrix(response);
    expect(rows).toEqual([
      {
        timestamp: "2023-11-14T22:13:20.000Z",
        series: 'up{instance="a"}',
        value: 1,
      },
      {
        timestamp: "2023-11-14T22:14:20.000Z",
        series: 'up{instance="a"}',
        value: 0,
      },
      {
        timestamp: "2023-11-14T22:13:20.000Z",
        series: 'up{instance="b"}',
        value: 1,
      },
    ]);
    expect(schema).toEqual([
      { name: "timestamp", type: "string" },
      { name: "series", type: "string" },
      { name: "value", type: "number" },
    ]);
  });
  it("returns empty rows for an empty matrix", () => {
    expect(flattenMatrix({ resultType: "matrix", result: [] }).rows).toEqual(
      [],
    );
  });
});

describe("flattenVector", () => {
  it("turns a vector response into one row per series", () => {
    const response = {
      resultType: "vector",
      result: [
        {
          metric: { __name__: "up", instance: "a" },
          value: [1700000000, "1"] as [number, string],
        },
      ],
    };
    const { rows } = flattenVector(response);
    expect(rows).toEqual([
      {
        series: 'up{instance="a"}',
        value: 1,
        timestamp: "2023-11-14T22:13:20.000Z",
      },
    ]);
  });
});

describe("testConnection", () => {
  it("returns ok:true when Prometheus responds with status=success", async () => {
    const { resolveCredential } = await import("./credentials");
    vi.mocked(resolveCredential).mockImplementation(async (key: string) => {
      if (key === "PROMETHEUS_URL") return "http://prom.test";
      return undefined;
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "success", data: [] }), {
        status: 200,
      }),
    );

    const { testConnection } = await import("./prometheus");
    const result = await testConnection();

    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/labels"),
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    fetchSpy.mockRestore();
  });

  it("returns ok:false when Prometheus returns a non-200", async () => {
    const { resolveCredential } = await import("./credentials");
    vi.mocked(resolveCredential).mockImplementation(async (key: string) => {
      if (key === "PROMETHEUS_URL") return "http://prom.test";
      return undefined;
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));

    const { testConnection } = await import("./prometheus");
    const result = await testConnection();

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/401/);
    fetchSpy.mockRestore();
  });

  it("returns ok:false when PROMETHEUS_URL is missing", async () => {
    const { resolveCredential } = await import("./credentials");
    vi.mocked(resolveCredential).mockResolvedValue(undefined);

    const { testConnection } = await import("./prometheus");
    const result = await testConnection();

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/PROMETHEUS_URL/i);
  });
});
