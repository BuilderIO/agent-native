import { describe, expect, it } from "vitest";

import { ByteTimeMap, resolveSeekFragment } from "./fmp4-seek";

const INIT_LENGTH = 1157;
const PROBE_SIZE = 1024 * 1024;

interface Fragment {
  byte: number;
  sec: number;
}

function buildFragments(opts: {
  durationSec: number;
  fragmentSec: number;
  bitrateAt: (sec: number) => number;
}): Fragment[] {
  const fragments: Fragment[] = [];
  let byte = INIT_LENGTH;
  for (let sec = 0; sec < opts.durationSec; sec += opts.fragmentSec) {
    fragments.push({ byte, sec });
    byte += Math.round(opts.bitrateAt(sec) * opts.fragmentSec);
  }
  return fragments;
}

function totalBytesOf(fragments: Fragment[], trailing = 400_000): number {
  return fragments[fragments.length - 1].byte + trailing;
}

function makeProbe(fragments: Fragment[]) {
  const calls: number[] = [];
  return {
    calls,
    probe: async (startByte: number): Promise<Fragment | null> => {
      calls.push(startByte);
      return fragments.find((f) => f.byte >= startByte) ?? null;
    },
  };
}

function resolve(
  fragments: Fragment[],
  target: number,
  durationSec: number,
  overrides: { totalBytes?: number | null; maxProbes?: number } = {},
) {
  const map = new ByteTimeMap(INIT_LENGTH);
  map.add(fragments[0].byte, fragments[0].sec);
  const { probe, calls } = makeProbe(fragments);
  const totalBytes =
    overrides.totalBytes === undefined
      ? totalBytesOf(fragments)
      : overrides.totalBytes;

  return resolveSeekFragment<Fragment>({
    target,
    initLength: INIT_LENGTH,
    probeSize: PROBE_SIZE,
    maxProbes: overrides.maxProbes ?? 6,
    acceptUndershootSeconds: 4,
    estimate: () => map.estimate(target, { totalBytes, durationSec }),
    probe: async (startByte) => {
      const found = await probe(startByte);
      if (found) map.add(found.byte, found.sec);
      return found;
    },
  }).then((result) => ({ ...result, calls }));
}

describe("ByteTimeMap", () => {
  it("interpolates between the anchors that bracket the target", () => {
    const map = new ByteTimeMap(1000);
    map.add(1000, 0);
    map.add(11_000, 10);
    expect(map.estimate(5, { totalBytes: 21_000, durationSec: 20 })).toBe(6000);
  });

  it("prefers real anchors over the end-of-file anchor", () => {
    const map = new ByteTimeMap(0);
    map.add(0, 0);
    map.add(1000, 10);
    expect(map.estimate(5, { totalBytes: 50_000, durationSec: 20 })).toBe(500);
  });

  it("extrapolates from observed bitrate when the total is unknown", () => {
    const map = new ByteTimeMap(0);
    map.add(1000, 10);
    expect(map.estimate(20, { totalBytes: null, durationSec: 20 })).toBe(2000);
  });

  it("falls back to the init length with nothing observed", () => {
    const map = new ByteTimeMap(1157);
    expect(map.estimate(300, { totalBytes: null, durationSec: 600 })).toBe(
      1157,
    );
  });

  it("ignores anchors before the init segment", () => {
    const map = new ByteTimeMap(1000);
    map.add(10, 5);
    expect(map.size).toBe(0);
  });
});

describe("resolveSeekFragment", () => {
  const vbr = buildFragments({
    durationSec: 581,
    fragmentSec: 1,
    bitrateAt: (sec) => (sec < 290 ? 380_000 : 600_000),
  });

  it("never lands past the target across the whole timeline", async () => {
    for (let target = 10; target < 575; target += 10) {
      const { chosen, overshot } = await resolve(vbr, target, 581);
      expect(chosen, `target ${target}`).not.toBeNull();
      expect(overshot, `target ${target}`).toBe(false);
      expect(chosen!.sec, `target ${target}`).toBeLessThanOrEqual(target);
    }
  });

  it("lands close enough that the gap is quick to fill", async () => {
    for (let target = 10; target < 575; target += 10) {
      const { chosen } = await resolve(vbr, target, 581);
      expect(target - chosen!.sec, `target ${target}`).toBeLessThanOrEqual(4);
    }
  });

  it("stays inside a small probe budget", async () => {
    const { calls } = await resolve(vbr, 300, 581);
    expect(calls.length).toBeLessThanOrEqual(3);
  });

  it("steps back with a growing stride past an oversized fragment", async () => {
    const fragments: Fragment[] = [
      { byte: INIT_LENGTH, sec: 0 },
      { byte: INIT_LENGTH + 1_000_000, sec: 10 },
      { byte: INIT_LENGTH + 2_000_000, sec: 20 },
      { byte: INIT_LENGTH + 12_000_000, sec: 30 }, // 10MB fragment
      { byte: INIT_LENGTH + 13_000_000, sec: 40 },
    ];
    const { chosen, overshot, calls } = await resolve(fragments, 29, 50);
    expect(overshot).toBe(false);
    expect(chosen!.sec).toBe(20);
    expect(calls.length).toBeLessThanOrEqual(6);
  });

  it("finds the first fragment when the target is near the start", async () => {
    const { chosen, overshot } = await resolve(vbr, 1, 581);
    expect(overshot).toBe(false);
    expect(chosen!.sec).toBeLessThanOrEqual(1);
  });

  it("still probes a bracket narrower than one probe window", async () => {
    const dense = buildFragments({
      durationSec: 581,
      fragmentSec: 1,
      bitrateAt: () => 200_000,
    });
    const { chosen, overshot } = await resolve(dense, 1, 100);
    expect(overshot).toBe(false);
    expect(chosen!.sec).toBeLessThanOrEqual(1);
  });

  it("never lands past the target on a uniform-bitrate clip either", async () => {
    const uniform = buildFragments({
      durationSec: 300,
      fragmentSec: 1,
      bitrateAt: () => 500_000,
    });
    for (let target = 1; target < 300; target += 7) {
      const { chosen, overshot } = await resolve(uniform, target, 300);
      expect(overshot, `target ${target}`).toBe(false);
      expect(chosen!.sec, `target ${target}`).toBeLessThanOrEqual(target);
    }
  });

  it("reports an overshoot when every fragment starts after the target", async () => {
    const fragments: Fragment[] = [{ byte: INIT_LENGTH + 5_000_000, sec: 100 }];
    const { chosen, overshot } = await resolve(fragments, 10, 200);
    expect(overshot).toBe(true);
    expect(chosen!.sec).toBe(100);
  });

  it("steps back instead of giving up when a probe runs past the end", async () => {
    const fragments = buildFragments({
      durationSec: 100,
      fragmentSec: 1,
      bitrateAt: () => 100_000,
    });
    const { chosen, overshot } = await resolve(fragments, 95, 400, {
      totalBytes: null,
    });
    expect(overshot).toBe(false);
    expect(chosen!.sec).toBeLessThanOrEqual(95);
    expect(chosen!.sec).toBeGreaterThan(80);
  });

  it("returns no fragment rather than a wrong one when nothing is readable", async () => {
    const { chosen, overshot, probes } = await resolveSeekFragment<Fragment>({
      target: 100,
      initLength: INIT_LENGTH,
      probeSize: PROBE_SIZE,
      maxProbes: 6,
      acceptUndershootSeconds: 4,
      estimate: () => INIT_LENGTH,
      probe: async () => null,
      superseded: () => false,
    });
    expect(chosen).toBeNull();
    expect(overshot).toBe(false);
    expect(probes).toBeGreaterThan(0);
  });

  it("abandons immediately when a newer seek supersedes it", async () => {
    let probed = 0;
    const result = await resolveSeekFragment<Fragment>({
      target: 100,
      initLength: INIT_LENGTH,
      probeSize: PROBE_SIZE,
      maxProbes: 6,
      acceptUndershootSeconds: 4,
      estimate: () => INIT_LENGTH,
      probe: async () => {
        probed++;
        return null;
      },
      superseded: () => true,
    });
    expect(result.superseded).toBe(true);
    expect(result.chosen).toBeNull();
    expect(probed).toBe(0);
  });
});
