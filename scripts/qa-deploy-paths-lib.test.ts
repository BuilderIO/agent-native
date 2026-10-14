import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertDocContract,
  containerReachableDatabaseUrl,
  databaseUrlFor,
  DEPLOY_DATABASE_NAME_PATTERN,
  dockerfileBaseImages,
  DEPLOY_DOC_CONTRACTS,
  DEPLOY_TARGETS,
  deployDatabaseName,
  extractFencedBlock,
  findFileUrls,
  missingDocCommands,
  vendorDockerfile,
  vendorSpecifier,
} from "./qa-deploy-paths-lib";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const dockerGuide = fs.readFileSync(
  path.join(repoRoot, DEPLOY_DOC_CONTRACTS.docker.doc),
  "utf8",
);

describe("deploy guides", () => {
  for (const target of DEPLOY_TARGETS) {
    it(`${target} guide still contains every command its check runs`, () => {
      assertDocContract(repoRoot, target);
    });
  }

  it("names the missing command and both files to change", () => {
    const missing = missingDocCommands("pnpm install", [
      "pnpm install",
      "pnpm migrate:production",
    ]);
    assert.deepEqual(missing, ["pnpm migrate:production"]);
  });

  it("extracts the Dockerfile and .dockerignore the guide ships", () => {
    const dockerfile = extractFencedBlock(dockerGuide, "Dockerfile");
    assert.match(dockerfile, /^FROM node:\d+-slim AS build$/m);
    assert.match(
      dockerfile,
      /^CMD \["node", "\.output\/server\/index\.mjs"\]$/m,
    );
    assert.ok(dockerfile.endsWith("\n"));
    assert.match(extractFencedBlock(dockerGuide, ".dockerignore"), /^\.env$/m);
  });

  it("fails loudly when a block is missing", () => {
    assert.throws(
      () => extractFencedBlock(dockerGuide, "Missing.file"),
      /No fenced code block/,
    );
    assert.throws(
      () => extractFencedBlock('```text filename="a"\nno end', "a"),
      /never closed/,
    );
  });
});

describe("vendorDockerfile", () => {
  it("places the vendored packages before the install step and changes nothing else", () => {
    const original = extractFencedBlock(dockerGuide, "Dockerfile");
    const vendored = vendorDockerfile(original);
    const lines = vendored.split("\n");
    const copyVendor = lines.indexOf("COPY .deploy-vendor ./.deploy-vendor");
    const install = lines.findIndex((line) => line.includes("pnpm install"));
    assert.ok(copyVendor !== -1 && copyVendor < install);
    assert.equal(
      vendored.replace("COPY .deploy-vendor ./.deploy-vendor\n", ""),
      original,
    );
  });

  it("refuses a Dockerfile it cannot place the packages in", () => {
    assert.throws(
      () => vendorDockerfile("FROM node:24-slim\n"),
      /no longer contains/,
    );
  });
});

describe("dockerfileBaseImages", () => {
  it("lists the guide's base image once", () => {
    const images = dockerfileBaseImages(
      extractFencedBlock(dockerGuide, "Dockerfile"),
    );
    assert.equal(images.length, 1);
    assert.match(images[0]!, /^node:\d+-slim$/);
  });

  it("skips earlier stage names and keeps platform flags out of the image", () => {
    assert.deepEqual(
      dockerfileBaseImages(
        [
          "FROM --platform=linux/amd64 node:24-slim AS build",
          "RUN true",
          "FROM build AS test",
          "FROM alpine:3.20",
        ].join("\n"),
      ),
      ["node:24-slim", "alpine:3.20"],
    );
  });
});

describe("local package references", () => {
  it("finds each file: URL once, quoted or not", () => {
    const text = [
      '"@agent-native/core": "file:///tmp/a/core-1.0.0.tgz",',
      '  "@agent-native/toolkit": "file:///tmp/b/toolkit-1.0.0.tgz"',
      "overrides:",
      '  "@agent-native/core": "file:///tmp/a/core-1.0.0.tgz"',
      '  "@agent-native/recap-cli": "file:///Users/me/repo/packages/recap-cli"',
    ].join("\n");
    assert.deepEqual(findFileUrls(text), [
      "file:///tmp/a/core-1.0.0.tgz",
      "file:///tmp/b/toolkit-1.0.0.tgz",
      "file:///Users/me/repo/packages/recap-cli",
    ]);
  });

  it("rewrites to a path inside the app", () => {
    assert.equal(
      vendorSpecifier("core-1.0.0.tgz"),
      "file:./.deploy-vendor/core-1.0.0.tgz",
    );
  });
});

describe("database helpers", () => {
  it("points a container at the host's database", () => {
    assert.equal(
      containerReachableDatabaseUrl("postgres://u:p@127.0.0.1:5432/db"),
      "postgres://u:p@host.docker.internal:5432/db",
    );
    assert.equal(
      containerReachableDatabaseUrl("postgres://u:p@localhost:5432/db?x=1"),
      "postgres://u:p@host.docker.internal:5432/db?x=1",
    );
  });

  it("leaves a remote database alone", () => {
    const url =
      "postgres://u:p@ep-x.us-east-2.aws.neon.tech/db?sslmode=require";
    assert.equal(containerReachableDatabaseUrl(url), url);
  });

  it("swaps only the database name", () => {
    assert.equal(
      databaseUrlFor(
        "postgres://u:p@host:5432/postgres?sslmode=require",
        "an_deploy_ci_1791930000_abc123_node",
      ),
      "postgres://u:p@host:5432/an_deploy_ci_1791930000_abc123_node?sslmode=require",
    );
  });

  it("names a throwaway database so a reaper can age it and never mistake another for it", () => {
    const name = deployDatabaseName("docker", 1_791_930_000_123, "a1b2c3");
    assert.equal(name, "an_deploy_ci_1791930000_a1b2c3_docker");
    assert.match(name, DEPLOY_DATABASE_NAME_PATTERN);
    for (const other of [
      "postgres",
      "neondb",
      "an_deploy_ci_17919_a1b2c3_node",
      "an_deploy_ci_1791930000_A1B2C3_node",
      "production_an_deploy_ci_1791930000_a1b2c3_node",
    ]) {
      assert.doesNotMatch(other, DEPLOY_DATABASE_NAME_PATTERN);
    }
  });

  it("refuses a random suffix that would not match the reaper's pattern", () => {
    assert.throws(
      () => deployDatabaseName("node", 1_791_930_000_000, "x; drop"),
      /Refusing/,
    );
  });
});
