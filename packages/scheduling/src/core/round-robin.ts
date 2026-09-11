/**
 * Round-robin host assignment.
 *
 * For a given event type, pick the host who should take the next booking.
 *
 * Strategies:
 *   - "lowest-recent-bookings" — host with fewest bookings in the rolling
 *     window (default 30 days) wins; tie-break by priority then weight.
 *   - "weighted" — distribute by relative weight; random weighted draw that's
 *     deterministic-per-timestamp (seeded for reproducibility in tests).
 *   - "calibrated" — weighted but scaled by no-show rate; hosts with high
 *     no-show rates receive fewer bookings until their rate recovers.
 *
 * Out-of-office hosts are filtered out before selection.
 */
import type { Host, RoundRobinStrategy } from "../shared/index.js";

export interface HostMetrics {
  recentBookingCount: number;
  /** 0–1; fraction of recent bookings that were no-shows */
  noShowRate: number;
}

export interface AssignRoundRobinInput {
  hosts: Host[];
  metrics: Map<string, HostMetrics>;
  excludeEmails?: Set<string>;
  strategy: RoundRobinStrategy;
  /** Deterministic seed (e.g. booking timestamp) for reproducible weighted picks */
  seed?: number;
}

export function assignRoundRobin(input: AssignRoundRobinInput): Host | null {
  const candidates = input.hosts.filter(
    (h) => !h.isFixed && !input.excludeEmails?.has(h.userEmail),
  );
  if (candidates.length === 0) return null;

  switch (input.strategy) {
    case "lowest-recent-bookings":
      return lowestBookings(candidates, input.metrics);
    case "weighted":
      return weightedPick(
        candidates,
        (h) => h.weight,
        input.seed ?? Date.now(),
      );
    case "calibrated":
      return weightedPick(
        candidates,
        (h) => {
          const m = input.metrics.get(h.userEmail);
          const penalty = m ? 1 - m.noShowRate * 0.5 : 1;
          return Math.max(0.1, h.weight * penalty);
        },
        input.seed ?? Date.now(),
      );
  }
}

function lowestBookings(
  hosts: Host[],
  metrics: Map<string, HostMetrics>,
): Host {
  const sorted = hosts.slice().sort((a, b) => {
    const ac = metrics.get(a.userEmail)?.recentBookingCount ?? 0;
    const bc = metrics.get(b.userEmail)?.recentBookingCount ?? 0;
    if (ac !== bc) return ac - bc;
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.weight !== b.weight) return b.weight - a.weight;
    return a.userEmail.localeCompare(b.userEmail);
  });
  return sorted[0];
}

function weightedPick(
  hosts: Host[],
  weightOf: (h: Host) => number,
  seed: number,
): Host {
  const weights = hosts.map(weightOf);
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return hosts[0];
  const rand = mulberry32(seed)();
  let r = rand * total;
  for (let i = 0; i < hosts.length; i++) {
    r -= weights[i];
    if (r <= 0) return hosts[i];
  }
  return hosts[hosts.length - 1];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
