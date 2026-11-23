import { afterEach, beforeEach, expect, it, vi } from "vitest";

const disk = vi.hoisted(() => ({
  files: new Map<string, string>(),
  writes: vi.fn(),
}));
vi.mock("node:fs", () => ({
  existsSync: (file: string) => disk.files.has(file),
  readFileSync: (file: string) => {
    const value = disk.files.get(file);
    if (value === undefined) throw new Error("Missing fixture");
    return value;
  },
  writeFileSync: (file: string, bytes: string, options: { flag: string }) => {
    if (options.flag !== "wx" || disk.files.has(file))
      throw new Error("Exclusive creation required");
    disk.writes(file, bytes, options);
    disk.files.set(file, bytes);
  },
}));

import { frozen } from "./harness";

beforeEach(() => {
  disk.files.clear();
  disk.writes.mockClear();
  vi.stubEnv("CAPTURE_NEW_BASELINES", "1");
  vi.stubEnv("MODE", "test");
  vi.stubEnv("DEV", true);
  vi.stubEnv("PROD", false);
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("CI", undefined);
  vi.stubEnv("AGENT_NATIVE_CAPTURE_NEW_BASELINES", undefined);
});
afterEach(() => vi.unstubAllEnvs());

it("does not create missing captures by default", () => {
  expect(() => frozen("missing", {})).toThrow("Missing frozen file");
  expect(disk.writes).not.toHaveBeenCalled();
});
it.each([
  ["production build", "PROD", true],
  ["build with test mode", "DEV", false],
  ["production mode", "MODE", "production"],
  ["development server", "MODE", "development"],
  ["production runtime", "NODE_ENV", "production"],
  ["CI", "CI", "true"],
  ["CI explicitly set to zero", "CI", "0"],
] as const)("cannot capture in %s even with opt-in", (_, key, value) => {
  vi.stubEnv("AGENT_NATIVE_CAPTURE_NEW_BASELINES", "1");
  vi.stubEnv(key, value);
  expect(() => frozen("missing", {})).toThrow("Missing frozen file");
  expect(disk.writes).not.toHaveBeenCalled();
});
it("creates only missing captures on an explicit local test run, never overwrites", () => {
  vi.stubEnv("AGENT_NATIVE_CAPTURE_NEW_BASELINES", "1");
  frozen("missing", { value: 1 });
  expect(disk.writes).toHaveBeenCalledTimes(1);
  expect(disk.writes).toHaveBeenCalledWith(
    expect.any(String),
    '{\n  "value": 1\n}\n',
    { flag: "wx" },
  );
  frozen("missing", { value: 1 });
  expect(() => frozen("missing", { value: 2 })).toThrow(
    "Frozen missing changed",
  );
  expect(disk.writes).toHaveBeenCalledTimes(1);
});

it("normalizes generated control IDs while retaining broken-reference failures", () => {
  vi.stubEnv("AGENT_NATIVE_CAPTURE_NEW_BASELINES", "1");
  frozen("references", { id: "_r_a_", controls: "_r_a_" }, true);
  frozen("references", { id: "_r_b_", controls: "_r_b_" }, true);
  expect(() =>
    frozen("references", { id: "_r_b_", controls: "_r_c_" }, true),
  ).toThrow("Frozen references changed");
  expect(disk.writes).toHaveBeenCalledTimes(1);
});

it.each([
  { markup: "<button disabled>Run</button>" },
  { root: { tokens: { "--ws-muted": "changed" } } },
  { rows: ["shell.main"] },
  { controls: [{ tag: "button", attributes: { disabled: "" } }] },
])(
  "rejects a changed host contract without rewriting the baseline: %j",
  (change) => {
    vi.stubEnv("AGENT_NATIVE_CAPTURE_NEW_BASELINES", "1");
    const baseline = {
      markup: "<button>Run</button>",
      root: { tokens: { "--ws-muted": "#5f6880" } },
      rows: ["shell.nav", "shell.main"],
      controls: [{ tag: "button", attributes: {} }],
    };
    frozen("regression", baseline);
    const saved = [...disk.files.values()];
    expect(() => frozen("regression", { ...baseline, ...change })).toThrow(
      "Frozen regression changed",
    );
    expect([...disk.files.values()]).toEqual(saved);
    expect(disk.writes).toHaveBeenCalledTimes(1);
  },
);
