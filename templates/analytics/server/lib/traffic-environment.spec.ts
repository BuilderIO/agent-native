import { createRequire } from "node:module";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  trafficEnvironmentOfHost,
  type TrafficEnvironment,
} from "../../shared/traffic-environment";
import { trafficEnvironmentCondition, urlHostSql } from "./traffic-environment";

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
