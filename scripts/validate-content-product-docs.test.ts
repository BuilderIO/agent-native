import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateContentProductDocs } from "./validate-content-product-docs";

const fixtureRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/content-product-docs/valid",
);

test("accepts a coherent product graph", () => {
  const result = validateContentProductDocs(fixtureRoot, {
    strictCatalog: false,
    checkProjections: false,
  });

  assert.deepEqual(result.errors, []);
});

test("reports unknown references and dependency cycles with exact fields", () => {
  const root = copyFixture();
  replace(
    join(root, "capabilities/content.test.alpha.md"),
    "dependencies: []",
    'dependencies: ["content.test.beta"]',
  );
  replace(
    join(root, "capabilities/content.test.beta.md"),
    "dependencies: []",
    'dependencies: ["content.test.alpha"]',
  );
  replace(
    join(root, "features/content.feature.test.md"),
    'enhancing_capabilities: ["content.test.beta"]',
    'enhancing_capabilities: ["content.test.missing"]',
  );

  const result = validateContentProductDocs(root, {
    strictCatalog: false,
    checkProjections: false,
  });

  assert(
    result.errors.some((error) =>
      error.includes(
        "enhancing_capabilities references unknown id content.test.missing",
      ),
    ),
  );
  assert(
    result.errors.some((error) =>
      error.includes(
        "dependency cycle: content.test.alpha -> content.test.beta -> content.test.alpha",
      ),
    ),
  );
});

test("rejects private paths and vault metadata", () => {
  const root = copyFixture();
  const file = join(root, "capabilities/content.test.alpha.md");
  replace(file, 'name: "Alpha"', 'name: "Alpha"\ncontext: ["private"]');
  writeFileSync(
    file,
    `${readFileSync(file, "utf8")}\nSee /Users/example/private-notes.\n`,
  );

  const result = validateContentProductDocs(root, {
    strictCatalog: false,
    checkProjections: false,
  });

  assert(
    result.errors.some((error) =>
      error.includes("remove vault-only frontmatter field context"),
    ),
  );
  assert(
    result.errors.some((error) =>
      error.includes("remove absolute filesystem path"),
    ),
  );
});

test("requires complete proof before a Feature becomes available", () => {
  const root = copyFixture();
  replace(
    join(root, "features/content.feature.test.md"),
    'roadmap_status: "planned"',
    'roadmap_status: "available"',
  );

  const result = validateContentProductDocs(root, {
    strictCatalog: false,
    checkProjections: false,
  });

  assert(
    result.errors.some((error) =>
      error.includes("available Feature has unverified required capabilities"),
    ),
  );
  assert(
    result.errors.some((error) =>
      error.includes(
        "available Feature requires a non-empty feature_proof receipt",
      ),
    ),
  );
});

function copyFixture() {
  const root = mkdtempSync(join(tmpdir(), "content-product-docs-"));
  cpSync(fixtureRoot, root, { recursive: true });
  return root;
}

function replace(file: string, find: string, replacement: string) {
  const source = readFileSync(file, "utf8");
  assert(source.includes(find), `Fixture text not found in ${file}: ${find}`);
  writeFileSync(file, source.replace(find, replacement));
}
