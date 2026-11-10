import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  listFileUploadProviders,
  unregisterFileUploadProvider,
} from "../file-upload/registry.js";
import {
  listPrivateBlobProviders,
  unregisterPrivateBlobProvider,
} from "../private-blob/registry.js";
import { loadCliBootstrap } from "./cli-bootstrap.js";

let roots: string[] = [];

function emptyAppRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-cli-private-"));
  roots.push(root);
  return root;
}

describe("loadCliBootstrap private storage", () => {
  afterEach(() => {
    for (const provider of listPrivateBlobProviders()) {
      unregisterPrivateBlobProvider(provider.id);
    }
    for (const provider of listFileUploadProviders()) {
      unregisterFileUploadProvider(provider.id);
    }
    for (const root of roots) fs.rmSync(root, { force: true, recursive: true });
    roots = [];
  });

  it("registers the S3 private-blob providers once", async () => {
    await loadCliBootstrap(emptyAppRoot());
    await loadCliBootstrap(emptyAppRoot());

    const ids = listPrivateBlobProviders().map((provider) => provider.id);
    expect(ids.filter((id) => id === "s3-private")).toHaveLength(1);
    expect(ids.filter((id) => id === "hosted-private")).toHaveLength(1);
  });
});
