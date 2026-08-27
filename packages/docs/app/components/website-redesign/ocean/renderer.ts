// Vendored from the vgpu `fft-ocean` example ("Particles ocean").
//   revision 8ca322aa1cf0bc25aff3d38389d48090bf065c6baf14bea858fd9b8e4bceea96
//   npx vgpu examples pull fft-ocean
// Diff against that revision before pulling upstream changes: this copy is
// edited (see present.wgsl's token-driven colouring and setPresentColors).

import {
  clock,
  draw,
  effect,
  frame,
  frameLoop,
  sampler,
  surface,
  target,
  type Draw,
  type Effect,
  type Frame,
  type Gpu,
  type ShaderSource,
  type Surface,
  type Target,
} from "vgpu";

import bloomBlurWgsl from "./bloom-blur.wgsl";
import bloomBrightWgsl from "./bloom-bright.wgsl";
import bloomCompositeWgsl from "./bloom-composite.wgsl";
import { oceanCamera } from "./camera";
import ifftStageWgsl from "./ifft-stage.wgsl";
import initialSpectrumWgsl from "./initial-spectrum.wgsl";
import noiseWgsl from "./noise.wgsl";
import normalFoamWgsl from "./normal-foam.wgsl";
import {
  createIfftStageTable,
  OCEAN_RESOLUTION,
  type IfftStage,
  type SimulationTargetName,
} from "./ocean-graph";
import particlesWgsl from "./particles.wgsl";
import presentWgsl from "./present.wgsl";
import spectrumWgsl from "./spectrum.wgsl";
import { gaussianCoefficients, OCEAN_TUNING } from "./tuning";

type Output = Surface | Target;

interface RendererOptions {
  readonly canvas: HTMLCanvasElement;
}

const SIM_FORMAT: GPUTextureFormat = "rgba32float";
const HDR_FORMAT: GPUTextureFormat = "rgba16float";
const TRANSPARENT = [0, 0, 0, 0] as const;

export function createRenderer({ canvas }: RendererOptions) {
  let disposed = false;
  let gpu: Gpu | undefined;
  let output: Surface | undefined;
  let graph: OceanGraph | undefined;
  let unsubscribeResize: (() => void) | undefined;
  let resizeFrame = 0;
  let resizeGeneration = 0;

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    resizeGeneration++;
    runCleanups([
      () => {
        if (resizeFrame) cancelAnimationFrame(resizeFrame);
      },
      () => unsubscribeResize?.(),
      () => gpu?.dispose(),
    ]);
  }

  function fail(error: unknown): never {
    try {
      dispose();
    } catch {
      // Teardown must not replace the render, resize, or preparation failure.
    }
    throw error;
  }

  const rebuild = async (generation: number) => {
    if (disposed || !gpu || !output || !graph) return;
    if (sameSize(graph.scene.size, output.size)) return;
    const next = await createGraph(
      gpu,
      output,
      `fft-ocean-resize-${generation}`
    );
    if (disposed) return;
    if (generation !== resizeGeneration) {
      try {
        destroyGraph(next);
      } catch {
        // A newer resize owns the renderer; this stale graph is best-effort only.
      }
      return;
    }
    const previous = graph;
    graph = next;
    destroyGraph(previous);
  };

  const scheduleResize = () => {
    if (disposed || resizeFrame) return;
    const generation = ++resizeGeneration;
    resizeFrame = requestAnimationFrame(async () => {
      resizeFrame = 0;
      try {
        await rebuild(generation);
      } catch (error) {
        if (!disposed && generation === resizeGeneration) fail(error);
      }
    });
  };

  const initialize = async () => {
    const { init } = await import("vgpu");
    if (disposed) return;
    const nextGpu = await init();
    if (disposed) {
      nextGpu.dispose();
      return;
    }

    gpu = nextGpu;
    output = surface(gpu, canvas, { dpr: [1, 1.6] });
    graph = await createGraph(gpu, output, "fft-ocean-live");
    if (disposed) return;

    unsubscribeResize = output.onResize(scheduleResize);

    const time = clock(gpu);
    frameLoop(gpu, (currentFrame) => {
      if (disposed || !graph || !output) return;
      try {
        setDynamics(graph, time.time * OCEAN_TUNING.simulation.timeScale);
        renderGraph(currentFrame, graph, output);
      } catch (error) {
        fail(error);
      }
    });
  };

  const ready = initialize().catch((error: unknown) => {
    if (!disposed) fail(error);
  });

  return { ready, dispose };
}

export async function createGraph(
  gpu: Gpu,
  output: Output,
  label: string
): Promise<OceanGraph> {
  const ownedTargets: Target[] = [];
  try {
    const graph = buildGraph(gpu, output, label, (value) => {
      ownedTargets.push(value);
      return value;
    });
    await prewarm(graph, output);
    return graph;
  } catch (error) {
    try {
      destroyTargets(ownedTargets);
    } catch {
      // Partial-allocation cleanup must not replace the construction failure.
    }
    throw error;
  }
}

function buildGraph(
  gpu: Gpu,
  output: Output,
  label: string,
  own: (value: Target) => Target
) {
  const resolution = OCEAN_RESOLUTION;
  const createTarget = (
    name: string,
    size: readonly [number, number],
    format: GPUTextureFormat
  ) => own(target(gpu, { size, format, label: `${label}-${name}` }));
  const simulationTarget = (name: string) =>
    createTarget(name, [resolution, resolution], SIM_FORMAT);
  const simulation = {
    noise: simulationTarget("noise"),
    h0: simulationTarget("h0"),
    spectrum: simulationTarget("spectrum"),
    ping: simulationTarget("ping"),
    pong: simulationTarget("pong"),
    normalFoam: simulationTarget("normal-foam"),
  };
  const sizes = bloomSizes(output.size);
  const scene = createTarget("scene", normalizedSize(output.size), HDR_FORMAT);
  const bright = createTarget("bright", sizes[0]!, HDR_FORMAT);
  const composite = createTarget("composite", sizes[0]!, HDR_FORMAT);
  const linearSampler = sampler(gpu, {
    minFilter: "linear",
    magFilter: "linear",
  });

  const noiseEffect = configuredEffect(gpu, noiseWgsl, `${label}-noise`);
  const initialSpectrum = configuredEffect(
    gpu,
    initialSpectrumWgsl,
    `${label}-initial-spectrum`,
    {
      u: {
        resolution,
        size: OCEAN_TUNING.simulation.oceanSize,
        windSpeed: OCEAN_TUNING.simulation.windSpeed,
        windAngle: OCEAN_TUNING.simulation.windAngle,
        amplitude: OCEAN_TUNING.simulation.amplitude,
      },
      u_noise: simulation.noise,
    }
  );
  const evolveSpectrum = configuredEffect(
    gpu,
    spectrumWgsl,
    `${label}-spectrum`,
    {
      u: {
        resolution,
        size: OCEAN_TUNING.simulation.oceanSize,
        time: 0,
        choppiness: OCEAN_TUNING.simulation.choppiness,
      },
      u_initialSpectrum: simulation.h0,
    }
  );

  const simulationTargets: Record<SimulationTargetName, Target> = {
    spectrum: simulation.spectrum,
    ping: simulation.ping,
    pong: simulation.pong,
  };
  const ifft = createIfftStageTable().map((spec: IfftStage) => ({
    spec,
    effect: configuredEffect(
      gpu,
      ifftStageWgsl,
      `${label}-ifft-${spec.index}-${spec.horizontal ? "h" : "v"}`,
      {
        u: {
          resolution,
          subtransformSize: spec.subtransformSize,
          horizontal: spec.horizontal ? 1 : 0,
        },
        u_input: simulationTargets[spec.input],
      }
    ),
    output: simulationTargets[spec.output],
  }));
  const displacement = ifft.at(-1)!.output;
  const normals = configuredEffect(
    gpu,
    normalFoamWgsl,
    `${label}-normal-foam`,
    {
      u: {
        resolution,
        worldSize: OCEAN_TUNING.simulation.worldSize,
        displacementScale: OCEAN_TUNING.simulation.displacementScale,
        foamThreshold: OCEAN_TUNING.simulation.foamThreshold,
      },
      u_displacement: displacement,
    }
  );
  const particles = draw(gpu, {
    shader: particlesWgsl,
    vertices: 6,
    instances: resolution * resolution,
    blend: {
      color: { src: "src-alpha", dst: "one" },
      alpha: { src: "one", dst: "one" },
    },
    label: `${label}-particles`,
  }).set({
    u_displacement: displacement,
    u_normalFoam: simulation.normalFoam,
  });
  setParticleConstants(particles, output);
  const brightEffect = configuredEffect(
    gpu,
    bloomBrightWgsl,
    `${label}-bloom-bright`,
    {
      uniforms: {
        luminosityThreshold: OCEAN_TUNING.bloom.threshold,
        smoothWidth: OCEAN_TUNING.bloom.smoothWidth,
      },
      tDiffuse: scene,
      linearSampler,
    }
  );

  let bloomInput = bright;
  const levels = sizes.map((size, index) => {
    const horizontal = createTarget(`bloom-h${index}`, size, HDR_FORMAT);
    const vertical = createTarget(`bloom-v${index}`, size, HDR_FORMAT);
    const radius = OCEAN_TUNING.bloom.kernelRadii[index]!;
    const horizontalEffect = makeBlur(
      gpu,
      `${label}-blur-h${index}`,
      bloomInput,
      horizontal,
      linearSampler,
      [1, 0],
      radius
    );
    const verticalEffect = makeBlur(
      gpu,
      `${label}-blur-v${index}`,
      horizontal,
      vertical,
      linearSampler,
      [0, 1],
      radius
    );
    bloomInput = vertical;
    return { horizontal, vertical, horizontalEffect, verticalEffect };
  });
  const compositeEffect = configuredEffect(
    gpu,
    bloomCompositeWgsl,
    `${label}-bloom-composite`,
    {
      uniforms: {
        bloomStrength: OCEAN_TUNING.bloom.strength,
        bloomRadius: OCEAN_TUNING.bloom.radius,
        bloomFactors0: [1, 0.8, 0.6, 0.4],
        bloomFactors1: [0.2, 0, 0, 0],
      },
      blurTexture1: levels[0]!.vertical,
      blurTexture2: levels[1]!.vertical,
      blurTexture3: levels[2]!.vertical,
      blurTexture4: levels[3]!.vertical,
      blurTexture5: levels[4]!.vertical,
      linearSampler,
    }
  );
  const present = configuredEffect(gpu, presentWgsl, `${label}-present`, {
    sceneHDR: scene,
    bloomTexture: composite,
    linearSampler,
  });
  return {
    simulation,
    scene,
    bloom: { bright, composite, levels },
    effects: {
      noise: noiseEffect,
      initialSpectrum,
      evolveSpectrum,
      normals,
      bright: brightEffect,
      composite: compositeEffect,
      present,
    },
    ifft,
    particles,
    needsInitialSpectrum: true,
  };
}

export type OceanGraph = ReturnType<typeof buildGraph>;

function configuredEffect(
  gpu: Gpu,
  shader: string | ShaderSource,
  label: string,
  bindings?: Record<string, unknown>
): Effect {
  const configured = effect(gpu, shader, { label });
  return bindings ? configured.set(bindings) : configured;
}

function makeBlur(
  gpu: Gpu,
  label: string,
  source: Target,
  output: Target,
  linearSampler: GPUSampler,
  direction: readonly [number, number],
  kernelRadius: number
): Effect {
  const blur = effect(gpu, bloomBlurWgsl, { label });
  const coefficients = gaussianCoefficients(kernelRadius);
  blur.set({
    uniforms: {
      direction,
      invSize: output.texelSize,
      gaussianCoefficients0: coefficients.slice(0, 4),
      gaussianCoefficients1: coefficients.slice(4, 8),
      gaussianCoefficients2: coefficients.slice(8, 12),
      gaussianCoefficients3: coefficients.slice(12, 16),
      gaussianCoefficients4: coefficients.slice(16, 20),
      gaussianCoefficients5: coefficients.slice(20, 24),
    },
    colorTexture: source,
    linearSampler,
  });
  return blur;
}

async function prewarm(graph: OceanGraph, output: Output): Promise<void> {
  const results = await Promise.allSettled([
    graph.effects.noise.compile(graph.simulation.noise),
    graph.effects.initialSpectrum.compile(graph.simulation.h0),
    graph.effects.evolveSpectrum.compile(graph.simulation.spectrum),
    ...graph.ifft.map(({ effect, output }) => effect.compile(output)),
    graph.effects.normals.compile(graph.simulation.normalFoam),
    graph.particles.compile(graph.scene),
    graph.effects.bright.compile(graph.bloom.bright),
    ...graph.bloom.levels.flatMap((level) => [
      level.horizontalEffect.compile(level.horizontal),
      level.verticalEffect.compile(level.vertical),
    ]),
    graph.effects.composite.compile(graph.bloom.composite),
    graph.effects.present.compile({ colors: [output.format] }),
  ]);
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  if (failure) throw failure.reason;
}

function setDynamics(graph: OceanGraph, timeSeconds: number): void {
  graph.effects.evolveSpectrum.set({
    u: { time: timeSeconds * OCEAN_TUNING.simulation.spectrumTimeScale },
  });
}

function setParticleConstants(particles: Draw, output: Output): void {
  const camera = oceanCamera(output.size);
  const tuning = OCEAN_TUNING;
  particles.set({
    u: {
      view: camera.view,
      projection: camera.projection,
      viewport: [output.size[0], output.size[1], 1, OCEAN_RESOLUTION],
      world: [
        tuning.simulation.worldSize,
        tuning.simulation.displacementScale,
        tuning.particles.pointSize,
        0,
      ],
      fade: [
        tuning.particles.fadeNear,
        tuning.particles.fadeFar,
        tuning.particles.fadePower,
        0,
      ],
      oceanColor: tuning.particles.oceanColor,
      neonColor: tuning.particles.neonColor,
      foamColor: tuning.particles.foamColor,
    },
  });
}

export function renderAt(
  gpu: Gpu,
  graph: OceanGraph,
  output: Target,
  time: number
): void {
  setDynamics(graph, time);
  frame(gpu, (currentFrame) => renderGraph(currentFrame, graph, output));
}

export function renderGraph(
  currentFrame: Frame,
  graph: OceanGraph,
  output: Output
): void {
  const pass = (target: Output, drawable: Draw | Effect) =>
    currentFrame.pass({ target, clear: TRANSPARENT }, (encoder) =>
      encoder.draw(drawable)
    );
  if (graph.needsInitialSpectrum) {
    pass(graph.simulation.noise, graph.effects.noise);
    pass(graph.simulation.h0, graph.effects.initialSpectrum);
    graph.needsInitialSpectrum = false;
  }
  pass(graph.simulation.spectrum, graph.effects.evolveSpectrum);
  for (const stage of graph.ifft) {
    pass(stage.output, stage.effect);
  }
  pass(graph.simulation.normalFoam, graph.effects.normals);
  pass(graph.scene, graph.particles);
  pass(graph.bloom.bright, graph.effects.bright);
  for (const level of graph.bloom.levels) {
    pass(level.horizontal, level.horizontalEffect);
    pass(level.vertical, level.verticalEffect);
  }
  pass(graph.bloom.composite, graph.effects.composite);
  pass(output, graph.effects.present);
}

export function bloomSizes(
  size: readonly [number, number]
): [number, number][] {
  let width = Math.max(1, Math.round(size[0] / 2));
  let height = Math.max(1, Math.round(size[1] / 2));
  return Array.from({ length: OCEAN_TUNING.bloom.levels }, () => {
    const level: [number, number] = [width, height];
    width = Math.max(1, Math.round(width / 2));
    height = Math.max(1, Math.round(height / 2));
    return level;
  });
}

export function destroyGraph(graph: OceanGraph): void {
  destroyTargets([
    ...Object.values(graph.simulation),
    graph.scene,
    graph.bloom.bright,
    graph.bloom.composite,
    ...graph.bloom.levels.flatMap((level) => [
      level.horizontal,
      level.vertical,
    ]),
  ]);
}

function destroyTargets(targets: readonly Target[]): void {
  runCleanups(
    [...targets].reverse().map((value) => () => value.color.destroy())
  );
}

function runCleanups(cleanups: readonly (() => void)[]): void {
  let firstError: unknown;
  let failed = false;
  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch (error) {
      if (!failed) firstError = error;
      failed = true;
    }
  }
  if (failed) throw firstError;
}

function normalizedSize(size: readonly [number, number]): [number, number] {
  return [Math.max(1, Math.floor(size[0])), Math.max(1, Math.floor(size[1]))];
}

function sameSize(a: readonly number[], b: readonly number[]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}
