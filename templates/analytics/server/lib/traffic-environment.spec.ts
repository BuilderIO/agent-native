import { createRequire } from "node:module";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  trafficEnvironmentOfHost,
  type TrafficEnvironment,
} from "../../shared/traffic-environment";
import {
  readTrafficCounts,
  trafficCountsSql,
  trafficEnvironmentCondition,
  unknownTrafficCondition,
  trafficEnvironmentOfRow,
  urlHostSql,
} from "./traffic-environment";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");

describe("trafficEnvironmentCondition", () => {
  let client: Awaited<ReturnType<typeof PGlite.create>>;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    client = await PGlite.create();
    db = drizzle(client);
    await client.query(`
      CREATE TABLE rows (id text, host text, url text, property text)
    `);
  });

  afterAll(async () => {
    await client.close();
  });

  async function insert(
    rows: Array<{
      id: string;
      host?: string;
      url?: string;
      property?: string;
    }>,
  ) {
    await client.query("DELETE FROM rows");
    for (const row of rows) {
      await client.query("INSERT INTO rows VALUES ($1, $2, $3, $4)", [
        row.id,
        row.host ?? null,
        row.url ?? null,
        row.property ?? null,
      ]);
    }
  }

  async function idsIn(
    environment: TrafficEnvironment,
    columns: Parameters<typeof trafficEnvironmentCondition>[1],
  ): Promise<string[]> {
    const result = await db.execute(
      sql`select id from rows where ${trafficEnvironmentCondition(environment, columns)} order by id`,
    );
    return (result.rows as Array<{ id: string }>).map((row) => row.id);
  }

  it("agrees with the host check the badge uses", async () => {
    const hosts = [
      "beta.slides.agent-native.com",
      "BETA.slides.agent-native.com",
      "localhost",
      "slides.localhost",
      "127.0.0.1",
      "0.0.0.0",
      "[::1]",
      "machine.local",
      "slides.test",
      "preview-8730--an-slides.netlify.app",
      "slides.agent-native.com",
      "www.agent-native.com",
      "app.customer.example",
      "betamax.example",
      "my.beta.example",
      "localhost.example",
      "netlify.app.example",
    ];
    await insert(hosts.map((host) => ({ id: host, host })));

    const beta = await idsIn("beta", { host: sql`host` });
    const production = await idsIn("production", { host: sql`host` });

    expect(beta.sort()).toEqual(
      hosts.filter((host) => trafficEnvironmentOfHost(host) === "beta").sort(),
    );
    expect(production.sort()).toEqual(
      hosts
        .filter((host) => trafficEnvironmentOfHost(host) === "production")
        .sort(),
    );
  });

  it("gives the same answer for a row in hand as the SQL does", async () => {
    const rows = [
      { id: "a", url: "https://beta.slides.agent-native.com/deck?x=1" },
      { id: "b", url: "https://slides.agent-native.com:8443/deck" },
      { id: "c", url: "http://[::1]:3000/" },
      { id: "d", url: "/relative/path", property: "beta" },
      { id: "e", url: "/relative/path", property: "production" },
      { id: "f", url: "", property: "PREVIEW" },
      { id: "g", property: "test" },
      { id: "h" },
      { id: "i", url: "https://slides.agent-native.com/", property: "beta" },
    ];
    await insert(rows);
    const columns = { host: urlHostSql(sql`url`), property: sql`property` };

    const beta = await idsIn("beta", columns);

    expect(beta.sort()).toEqual(
      rows
        .filter(
          (row) =>
            trafficEnvironmentOfRow(row.url ?? null, row.property ?? null) ===
            "beta",
        )
        .map((row) => row.id)
        .sort(),
    );
    expect(beta.sort()).toEqual(["a", "c", "d", "f", "g"]);
  });

  it("counts a row with no host as production", async () => {
    await insert([{ id: "null" }, { id: "empty", host: "" }]);

    expect(await idsIn("production", { host: sql`host` })).toEqual([
      "empty",
      "null",
    ]);
    expect(await idsIn("beta", { host: sql`host` })).toEqual([]);
  });

  it("lets a property decide only when there is no host", async () => {
    await insert([
      { id: "a-no-host-beta", property: "beta" },
      { id: "b-no-host-preview", property: "preview" },
      { id: "c-no-host-local", property: "LOCAL" },
      { id: "d-no-host-development", property: "development" },
      { id: "e-no-host-production", property: "production" },
      { id: "f-no-host-other", property: "staging" },
      { id: "g-nothing" },
      {
        id: "h-production-host-beta-property",
        host: "slides.agent-native.com",
        property: "beta",
      },
      {
        id: "i-beta-host-production-property",
        host: "beta.slides.agent-native.com",
        property: "production",
      },
    ]);
    const columns = { host: sql`host`, property: sql`property` };

    expect(await idsIn("beta", columns)).toEqual([
      "a-no-host-beta",
      "b-no-host-preview",
      "c-no-host-local",
      "d-no-host-development",
      "i-beta-host-production-property",
    ]);
    expect(await idsIn("production", columns)).toEqual([
      "e-no-host-production",
      "f-no-host-other",
      "g-nothing",
      "h-production-host-beta-property",
    ]);
  });

  it("counts as unknown only rows with no host and no known environment", async () => {
    await insert([
      { id: "a-no-host" },
      { id: "b-empty-host", host: "" },
      { id: "c-unrecognized", property: "staging" },
      { id: "d-marked-production", property: "production" },
      { id: "e-marked-beta", property: "BETA" },
      { id: "f-host", host: "slides.agent-native.com" },
      { id: "g-beta-host", host: "beta.slides.agent-native.com" },
    ]);

    const result = await db.execute(
      sql`select id from rows where ${unknownTrafficCondition({
        host: sql`host`,
        property: sql`property`,
      })} order by id`,
    );

    expect((result.rows as Array<{ id: string }>).map((row) => row.id)).toEqual(
      ["a-no-host", "b-empty-host", "c-unrecognized"],
    );
  });

  it("reads the host out of a URL", async () => {
    await insert([
      { id: "a-beta", url: "https://beta.slides.agent-native.com/deck?x=1" },
      { id: "b-beta-port", url: "http://localhost:8080/deck" },
      { id: "c-beta-ipv6", url: "http://[::1]:8080/deck" },
      { id: "d-production", url: "https://slides.agent-native.com/deck" },
      { id: "e-beta-in-path", url: "https://slides.example/beta.example/" },
      { id: "f-relative", url: "/deck" },
      { id: "g-relative-beta-property", url: "/deck", property: "beta" },
      { id: "h-none" },
    ]);
    const columns = {
      host: urlHostSql(sql`url`),
      property: sql`property`,
    };

    expect(await idsIn("beta", columns)).toEqual([
      "a-beta",
      "b-beta-port",
      "c-beta-ipv6",
      "g-relative-beta-property",
    ]);
    expect(await idsIn("production", columns)).toEqual([
      "d-production",
      "e-beta-in-path",
      "f-relative",
      "h-none",
    ]);
  });
});

describe("trafficCountsSql", () => {
  it("binds nothing and leaves out what the events model lacks", () => {
    const counts = trafficCountsSql("2026-10-28");

    expect(counts).toContain("event_date >= '2026-10-28'");
    expect(counts).toContain("event_name <> 'http.response'");
    expect(counts).not.toMatch(/\$\d/);
  });
});

describe("readTrafficCounts", () => {
  it("reads no events as zero", () => {
    expect(
      readTrafficCounts([
        { production_events: null, beta_events: null, unknown_events: null },
      ]),
    ).toEqual({ production: 0, beta: 0, unknown: 0 });
  });

  it("refuses a result that isn't one row", () => {
    expect(() => readTrafficCounts([])).toThrow("did not return one row");
  });
});
