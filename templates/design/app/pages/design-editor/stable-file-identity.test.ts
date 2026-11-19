import { describe, expect, it } from "vitest";

import { SourceHydration } from "./source-hydration";
import {
  buildById,
  hydrateDesignFiles,
  type IdentityCache,
} from "./stable-file-identity";
import type { DesignFile, DesignFileMetadata } from "./types";

const metadata: DesignFileMetadata[] = Array.from({ length: 6 }, (_, i) => ({
  id: `f${i}`,
  filename: `screen-${i}.html`,
  fileType: "html",
  createdAt: null,
  updatedAt: "1",
}));

function setup() {
  const read = (id: string) =>
    Promise.resolve({ content: `<p>${id}</p>`, updatedAt: "1" });
  const loader = new SourceHydration(read, () => {});
  loader.sync(metadata);
  const cache: IdentityCache<DesignFile | null> = new Map();
  let files: DesignFile[] | undefined;
  let status = new Map<string, DesignFile["sourceState"]>();
  const hydrate = () =>
    (files = hydrateDesignFiles(
      cache,
      files,
      metadata,
      (id) => loader.get(id),
      (id) => status.get(id),
    ));
  return {
    loader,
    hydrate,
    setStatus: (next: Map<string, DesignFile["sourceState"]>) => {
      status = next;
    },
  };
}

describe("hydrateDesignFiles", () => {
  it("gives a new object only to the file whose source arrived", async () => {
    const { loader, hydrate } = setup();
    await Promise.all(["f0", "f1", "f2"].map((id) => loader.request(id)));
    const before = hydrate();
    expect(before.map((file) => file.id)).toEqual(["f0", "f1", "f2"]);

    await loader.request("f4");
    const after = hydrate();

    expect(after.map((file) => file.id)).toEqual(["f0", "f1", "f2", "f4"]);
    for (const file of before)
      expect(after.find((next) => next.id === file.id)).toBe(file);
    expect(after[3]).toMatchObject({
      content: "<p>f4</p>",
      sourceState: "ready",
    });
  });

  it("keeps the list when a notification changed nothing", async () => {
    const { loader, hydrate, setStatus } = setup();
    await Promise.all(["f0", "f1"].map((id) => loader.request(id)));
    const before = hydrate();
    setStatus(new Map([["f0", "ready"]]));
    expect(hydrate()).toBe(before);
  });

  it("replaces a file whose dependency status changed", async () => {
    const { loader, hydrate, setStatus } = setup();
    await Promise.all(["f0", "f1"].map((id) => loader.request(id)));
    const before = hydrate();
    setStatus(new Map([["f1", "loading"]]));
    const after = hydrate();
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[1]?.sourceState).toBe("loading");
  });
});

describe("buildById", () => {
  it("forgets items that are gone, so a returning item is rebuilt", () => {
    const cache: IdentityCache<{ id: string }> = new Map();
    const a = { id: "a" };
    const first = buildById(
      cache,
      [a],
      (item) => [item],
      (item) => ({ ...item }),
    );
    buildById(
      cache,
      [] as { id: string }[],
      (item) => [item],
      (item) => ({ ...item }),
    );
    const again = buildById(
      cache,
      [a],
      (item) => [item],
      (item) => ({ ...item }),
    );
    expect(again[0]).not.toBe(first[0]);
  });
});
