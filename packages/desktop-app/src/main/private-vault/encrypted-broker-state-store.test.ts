import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EncryptedBrokerStateStore } from "./encrypted-broker-state-store.js";

const roots: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(available = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), "anc-broker-state-"));
  roots.push(root);
  const directory = path.join(root, "state");
  const store = new EncryptedBrokerStateStore({
    directory,
    cipher: {
      available: () => available,
      seal: (value) =>
        Uint8Array.from([0xa1, ...value.map((byte) => byte ^ 0x5a)]),
      open: (value) => Uint8Array.from(value.slice(1), (byte) => byte ^ 0x5a),
    },
  });
  return { store, directory };
}

describe("encrypted broker state store", () => {
  it("persists only cipher output and returns owned plaintext copies", async () => {
    const { store, directory } = await fixture();
    await store.initialize();
    const value = new TextEncoder().encode('{"outcome":"idle"}');
    await store.write("broker-supervisor", "worker-checkpoint", value);
    expect(
      await readFile(
        path.join(directory, "broker-supervisor--worker-checkpoint.enc"),
        "utf8",
      ),
    ).not.toContain("outcome");
    const recovered = await store.read(
      "broker-supervisor",
      "worker-checkpoint",
    );
    expect(recovered).toEqual(value);
    expect(recovered).not.toBe(value);
    await store.close();
  });

  it("fails closed without OS encryption or for path-shaped keys", async () => {
    const unavailable = await fixture(false);
    await expect(unavailable.store.initialize()).rejects.toThrow();

    const { store } = await fixture();
    await store.initialize();
    await expect(
      store.write("../vault", "key", Uint8Array.of(1)),
    ).rejects.toThrow();
  });
});
