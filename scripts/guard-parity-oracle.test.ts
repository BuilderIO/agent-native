import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { oracle } from "../templates/design/e2e/parity-oracle.ts";
import { runParityOracleGuard } from "./guard-parity-oracle.ts";

const oracleId = "fig.inspector.empty-fill-title";
const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==",
  "base64",
);

function makeRoot(): string {
  return realpathSync(mkdtempSync(path.join(os.tmpdir(), "parity-oracle-")));
}

function writeEntry(
  root: string,
  overrides: Record<string, unknown> = {},
  artifactBytes = pngBytes,
): void {
  const dir = path.join(root, "templates/design/parity/oracle", oracleId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "figma.png"), artifactBytes);
  const digest = createHash("sha256").update(artifactBytes).digest("hex");
  const entry = {
    schemaVersion: 1,
    id: oracleId,
    claim:
      "An empty Fill title click adds the default fill and opens its picker.",
    area: "inspector.fill",
    basis: "measured",
    status: "current",
    measuredBy: "figma-desktop-app-click",
    operator: "Claude",
    date: "2026-10-06",
    gesture: "Click the empty Fill section title once.",
    nativeObservation: "D9D9D9 at 100%; the color picker opens.",
    trials: "One raw pointer click.",
    values: { fill: "#D9D9D9", opacity: 100 },
    figma: { fileKeyWithheld: true, pageName: "private probe page" },
    source: "User-supplied native Figma evidence packet.",
    artifacts: [
      {
        path: `templates/design/parity/oracle/${oracleId}/figma.png`,
        kind: "figma-screenshot",
        sha256: digest,
      },
    ],
    ...overrides,
  };
  writeFileSync(
    path.join(root, "templates/design/parity/oracle", `${oracleId}.json`),
    JSON.stringify(entry, null, 2),
  );
}

function addedLines(root: string, relPath: string, source: string) {
  const file = path.join(root, relPath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, source);
  const lines = new Set<number>();
  source.split("\n").forEach((line, index) => {
    if (line.length > 0) lines.add(index + 1);
  });
  return new Map([[file, lines]]);
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(
    crc32(chunk.subarray(4, 8 + data.length)),
    8 + data.length,
  );
  return chunk;
}

function pngWithIdat(data: Buffer): Buffer {
  const chunks: Buffer[] = [pngBytes.subarray(0, 8)];
  for (let offset = 8; offset < pngBytes.length; ) {
    const length = pngBytes.readUInt32BE(offset);
    const type = pngBytes.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") chunks.push(pngChunk("IDAT", data));
    else chunks.push(pngBytes.subarray(offset, offset + length + 12));
    offset += length + 12;
  }
  return Buffer.concat(chunks);
}

describe("parity oracle guard", () => {
  it("loads a seeded current record and verifies its evidence artifacts", () => {
    const record = oracle("fig.inspector.empty-fill-title");
    assert.equal(record.basis, "measured");
    assert.deepEqual(record.values.fill, { hex: "D9D9D9", opacity: 100 });
    assert.match(
      record.title,
      /^\[oracle fig\.inspector\.empty-fill-title measured\]$/,
    );
  });

  it("reports an empty ledger explicitly", () => {
    const root = makeRoot();
    try {
      mkdirSync(path.join(root, "templates/design/parity/oracle"), {
        recursive: true,
      });
      const result = runParityOracleGuard({
        repoRoot: root,
        addedLines: new Map(),
        today: new Date("2026-10-06T00:00:00Z"),
      });
      assert.equal(result.exitCode, 0);
      assert.match(result.message, /0 entries, 0 citations/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects chosen records as parity evidence at runtime", () => {
    const root = makeRoot();
    try {
      const dir = path.join(root, "templates/design/parity/oracle");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        path.join(dir, `${oracleId}.json`),
        JSON.stringify({
          schemaVersion: 1,
          id: oracleId,
          basis: "chosen",
          status: "current",
          date: "2026-10-06",
          claim: "A deliberate product choice.",
          artifacts: [],
        }),
      );
      assert.throws(
        () => oracle(oracleId, root),
        /not measured; only measured records may be cited/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a chosen record cited by an added parity test", () => {
    const root = makeRoot();
    try {
      writeEntry(root, {
        basis: "chosen",
        decidedBy: "Steve",
        reason: "Explicit product decision.",
        figmaBehavior: "unmeasured",
      });
      const result = runParityOracleGuard({
        repoRoot: root,
        addedLines: addedLines(
          root,
          "templates/design/e2e/parity-inspector.spec.ts",
          `// oracle: ${oracleId}\ntest("uses an oracle", () => {});`,
        ),
        today: new Date("2026-10-06T00:00:00Z"),
      });
      assert.equal(result.exitCode, 1);
      assert.match(result.message, /chosen, not measured evidence/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("requires every added parity test to cite a current record or explain none", () => {
    const root = makeRoot();
    try {
      writeEntry(root);
      const missing = runParityOracleGuard({
        repoRoot: root,
        addedLines: addedLines(
          root,
          "templates/design/e2e/parity-inspector.spec.ts",
          'test("empty fill title click matches Figma", async () => {\n  expect(true).toBe(true);\n});',
        ),
        today: new Date("2026-10-06T00:00:00Z"),
      });
      assert.equal(missing.exitCode, 1);
      assert.match(missing.message, /test block needs oracle: fig\./);

      const missingAppCitation = runParityOracleGuard({
        repoRoot: root,
        addedLines: addedLines(
          root,
          "templates/design/app/components/ColorPicker.test.tsx",
          'test("uses the Figma color picker behavior", async () => {\n  expect(true).toBe(true);\n});',
        ),
        today: new Date("2026-10-06T00:00:00Z"),
      });
      assert.equal(missingAppCitation.exitCode, 1);
      assert.match(
        missingAppCitation.message,
        /test block needs oracle: fig\./,
      );

      const missingRootAppCitation = runParityOracleGuard({
        repoRoot: root,
        addedLines: addedLines(
          root,
          "templates/design/app/ColorPicker.test.tsx",
          'test("uses the Figma color picker behavior", async () => {\n  expect(true).toBe(true);\n});',
        ),
        today: new Date("2026-10-06T00:00:00Z"),
      });
      assert.equal(missingRootAppCitation.exitCode, 1);
      assert.match(
        missingRootAppCitation.message,
        /test block needs oracle: fig\./,
      );

      const explained = runParityOracleGuard({
        repoRoot: root,
        addedLines: addedLines(
          root,
          "templates/design/e2e/parity-inspector.spec.ts",
          '// oracle: none — behavior has not been measured natively\ntest("empty fill title click", async () => {\n  expect(true).toBe(true);\n});',
        ),
        today: new Date("2026-10-06T00:00:00Z"),
      });
      assert.equal(explained.exitCode, 0, explained.message);
      assert.match(explained.message, /1 entry, 1 citation/);

      const measured = runParityOracleGuard({
        repoRoot: root,
        addedLines: addedLines(
          root,
          "templates/design/e2e/parity-inspector.spec.ts",
          `// oracle: ${oracleId}\ntest("uses the measured Fill behavior", async () => {\n  expect("#D9D9D9").toBe("#D9D9D9");\n});`,
        ),
        today: new Date("2026-10-06T00:00:00Z"),
      });
      assert.equal(measured.exitCode, 0, measured.message);
      assert.match(measured.message, /1 entry, 1 citation/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not require native evidence citations in guard tooling tests", () => {
    const root = makeRoot();
    try {
      writeEntry(root);
      const result = runParityOracleGuard({
        repoRoot: root,
        addedLines: addedLines(
          root,
          "scripts/guard-parity-oracle.test.ts",
          'test("checks parity guard behavior", async () => {\n  expect(true).toBe(true);\n});',
        ),
        today: new Date("2026-10-06T00:00:00Z"),
      });
      assert.equal(result.exitCode, 0, result.message);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects missing, retracted, and repeat-required record citations", () => {
    const root = makeRoot();
    try {
      writeEntry(root);
      const spec = "templates/design/e2e/parity-inspector.spec.ts";
      for (const [id, status, expected] of [
        ["fig.inspector.unknown", "current", /unknown oracle id/],
        [oracleId, "retracted", /is retracted/],
        [oracleId, "repeat-required", /requires a repeat/],
      ] as const) {
        if (status !== "current") {
          writeEntry(root, {
            status,
            retractionReason: "The source packet requires a repeat.",
            repeatReason: "The source packet requires a repeat.",
          });
        }
        const source = `// oracle: ${id}\ntest("uses the oracle", () => {});`;
        const result = runParityOracleGuard({
          repoRoot: root,
          addedLines: addedLines(root, spec, source),
          today: new Date("2026-10-06T00:00:00Z"),
        });
        assert.equal(result.exitCode, 1);
        assert.match(result.message, expected);
        if (status !== "current") writeEntry(root);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rechecks unchanged test citations when an oracle is retracted", () => {
    const root = makeRoot();
    try {
      writeEntry(root);
      addedLines(
        root,
        "templates/design/e2e/parity-inspector.spec.ts",
        `// oracle: ${oracleId}\ntest("uses the oracle", () => {});`,
      );
      writeEntry(root, {
        status: "retracted",
        retractionReason: "The captured evidence is invalid.",
      });
      const result = runParityOracleGuard({
        repoRoot: root,
        addedLines: new Map(),
        today: new Date("2026-10-06T00:00:00Z"),
      });
      assert.equal(result.exitCode, 1);
      assert.match(result.message, /is retracted/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects artifact hash mismatches and paths outside the entry directory", () => {
    const root = makeRoot();
    try {
      writeEntry(root);
      const entryPath = path.join(
        root,
        "templates/design/parity/oracle",
        `${oracleId}.json`,
      );
      const entry = JSON.parse(readFileSync(entryPath, "utf8"));
      entry.artifacts[0].sha256 = "0".repeat(64);
      writeFileSync(entryPath, JSON.stringify(entry));
      const mismatch = runParityOracleGuard({
        repoRoot: root,
        addedLines: new Map(),
        today: new Date("2026-10-06T00:00:00Z"),
      });
      assert.equal(mismatch.exitCode, 1);
      assert.match(mismatch.message, /sha256 mismatch/);

      entry.artifacts[0].path = "../../outside.png";
      writeFileSync(entryPath, JSON.stringify(entry));
      const escaped = runParityOracleGuard({
        repoRoot: root,
        addedLines: new Map(),
        today: new Date("2026-10-06T00:00:00Z"),
      });
      assert.equal(escaped.exitCode, 1);
      assert.match(escaped.message, /must stay under its entry directory/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects incomplete image bytes and unsupported artifact kinds", () => {
    const root = makeRoot();
    try {
      writeEntry(root, {}, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const incompleteImage = runParityOracleGuard({
        repoRoot: root,
        addedLines: new Map(),
        today: new Date("2026-10-06T00:00:00Z"),
      });
      assert.equal(incompleteImage.exitCode, 1);
      assert.match(incompleteImage.message, /not a valid PNG or JPEG image/);

      writeEntry(root, {
        artifacts: [
          {
            path: `templates/design/parity/oracle/${oracleId}/figma.png`,
            kind: "figma-arbitrary-data",
            sha256: createHash("sha256").update(pngBytes).digest("hex"),
          },
        ],
      });
      const unsupportedKind = runParityOracleGuard({
        repoRoot: root,
        addedLines: new Map(),
        today: new Date("2026-10-06T00:00:00Z"),
      });
      assert.equal(unsupportedKind.exitCode, 1);
      assert.match(unsupportedKind.message, /unsupported artifact kind/);
      assert.match(unsupportedKind.message, /valid figma-screenshot artifact/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects private Figma keys and citations to nonexistent oracle documents", () => {
    const root = makeRoot();
    try {
      writeEntry(root, {
        figma: {
          fileKey: "must-not-be-committed",
          fileKeyWithheld: true,
          pageName: "private probe page",
        },
      });
      const privateKey = runParityOracleGuard({
        repoRoot: root,
        addedLines: new Map(),
        today: new Date("2026-10-06T00:00:00Z"),
      });
      assert.equal(privateKey.exitCode, 1);
      assert.match(privateKey.message, /private Figma locator/);

      writeEntry(root, {
        values: { nested: { figma_file_key: "must-not-be-committed" } },
      });
      const nestedPrivateKey = runParityOracleGuard({
        repoRoot: root,
        addedLines: new Map(),
        today: new Date("2026-10-06T00:00:00Z"),
      });
      assert.equal(nestedPrivateKey.exitCode, 1);
      assert.match(nestedPrivateKey.message, /private Figma locator/);

      writeEntry(root, {
        figma: {
          fileKeyWithheld: true,
          pageName: "https://www.figma.com/design/example-file-id/Probe",
        },
      });
      const privateUrl = runParityOracleGuard({
        repoRoot: root,
        addedLines: new Map(),
        today: new Date("2026-10-06T00:00:00Z"),
      });
      assert.equal(privateUrl.exitCode, 1);
      assert.match(privateUrl.message, /private Figma locator/);

      writeEntry(root);
      const inventedDoc = runParityOracleGuard({
        repoRoot: root,
        addedLines: addedLines(
          root,
          "templates/design/e2e/parity-inspector.spec.ts",
          '// See figma-ground-truth.md for expected behavior.\ntest("renders", () => {});',
        ),
        today: new Date("2026-10-06T00:00:00Z"),
      });
      assert.equal(inventedDoc.exitCode, 1);
      assert.match(inventedDoc.message, /nonexistent Figma oracle document/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns exit 2 when a changed-line diff is unavailable", () => {
    const root = makeRoot();
    try {
      mkdirSync(path.join(root, "templates/design/parity/oracle"), {
        recursive: true,
      });
      const result = runParityOracleGuard({
        repoRoot: root,
        addedLines: null,
        today: new Date("2026-10-06T00:00:00Z"),
      });
      assert.equal(result.exitCode, 2);
      assert.match(result.message, /could not determine added lines/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects PNGs with invalid chunk CRCs or invalid compressed pixel data", () => {
    const root = makeRoot();
    try {
      const invalidCrc = Buffer.from(pngBytes);
      invalidCrc[29] ^= 1;
      writeEntry(root, {}, invalidCrc);
      const badCrc = runParityOracleGuard({
        repoRoot: root,
        addedLines: new Map(),
        today: new Date("2026-10-06T00:00:00Z"),
      });
      assert.equal(badCrc.exitCode, 1);
      assert.match(badCrc.message, /not a valid PNG or JPEG image/);

      writeEntry(root, {}, pngWithIdat(Buffer.from("not a zlib stream")));
      const badPixels = runParityOracleGuard({
        repoRoot: root,
        addedLines: new Map(),
        today: new Date("2026-10-06T00:00:00Z"),
      });
      assert.equal(badPixels.exitCode, 1);
      assert.match(badPixels.message, /not a valid PNG or JPEG image/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("requires measured runtime records to verify a native Figma screenshot", () => {
    const root = makeRoot();
    try {
      writeEntry(root, { artifacts: [] });
      assert.throws(
        () => oracle(oracleId, root),
        /no verified Figma screenshot artifact/,
      );

      const digest = createHash("sha256").update(pngBytes).digest("hex");
      writeEntry(root, {
        artifacts: [
          {
            path: `templates/design/parity/oracle/${oracleId}/figma.png`,
            kind: "design-screenshot",
            sha256: digest,
          },
        ],
      });
      assert.throws(
        () => oracle(oracleId, root),
        /no verified Figma screenshot artifact/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
