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
  DEPLOY_DOC_CONTRACTS,
  DEPLOY_GUIDE_PATHS,
  DEPLOY_PROJECT_NAME_PATTERN,
  DEPLOY_TARGETS,
  deployDatabaseName,
  deployProjectName,
  deployProjectSlot,
  deployResourceAgeSeconds,
  dockerfileBaseImages,
  extractFencedBlock,
  findFileUrls,
  isVercelEnvVarAbsent,
  missingDocCommands,
  PRESET_SHAPES,
  redactSecrets,
  secretsInUrl,
  selectReapable,
  vendorDockerfile,
  vendorSpecifier,
} from "./qa-deploy-paths-lib";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const dockerGuide = fs.readFileSync(
  path.join(repoRoot, DEPLOY_DOC_CONTRACTS.docker[0]!.doc),
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

describe("reused host projects", () => {
  it("names one project per host and slot, so the check can never reach another project", () => {
    assert.equal(
      deployProjectName("netlify", "latest"),
      "an-deploy-ci-netlify-latest",
    );
    assert.equal(
      deployProjectName("vercel", "local"),
      "an-deploy-ci-vercel-local",
    );
    for (const other of [
      "builder-io-slides",
      "agent-native-docs",
      "an-deploy-ci-1791930000-a1b2c3",
      "an-deploy-ci-netlify",
      "an-deploy-ci-netlify-beta",
      "an-deploy-ci-cloudflare-latest",
      "beta-an-deploy-ci-netlify-latest",
      "an-deploy-ci-netlify-latest-2",
    ]) {
      assert.doesNotMatch(other, DEPLOY_PROJECT_NAME_PATTERN);
    }
  });

  it("gives this checkout's packages and each npm tag a project of their own", () => {
    assert.equal(deployProjectSlot("local", "latest"), "local");
    assert.equal(deployProjectSlot("npm", "latest"), "latest");
    assert.equal(deployProjectSlot("npm", "nightly"), "nightly");
  });

  it("refuses a tag it has no project for, so a dispatch cannot start a new one", () => {
    assert.throws(() => deployProjectSlot("npm", "beta"), /not "beta"/);
    assert.throws(() => deployProjectSlot("npm", "local"), /not "local"/);
  });
});

describe("leaked databases", () => {
  it("ages a database from its name, and nothing else", () => {
    const now = 1_791_933_600_000;
    for (const name of [
      "an_deploy_ci_1791930000_a1b2c3_netlify",
      "an_deploy_ci_1791930000_a1b2c3_vercel",
    ]) {
      assert.equal(deployResourceAgeSeconds(name, now), 3600);
    }
    for (const other of [
      "an-deploy-ci-1791930000-a1b2c3",
      "an-deploy-ci-netlify-latest",
      "test-an-deploy2",
      "postgres",
    ]) {
      assert.equal(deployResourceAgeSeconds(other, now), null);
    }
  });
});

describe("selectReapable", () => {
  const now = 1_791_940_000_000;

  it("selects only the databases this check created and left behind", () => {
    assert.deepEqual(
      selectReapable(
        [
          "an_deploy_ci_1791930000_a1b2c3_node",
          "an_deploy_ci_1791930000_a1b2c3_vercel",
          "an-deploy-ci-netlify-latest",
          "test-an-deploy2",
          "postgres",
        ],
        now,
        7200,
      ),
      [
        "an_deploy_ci_1791930000_a1b2c3_node",
        "an_deploy_ci_1791930000_a1b2c3_vercel",
      ],
    );
  });

  it("leaves a run that is still in progress alone", () => {
    const young = `an_deploy_ci_${Math.floor(now / 1000) - 60}_a1b2c3_node`;
    assert.deepEqual(selectReapable([young], now, 7200), []);
  });

  it("keeps a database exactly at the minimum age", () => {
    const atLimit = `an_deploy_ci_${Math.floor(now / 1000) - 7200}_a1b2c3_node`;
    assert.deepEqual(selectReapable([atLimit], now, 7200), [atLimit]);
  });
});

describe("removing a Vercel variable that may not be there", () => {
  it("treats the CLI's own 'not found' answer as already removed", () => {
    assert.equal(
      isVercelEnvVarAbsent(
        "Retrieving project…\nError: Environment Variable was not found.",
      ),
      true,
    );
    assert.equal(
      isVercelEnvVarAbsent(
        '{"status":"error","reason":"env_not_found","message":"Environment Variable DATABASE_URL was not found."}',
      ),
      true,
    );
  });

  it("does not hide any other failure", () => {
    for (const other of [
      "Error: The specified token is not valid.",
      "Error: Project was not found.",
      "Error: Request timed out",
      "",
    ]) {
      assert.equal(isVercelEnvVarAbsent(other), false, other);
    }
  });
});

describe("hosting presets", () => {
  it("names the files each host's deploy command reads", () => {
    assert.deepEqual(Object.keys(PRESET_SHAPES), ["netlify", "vercel"]);
    assert.ok(
      PRESET_SHAPES.netlify.files.includes(
        ".netlify/functions-internal/server/main.mjs",
      ),
    );
    assert.ok(
      PRESET_SHAPES.vercel.files.includes(".vercel/output/config.json"),
    );
    // The function's file, not just its directory, which can exist empty.
    assert.ok(
      PRESET_SHAPES.vercel.files.includes(
        ".vercel/output/functions/__server.func/index.mjs",
      ),
    );
  });

  it("scopes CI to the guides every target runs, and only those", () => {
    assert.deepEqual([...DEPLOY_GUIDE_PATHS].sort(), [
      "packages/core/docs/content/docker.mdx",
      "packages/core/docs/content/netlify.mdx",
      "packages/core/docs/content/node-js.mdx",
      "packages/core/docs/content/vercel.mdx",
    ]);
  });
});

describe("secret redaction", () => {
  it("hides a secret wherever it appears", () => {
    assert.equal(
      redactSecrets("set X=hunter2hunter2 then hunter2hunter2", [
        "hunter2hunter2",
      ]),
      "set X=*** then ***",
    );
  });

  it("ignores values too short to be a secret instead of mangling the log", () => {
    assert.equal(redactSecrets("a b c node", ["a", "node"]), "a b c node");
  });

  it("hides a URL's password on its own, as a tool might print it", () => {
    const parsed = new URL("postgres://host.neon.tech/db");
    parsed.username = "owner";
    parsed.password = "not-a-real-password";
    const url = parsed.toString();
    const secrets = secretsInUrl(url);
    assert.equal(
      redactSecrets("connecting with not-a-real-password now", secrets),
      "connecting with *** now",
    );
    assert.equal(redactSecrets(`url=${url}`, secrets), "url=***");
  });

  it("treats a value that is not a URL as the secret itself", () => {
    assert.deepEqual(secretsInUrl("not a url at all"), ["not a url at all"]);
  });
});
