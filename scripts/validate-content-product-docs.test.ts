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

test("rejects private reference links and Slack client permalinks", () => {
  const root = copyFixture();
  const file = join(root, "capabilities/content.test.alpha.md");
  writeFileSync(
    file,
    `${readFileSync(file, "utf8")}\n[private-notes]:/Users/example/private-notes.md\n[private-thread]: https://workspace.slack.com/client/T123/C456/thread\n`,
  );

  const result = validateContentProductDocs(root, {
    strictCatalog: false,
    checkProjections: false,
  });

  assert(
    result.errors.some((error) =>
      error.includes("remove absolute filesystem path"),
    ),
  );
  assert(
    result.errors.some((error) =>
      error.includes("remove private Slack-shaped URL"),
    ),
  );
});

test("requires Chapter and Feature membership to agree in both directions", () => {
  const root = copyFixture();
  replace(
    join(root, "chapters/content.chapter.test.md"),
    'features: ["content.feature.test"]',
    "features: []",
  );

  const result = validateContentProductDocs(root, {
    strictCatalog: false,
    checkProjections: false,
  });

  assert(
    result.errors.some((error) =>
      error.includes(
        "features must include content.feature.test because the Feature declares chapter content.chapter.test",
      ),
    ),
  );
});

test("requires Feature and Capability membership to agree in both directions", () => {
  const root = copyFixture();
  replace(
    join(root, "features/content.feature.test.md"),
    'enhancing_capabilities: ["content.test.beta"]',
    "enhancing_capabilities: []",
  );

  const result = validateContentProductDocs(root, {
    strictCatalog: false,
    checkProjections: false,
  });

  assert(
    result.errors.some((error) =>
      error.includes(
        "required_capabilities or enhancing_capabilities must include content.test.beta because the Capability declares related Feature content.feature.test",
      ),
    ),
  );
});

test("rejects active graph edges to superseded Capabilities", () => {
  const root = copyFixture();
  const alpha = join(root, "capabilities/content.test.alpha.md");
  const beta = join(root, "capabilities/content.test.beta.md");
  replace(beta, 'state: "approved_shape"', 'state: "superseded"');
  replace(beta, "superseded_by: null", 'superseded_by: "content.test.alpha"');
  replace(alpha, "dependencies: []", 'dependencies: ["content.test.beta"]');

  const result = validateContentProductDocs(root, {
    strictCatalog: false,
    checkProjections: false,
  });

  assert(
    result.errors.some((error) =>
      error.includes(
        "active Capability dependencies must target active Capabilities, not superseded content.test.beta",
      ),
    ),
  );
  assert(
    result.errors.some((error) =>
      error.includes(
        "Feature capability references must target active Capabilities, not superseded content.test.beta",
      ),
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

test("rejects a version 2 capability that falls back to the generated shell", () => {
  const root = copyFixture();
  const file = join(root, "capabilities/content.test.alpha.md");
  replace(file, "## Why this exists", "## Missing human problem");
  replace(
    file,
    'acceptance_summary: "The required path is proven."',
    'acceptance_summary: "A complete proof demonstrates: Alpha."',
  );

  const result = validateContentProductDocs(root, {
    strictCatalog: false,
    checkProjections: false,
  });

  assert(
    result.errors.some((error) =>
      error.includes("spec_version 2 requires ## Why this exists"),
    ),
  );
  assert(
    result.errors.some((error) =>
      error.includes("must describe the observable completion boundary"),
    ),
  );
});

test("rejects a longer mini-spec built from generic workflow placeholders", () => {
  const root = copyFixture();
  const file = join(root, "capabilities/content.test.alpha.md");
  replace(
    file,
    "A person invokes Alpha, reloads the surface, and recovers the saved result.",
    "A person uses Alpha in an authorized document workflow, inspects the result, and keeps history legible.",
  );
  replace(file, "### Complete Alpha", "### Complete the ordinary workflow");
  replace(file, "### Recover Alpha", "### Preserve the governing boundary");

  const result = validateContentProductDocs(root, {
    strictCatalog: false,
    checkProjections: false,
  });

  assert(
    result.errors.some((error) =>
      error.includes("replace the generic example workflow"),
    ),
  );
  assert(
    result.errors.some((error) =>
      error.includes("capability-specific scenario"),
    ),
  );
  assert(
    result.errors.some((error) =>
      error.includes("actual authority, permission, or data boundary"),
    ),
  );
});

test("requires the primary user job to add intent beyond the promise", () => {
  const root = copyFixture();
  const file = join(root, "capabilities/content.test.alpha.md");
  replace(
    file,
    'primary_user_job: "Complete the Alpha workflow without losing its result."',
    'primary_user_job: "Alpha proves the required path."',
  );

  const result = validateContentProductDocs(root, {
    strictCatalog: false,
    checkProjections: false,
  });

  assert(
    result.errors.some((error) =>
      error.includes("rather than duplicate user_promise"),
    ),
  );
});

test("requires one copy of each mini-spec section and distinct problem framing", () => {
  const root = copyFixture();
  const file = join(root, "capabilities/content.test.alpha.md");
  replace(
    file,
    "People need the Alpha result to survive the complete workflow.",
    "Complete the Alpha workflow without losing its result.",
  );
  replace(
    file,
    "## Boundaries and non-goals\n",
    "## Boundaries and non-goals\n\n## Boundaries and non-goals\n",
  );

  const result = validateContentProductDocs(root, {
    strictCatalog: false,
    checkProjections: false,
  });

  assert(
    result.errors.some((error) =>
      error.includes("requires exactly one ## Boundaries and non-goals"),
    ),
  );
  assert(
    result.errors.some((error) => error.includes("explain the human problem")),
  );
});

test("requires every Capability in the canonical catalog to use version 2", () => {
  const root = copyFixture();
  const file = join(root, "capabilities/content.test.alpha.md");
  replace(file, "spec_version: 2\n", "");

  const result = validateContentProductDocs(root, {
    strictCatalog: true,
    checkProjections: false,
  });

  assert(
    result.errors.some((error) =>
      error.includes(
        "every Capability must use spec_version 2; legacy records: content.test.alpha",
      ),
    ),
  );
  assert(
    result.errors.some((error) =>
      error.includes("expected 124 Capabilities, found 2"),
    ),
  );
});

test("requires supersession to terminate at a different active Capability", () => {
  const root = copyFixture();
  const alpha = join(root, "capabilities/content.test.alpha.md");
  const beta = join(root, "capabilities/content.test.beta.md");
  replace(alpha, 'state: "approved_shape"', 'state: "superseded"');
  replace(alpha, "superseded_by: null", 'superseded_by: "content.test.beta"');
  replace(beta, 'state: "approved_shape"', 'state: "superseded"');
  replace(beta, "superseded_by: null", 'superseded_by: "content.test.alpha"');

  const result = validateContentProductDocs(root, {
    strictCatalog: false,
    checkProjections: false,
  });

  assert(
    result.errors.some((error) =>
      error.includes(
        "superseded_by must reference an active terminal Capability, not superseded content.test.beta",
      ),
    ),
  );

  replace(
    alpha,
    'superseded_by: "content.test.beta"',
    'superseded_by: "content.test.alpha"',
  );
  const selfResult = validateContentProductDocs(root, {
    strictCatalog: false,
    checkProjections: false,
  });
  assert(
    selfResult.errors.some((error) =>
      error.includes("superseded_by cannot reference itself"),
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
