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
  type FrameLoopHandle,
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
import { DEFAULT_OCEAN_COLORS, type OceanColors } from "./ocean-colors";
import {
  createIfftStageTable,
  OCEAN_RESOLUTION,
  type IfftStage,
  type SimulationTargetName,
} from "./ocean-graph";
import { createParticleBudget } from "./particle-budget";
import particlesWgsl from "./particles.wgsl";
import {
  POINTER_POSITION_EASING,
  POINTER_STRENGTH_EASING,
  projectPointerToOcean,
} from "./pointer";
import presentWgsl from "./present.wgsl";
import spectrumWgsl from "./spectrum.wgsl";
import { gaussianCoefficients, OCEAN_TUNING } from "./tuning";

type Output = Surface | Target;

interface RendererOptions {
  readonly canvas: HTMLCanvasElement;
  readonly colors?: OceanColors;
  readonly fps?: number;
  /**
   * Called once for any failure after construction -- init, resize rebuild, or
   * a throw inside the frame loop. Without it those failures rethrow, which in
   * the frame loop means an uncaught error and a hero that silently stops
   * updating. The caller is expected to swap in the fallback background.
   */
  readonly onError?: (error: unknown) => void;
}

const SIM_FORMAT: GPUTextureFormat = "rgba32float";
const HDR_FORMAT: GPUTextureFormat = "rgba16float";
const TRANSPARENT = [0, 0, 0, 0] as const;

export function createRenderer({
  canvas,
  colors,
  fps,
  onError,
}: RendererOptions) {
  let disposed = false;
  let currentColors: OceanColors = colors ?? DEFAULT_OCEAN_COLORS;
  let loop: FrameLoopHandle | undefined;
  let paused = false;
  let failed = false;
  let rebuilding = false;
  let resizePending = false;
  let releaseErrorListener: (() => void) | undefined;
  const budget = createParticleBudget();
  let lastFrameAt = 0;
  // Continuous, and always behind budget.level while a downgrade ramps in.
  let liveLevel = 0;
  // Normalized device coordinates, eased on the frame clock rather than on
  // pointermove: the lag is the effect, and mouse events do not arrive on a
  // steady cadence.
  let pointerX = 0;
  let pointerY = 0;
  let pointerStrength = 0;
  let targetPointerX = 0;
  let targetPointerY = 0;
  let targetPointerStrength = 0;

  // Distinct from `ready`, which only means initialize() returned -- the frame
  // loop is registered by then but has not run. Callers that reveal the canvas
  // need the first drawn frame, or they fade in an empty surface.
  let signalFirstFrame: () => void = () => {};
  let signalFirstFrameFailed: (error: unknown) => void = () => {};
  const firstFrame = new Promise<void>((resolve, reject) => {
    signalFirstFrame = resolve;
    signalFirstFrameFailed = reject;
  });
  // Failure is delivered through onError; this keeps the rejection from
  // surfacing as an unhandled promise when no caller awaits firstFrame.
  firstFrame.catch(() => {});
  let drewOnce = false;
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
      () => loop?.stop(),
      () => releaseErrorListener?.(),
      () => unsubscribeResize?.(),
      () => gpu?.dispose(),
    ]);
  }

  function fail(error: unknown): never | void {
    const first = !failed;
    failed = true;
    try {
      dispose();
      // The original failure is rethrown or handed to onError immediately
      // below; a teardown error raised here would replace that real cause.
      // coercion-ok: the caller still receives the failure that started this.
    } catch {}
    // Never resolves after a failure: fulfilling it would let a caller fade in
    // a dead canvas at the same moment onError demotes to the fallback.
    if (first) signalFirstFrameFailed(error);
    if (!onError) throw error;
    // Only the first failure is reported: dispose() can cascade, and the
    // caller swaps backgrounds on the first one anyway.
    if (first) onError(error);
  }

  const rebuild = async (generation: number) => {
    if (disposed || !gpu || !output || !graph) return;
    if (sameSize(graph.scene.size, output.size)) return;
    const next = await createGraph(
      gpu,
      output,
      `fft-ocean-resize-${generation}`,
      currentColors,
      liveLevel,
    );
    if (disposed) return;
    if (generation !== resizeGeneration) {
      try {
        destroyGraph(next);
      } catch {
        // coercion-ok: a newer resize already owns the live graph, so freeing
        // this superseded one is best-effort -- failing wastes GPU memory but
        // cannot corrupt the frame on screen.
      }
      return;
    }
    const previous = graph;
    graph = next;
    destroyGraph(previous);
    // The frame either side of a rebuild straddles the allocation, not the
    // steady-state draw cost.
    budget.discardNextInterval();
  };

  const scheduleResize = () => {
    if (disposed) return;
    // A rebuild allocates six 512x512 rgba32float simulation targets plus the
    // HDR and bloom chain. resizeFrame alone does not stop a drag-resize from
    // starting the next one mid-flight, because it is cleared before the await
    // -- so overlapping rebuilds would each pay that cost concurrently and the
    // generation check would only free them afterwards. One at a time, then
    // one more pass for whatever size the drag settled on.
    if (rebuilding) {
      resizePending = true;
      return;
    }
    if (resizeFrame) return;
    const generation = ++resizeGeneration;
    resizeFrame = requestAnimationFrame(async () => {
      resizeFrame = 0;
      rebuilding = true;
      try {
        await rebuild(generation);
      } catch (error) {
        if (!disposed && generation === resizeGeneration) fail(error);
      } finally {
        rebuilding = false;
      }
      if (resizePending && !disposed) {
        resizePending = false;
        scheduleResize();
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
    graph = await createGraph(gpu, output, "fft-ocean-live", currentColors);
    if (disposed) return;

    unsubscribeResize = output.onResize(scheduleResize);

    // The frame callback's try/catch only covers what runs inside it. vgpu
    // reports validation failures asynchronously, and a lost device surfaces
    // on the GPUDevice itself -- neither reaches that catch, so without these
    // the hero keeps a frozen ocean mounted and never demotes.
    releaseErrorListener = nextGpu.onError((error) => {
      if (!disposed) fail(error);
    });
    void nextGpu.gpu.lost.then((info) => {
      if (!disposed) fail(new Error(`WebGPU device lost: ${info.reason}`));
    });

    const time = clock(gpu);
    loop = frameLoop(
      gpu,
      (currentFrame) => {
        if (disposed || paused || !graph || !output) return;
        try {
          const now = performance.now();
          if (lastFrameAt) budget.record(now - lastFrameAt);
          lastFrameAt = now;
          easeParticleLevel(graph);
          easePointer();
          setPointerUniform(
            graph,
            output.size,
            pointerX,
            pointerY,
            pointerStrength,
          );
          setDynamics(graph, time.time * OCEAN_TUNING.simulation.timeScale);
          renderGraph(currentFrame, graph, output);
          if (!drewOnce) {
            drewOnce = true;
            signalFirstFrame();
          }
        } catch (error) {
          fail(error);
        }
      },
      fps === undefined ? undefined : { fps },
    );
  };

  const ready = initialize().catch((error: unknown) => {
    if (!disposed) fail(error);
  });

  /**
   * A theme flip must not rebuild the graph: the simulation targets are six
   * 512x512 rgba32float textures and reallocating them stalls the frame the
   * user is watching the toggle in.
   */
  /**
   * Skips frame work while the hero is scrolled out of view. The loop stays
   * registered rather than being stopped and rebuilt, so resuming costs one
   * boolean instead of a device round trip.
   */
  function setPaused(next: boolean): void {
    paused = next;
    // The first interval after a resume spans the whole scrolled-out stretch,
    // which is not a frame this GPU was too slow to draw.
    if (!next) budget.discardNextInterval();
  }

  // Walks the live level toward whatever the budget has decided, a fraction of
  // a level per frame. The ramp is the point: the shader fades out exactly the
  // particles the next whole level stops drawing, so a slow crossing reads as
  // the field quietly getting sparser rather than a quarter of it blinking out.
  function easeParticleLevel(current: OceanGraph): void {
    const target = budget.level;
    if (liveLevel >= target) return;
    liveLevel = Math.min(
      target,
      liveLevel + OCEAN_TUNING.adaptive.levelEasePerFrame,
    );
    setParticleLevel(current, liveLevel);
  }

  function easePointer(): void {
    pointerX += (targetPointerX - pointerX) * POINTER_POSITION_EASING;
    pointerY += (targetPointerY - pointerY) * POINTER_POSITION_EASING;
    pointerStrength +=
      (targetPointerStrength - pointerStrength) * POINTER_STRENGTH_EASING;
    // Snap the tail to zero so an off-screen cursor stops writing a uniform
    // whose effect has already fallen below a pixel.
    if (targetPointerStrength === 0 && pointerStrength < 0.001) {
      pointerStrength = 0;
    }
  }

  /**
   * Aims the cursor deformation, in normalized device coordinates. Strength 0 lets
   * it decay away rather than cutting it, so leaving the hero eases out.
   */
  function setPointer(ndcX: number, ndcY: number, strength: number): void {
    targetPointerX = ndcX;
    targetPointerY = ndcY;
    targetPointerStrength = strength;
  }

  function setColors(next: OceanColors): void {
    if (disposed) return;
    currentColors = next;
    if (graph) setPresentColors(graph, next);
  }

  return { ready, firstFrame, dispose, setColors, setPaused, setPointer };
}

export type OceanRenderer = ReturnType<typeof createRenderer>;

export async function createGraph(
  gpu: Gpu,
  output: Output,
  label: string,
  colors: OceanColors = DEFAULT_OCEAN_COLORS,
  level = 0,
): Promise<OceanGraph> {
  const ownedTargets: Target[] = [];
  try {
    const graph = buildGraph(gpu, output, label, colors, level, (value) => {
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
  colors: OceanColors,
  level: number,
  own: (value: Target) => Target,
) {
  const resolution = OCEAN_RESOLUTION;
  const createTarget = (
    name: string,
    size: readonly [number, number],
    format: GPUTextureFormat,
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
    },
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
    },
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
      },
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
    },
  );
  const particles = draw(gpu, {
    shader: particlesWgsl,
    vertices: 6,
    // Overridden per draw call from `particleInstances` below, which the frame
    // loop lowers when this GPU cannot hold the frame budget.
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
  setParticleConstants(particles, output, level);
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
    },
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
      radius,
    );
    const verticalEffect = makeBlur(
      gpu,
      `${label}-blur-v${index}`,
      horizontal,
      vertical,
      linearSampler,
      [0, 1],
      radius,
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
    },
  );
  const present = configuredEffect(gpu, presentWgsl, `${label}-present`, {
    uniforms: presentUniforms(colors),
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
    particleLevel: level,
    particleInstances: particleInstanceCount(level),
    pointerActive: false,
    needsInitialSpectrum: true,
  };
}

/**
 * Powers of two only, and floored. The shader ranks particles by trailing zeros
 * in their texel index, which is exactly the set a power-of-two stride keeps, so
 * the particles that faded out at level n are the ones dropped at level n+1. A
 * stride of 3 would drop a different set than the fade emptied and pop.
 */
export function particleStride(level: number): number {
  return 2 ** Math.max(0, Math.floor(level));
}

function particleInstanceCount(level: number): number {
  const gridSize = Math.max(
    1,
    Math.floor(OCEAN_RESOLUTION / particleStride(level)),
  );
  return gridSize * gridSize;
}

function particleWorld(level: number) {
  const tuning = OCEAN_TUNING;
  return [
    tuning.simulation.worldSize,
    tuning.simulation.displacementScale,
    // Constant across every level. Scaling it up to keep the painted area
    // constant is what makes a downgrade visible as chunkier water.
    tuning.particles.pointSize,
    particleStride(level),
  ] as const;
}

/** Retunes the particle density in place. Allocates nothing. */
export function setParticleLevel(graph: OceanGraph, level: number): void {
  graph.particleLevel = level;
  graph.particleInstances = particleInstanceCount(level);
  graph.particles.set({
    u: {
      world: particleWorld(level),
      density: [level, OCEAN_TUNING.adaptive.maxLevel, 0, 0],
    },
  });
}

export type OceanGraph = ReturnType<typeof buildGraph>;

function configuredEffect(
  gpu: Gpu,
  shader: string | ShaderSource,
  label: string,
  bindings?: Record<string, unknown>,
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
  kernelRadius: number,
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
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failure) throw failure.reason;
}

function presentUniforms(colors: OceanColors) {
  return {
    fgColor: [...colors.fg, 1] as const,
    bgColor: [...colors.bg, 1] as const,
    brightness: OCEAN_TUNING.present.brightness,
  };
}

/** Retunes the present pass in place. Allocates nothing. */
export function setPresentColors(graph: OceanGraph, colors: OceanColors): void {
  graph.effects.present.set({ uniforms: presentUniforms(colors) });
}

/**
 * Retunes the cursor deformation in place. Writes nothing once it has decayed
 * and the shader is already ignoring it, so an untouched hero pays no uniform
 * traffic for a feature nobody is using.
 */
function setPointerUniform(
  graph: OceanGraph,
  size: readonly [number, number],
  ndcX: number,
  ndcY: number,
  strength: number,
): void {
  const world =
    strength > 0 ? projectPointerToOcean(ndcX, ndcY, size) : undefined;
  if (!world) {
    if (!graph.pointerActive) return;
    graph.pointerActive = false;
    graph.particles.set({ u: { pointer: [0, 0, 0, 0] } });
    return;
  }
  graph.pointerActive = true;
  graph.particles.set({ u: { pointer: [world[0], world[1], strength, 0] } });
}

function setDynamics(graph: OceanGraph, timeSeconds: number): void {
  graph.effects.evolveSpectrum.set({
    u: { time: timeSeconds * OCEAN_TUNING.simulation.spectrumTimeScale },
  });
}

function setParticleConstants(
  particles: Draw,
  output: Output,
  level: number,
): void {
  const camera = oceanCamera(output.size);
  const tuning = OCEAN_TUNING;
  particles.set({
    u: {
      view: camera.view,
      projection: camera.projection,
      viewport: [output.size[0], output.size[1], 1, OCEAN_RESOLUTION],
      world: particleWorld(level),
      fade: [
        tuning.particles.fadeNear,
        tuning.particles.fadeFar,
        tuning.particles.fadePower,
        0,
      ],
      pointer: [0, 0, 0, 0],
      pointerShape: [
        tuning.particles.pointerRadius,
        tuning.particles.pointerPush,
        tuning.particles.pointerDepth,
        tuning.particles.pointerRim,
      ],
      density: [level, tuning.adaptive.maxLevel, 0, 0],
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
  time: number,
): void {
  setDynamics(graph, time);
  frame(gpu, (currentFrame) => renderGraph(currentFrame, graph, output));
}

export function renderGraph(
  currentFrame: Frame,
  graph: OceanGraph,
  output: Output,
): void {
  const pass = (target: Output, drawable: Draw | Effect, instances?: number) =>
    currentFrame.pass({ target, clear: TRANSPARENT }, (encoder) =>
      encoder.draw(
        drawable,
        instances === undefined ? undefined : { instances },
      ),
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
  pass(graph.scene, graph.particles, graph.particleInstances);
  pass(graph.bloom.bright, graph.effects.bright);
  for (const level of graph.bloom.levels) {
    pass(level.horizontal, level.horizontalEffect);
    pass(level.vertical, level.verticalEffect);
  }
  pass(graph.bloom.composite, graph.effects.composite);
  pass(output, graph.effects.present);
}

export function bloomSizes(
  size: readonly [number, number],
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
    [...targets].reverse().map((value) => () => value.color.destroy()),
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
