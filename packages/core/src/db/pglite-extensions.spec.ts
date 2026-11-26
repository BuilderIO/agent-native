import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type PgliteGlobals = {
  __agentNativePgliteExtensions?: unknown;
  __agentNativePgliteClientCreated?: boolean;
};

const globals = process as unknown as PgliteGlobals;

const testExtension = {
  name: "test_ext",
  setup: async () => ({
    namespaceObj: { hello: () => "hello from test_ext" },
  }),
};

describe("configurePgliteExtensions", () => {
  let dir: string;

  beforeEach(async () => {
    vi.resetModules();
    delete globals.__agentNativePgliteExtensions;
    delete globals.__agentNativePgliteClientCreated;
    dir = await mkdtemp(path.join(os.tmpdir(), "pglite-ext-"));
  });

  afterEach(async () => {
    const client = await import("./client.js");
    await client.closeDbExec();
    delete globals.__agentNativePgliteExtensions;
    delete globals.__agentNativePgliteClientCreated;
    await rm(dir, { recursive: true, force: true });
  });

  it("passes registered extensions to the shared PGlite client", async () => {
    const client = await import("./client.js");
    client.configurePgliteExtensions({ test_ext: testExtension });

    const pg = await client.getPgliteClient(`pglite:${dir}`);

    expect(pg.test_ext.hello()).toBe("hello from test_ext");
  });

  it("rejects registration after a client has been created", async () => {
    const client = await import("./client.js");
    await client.getPgliteClient(`pglite:${dir}`);

    expect(() =>
      client.configurePgliteExtensions({ test_ext: testExtension }),
    ).toThrow(/already exists/);
  });

  it("leaves the client unchanged when no extensions are configured", async () => {
    const client = await import("./client.js");

    const pg = await client.getPgliteClient(`pglite:${dir}`);

    expect(pg.test_ext).toBeUndefined();
    const { rows } = await pg.query("SELECT 1 AS one");
    expect(rows).toEqual([{ one: 1 }]);
  });
});
