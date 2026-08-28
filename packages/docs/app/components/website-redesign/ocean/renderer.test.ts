import { frame, init, target } from "vgpu/mock";
import { describe, expect, it } from "vitest";

import type { OceanColors } from "./ocean-colors";
import { createIfftStageTable, OCEAN_RESOLUTION } from "./ocean-graph";
import {
  bloomSizes,
  createGraph,
  destroyGraph,
  particleStride,
  renderGraph,
  setParticleLevel,
  setPresentColors,
} from "./renderer";

const DARK: OceanColors = { fg: [0.68, 0.68, 0.67], bg: [0.04, 0.04, 0.04] };
const LIGHT: OceanColors = { fg: [0.24, 0.24, 0.24], bg: [0.98, 0.98, 0.96] };

async function mockOutput(size: readonly [number, number] = [320, 180]) {
  const gpu = await init();
  const output = target(gpu, { size, format: "rgba8unorm", label: "test-out" });
  return { gpu, output };
}

describe("ocean IFFT stage table", () => {
  it("describes a full 18-pass Stockham transform over both axes", () => {
    const stages = createIfftStageTable();
    expect(stages).toHaveLength(18);
    expect(stages.filter((s) => s.horizontal)).toHaveLength(9);
    // Nine axis stages is exactly log2(512) -- the table and the resolution
    // have to move together or the transform silently truncates.
    expect(2 ** 9).toBe(OCEAN_RESOLUTION);
  });

  it("never reads and writes the same target within a stage", () => {
    for (const stage of createIfftStageTable()) {
      expect(stage.input).not.toBe(stage.output);
    }
  });

  it("doubles the subtransform size on each axis stage", () => {
    const horizontal = createIfftStageTable().filter((s) => s.horizontal);
    expect(horizontal.map((s) => s.subtransformSize)).toEqual([
      2, 4, 8, 16, 32, 64, 128, 256, 512,
    ]);
  });
});

describe("bloom pyramid sizing", () => {
  it("halves each level and never collapses to zero", () => {
    for (const size of bloomSizes([320, 180])) {
      expect(size[0]).toBeGreaterThan(0);
      expect(size[1]).toBeGreaterThan(0);
    }
  });

  it("stays above zero for a degenerate one-pixel output", () => {
    for (const size of bloomSizes([1, 1])) {
      expect(size[0]).toBeGreaterThan(0);
      expect(size[1]).toBeGreaterThan(0);
    }
  });
});

describe("ocean graph", () => {
  it("builds and renders every pass without throwing", async () => {
    const { gpu, output } = await mockOutput();
    const graph = await createGraph(gpu, output, "test", DARK);
    await frame(gpu, (current) => renderGraph(current, graph, output));
    destroyGraph(graph);
    gpu.dispose();
  });

  it("retunes present colours in place without rebuilding the graph", async () => {
    const { gpu, output } = await mockOutput();
    const graph = await createGraph(gpu, output, "test", DARK);
    const before = graph.simulation.spectrum;

    setPresentColors(graph, LIGHT);
    await frame(gpu, (current) => renderGraph(current, graph, output));

    // Same texture object, so the 512x512 simulation targets were not
    // reallocated -- that is the whole point of the in-place path.
    expect(graph.simulation.spectrum).toBe(before);
    destroyGraph(graph);
    gpu.dispose();
  });

  it("renders when foreground and background are identical", async () => {
    const { gpu, output } = await mockOutput();
    const flat: OceanColors = { fg: [0.5, 0.5, 0.5], bg: [0.5, 0.5, 0.5] };
    const graph = await createGraph(gpu, output, "test", flat);
    await frame(gpu, (current) => renderGraph(current, graph, output));
    destroyGraph(graph);
    gpu.dispose();
  });

  it("thins the draw with the level and leaves the simulation at 512", async () => {
    const { gpu, output } = await mockOutput();
    const graph = await createGraph(gpu, output, "test", DARK);
    const simulationTarget = graph.simulation.spectrum;
    expect(graph.particleInstances).toBe(OCEAN_RESOLUTION ** 2);

    // Mid-ramp: the fade is under way but no particle has been dropped yet, so
    // the instance count must not have moved.
    setParticleLevel(graph, 0.6);
    expect(graph.particleInstances).toBe(OCEAN_RESOLUTION ** 2);

    setParticleLevel(graph, 1);
    expect(graph.particleInstances).toBe((OCEAN_RESOLUTION / 2) ** 2);
    // The IFFT stage table is pinned to 2^9, so the simulation must not move.
    expect(graph.simulation.spectrum).toBe(simulationTarget);
    await frame(gpu, (current) => renderGraph(current, graph, output));

    destroyGraph(graph);
    gpu.dispose();
  });

  it("only ever doubles the stride, so the fade and the drop agree", () => {
    // The shader ranks particles by trailing zeros in their texel index, which
    // is exactly the set a power-of-two stride keeps. A stride of 3 would drop
    // particles the fade had not emptied, and the difference would pop.
    expect([0, 0.5, 1, 1.9, 2].map(particleStride)).toEqual([1, 1, 2, 2, 4]);
  });

  it("rejects rather than returning a half-built graph when a pass cannot compile", async () => {
    const { gpu, output } = await mockOutput();
    // prewarm() compiles the present pass against the output format, so an
    // unrenderable format fails after most targets are already allocated --
    // the path where returning a usable-looking graph would be the bug.
    const unrenderable = { ...output, format: "depth24plus" } as never;
    await expect(
      createGraph(gpu, unrenderable, "test", DARK),
    ).rejects.toBeDefined();
    gpu.dispose();
  });
});
