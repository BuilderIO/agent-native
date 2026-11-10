import * as parse5 from "parse5";
import { beforeEach, expect, it, vi } from "vitest";

import {
  ensureNativeShaderRuntime,
  NATIVE_SHADER_RUNTIME_SOURCE,
  stripGeneratedShaderRuntimes,
} from "./shader-fills";

vi.mock("parse5", async (importOriginal) => {
  const actual = await importOriginal<typeof import("parse5")>();
  return { ...actual, parse: vi.fn(actual.parse) };
});

const parse = vi.mocked(parse5.parse);

beforeEach(() => {
  parse.mockClear();
});

it("parses a screen's runtime scripts once however often its editor mounts", () => {
  const screen = ensureNativeShaderRuntime(
    "<!DOCTYPE html><html><body><main>Board</main></body></html>",
  );
  parse.mockClear();

  for (let mount = 0; mount < 3; mount += 1) {
    expect(ensureNativeShaderRuntime((" " + screen).slice(1))).toBe(screen);
  }

  expect(parse).toHaveBeenCalledTimes(1);
});

it("parses a changed screen again", () => {
  const screen = ensureNativeShaderRuntime(
    "<!DOCTYPE html><html><body><main>Board</main></body></html>",
  );
  const edited = screen.replace("Board", "Roadmap");
  parse.mockClear();

  expect(stripGeneratedShaderRuntimes(edited)).not.toContain(
    NATIVE_SHADER_RUNTIME_SOURCE,
  );
  expect(parse).toHaveBeenCalledTimes(1);
});
