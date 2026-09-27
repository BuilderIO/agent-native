import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPasses,
  isPrerenderConfig,
  parseWorkspaceFilters,
} from "./ci-build-workspaces.ts";

test("recognizes a React Router config that prerenders", () => {
  assert.equal(
    isPrerenderConfig("export default { ssr: true, prerender: { paths } };"),
    true,
  );
  assert.equal(isPrerenderConfig("export default { ssr: true };"), false);
});

test("builds prerendering apps last and one at a time", () => {
  assert.deepEqual(
    buildPasses({
      full: true,
      filters: [],
      prerenderPackages: ["@agent-native/docs", "clips"],
    }),
    [
      [
        "-r",
        "--filter",
        "!@agent-native/docs",
        "--filter",
        "!clips",
        "run",
        "build",
      ],
      [
        "-r",
        "--workspace-concurrency=1",
        "--filter",
        "@agent-native/docs",
        "--filter",
        "clips",
        "run",
        "build",
      ],
    ],
  );
});

test("keeps the affected selection and no-bail mode in both passes", () => {
  assert.deepEqual(
    buildPasses({
      full: false,
      filters: ["...{packages/core}..."],
      prerenderPackages: ["clips"],
    }),
    [
      [
        "-r",
        "--no-bail",
        "--if-present",
        "--filter",
        "...{packages/core}...",
        "--filter",
        "!clips",
        "run",
        "build",
      ],
      [
        "-r",
        "--no-bail",
        "--if-present",
        "--workspace-concurrency=1",
        "--filter",
        "clips",
        "run",
        "build",
      ],
    ],
  );
});

test("runs a single pass when nothing selected prerenders", () => {
  assert.deepEqual(
    buildPasses({
      full: false,
      filters: ["...{templates/mail}..."],
      prerenderPackages: [],
    }),
    [
      [
        "-r",
        "--no-bail",
        "--if-present",
        "--filter",
        "...{templates/mail}...",
        "run",
        "build",
      ],
    ],
  );
});

test("refuses missing or malformed workspace filters", () => {
  assert.throws(() => parseWorkspaceFilters(undefined), /--full/);
  assert.throws(() => parseWorkspaceFilters('{"a":1}'), /JSON array/);
  assert.deepEqual(parseWorkspaceFilters('["a...", "b"]'), ["a...", "b"]);
});
