import type { NativePresentationSurface } from "./native-presentation-pair";

export interface NativePresentationLease<Context> {
  readonly surface: NativePresentationSurface<Context>;
}

type LeaseState<Context> = {
  lease: NativePresentationLease<Context>;
  phase: "reserved" | "preflight" | "published" | "rolled-back";
  previous: NativePresentationSurface<Context> | null;
};

export class NativePresentationLeaseError extends Error {
  constructor(
    readonly code:
      | "presentation-slots-retired"
      | "presentation-slots-full"
      | "presentation-lease-stale"
      | "presentation-lease-state-invalid"
      | "presentation-front-disconnected"
      | "presentation-spare-visible"
      | "presentation-front-changed",
  ) {
    super(code);
    this.name = "NativePresentationLeaseError";
  }
}

export class NativePresentationSlots<Context> {
  private readonly entries: NativePresentationSurface<Context>[];
  private readonly leases = new Map<
    NativePresentationLease<Context>,
    LeaseState<Context>
  >();
  private retired = false;

  constructor(
    private front: NativePresentationSurface<Context>,
    private readonly makeSpare: (
      front: NativePresentationSurface<Context>,
    ) => NativePresentationSurface<Context>,
    private readonly retire: (
      surface: NativePresentationSurface<Context>,
    ) => void,
  ) {
    this.entries = [front];
  }

  visible(): NativePresentationSurface<Context> {
    return this.front;
  }

  surfaces(): readonly NativePresentationSurface<Context>[] {
    return [...this.entries];
  }

  reserve(): NativePresentationLease<Context> {
    this.assertLive();
    if (!this.front.canvas.isConnected)
      throw new NativePresentationLeaseError("presentation-front-disconnected");
    if (this.leases.size >= 2)
      throw new NativePresentationLeaseError("presentation-slots-full");
    const occupied = new Set<NativePresentationSurface<Context>>([this.front]);
    for (const state of this.leases.values()) {
      occupied.add(state.lease.surface);
      if (state.previous) occupied.add(state.previous);
    }
    let spare = this.entries.find((entry) => !occupied.has(entry));
    if (!spare) {
      if (this.entries.length >= 3)
        throw new NativePresentationLeaseError("presentation-slots-full");
      spare = this.makeSpare(this.front);
      if (
        spare.canvas.isConnected ||
        this.entries.some((entry) => entry.canvas === spare!.canvas)
      )
        throw new NativePresentationLeaseError("presentation-spare-visible");
      this.entries.push(spare);
    }
    if (spare.canvas.isConnected)
      throw new NativePresentationLeaseError("presentation-spare-visible");
    spare.canvas.style.cssText = this.front.canvas.style.cssText;
    if (spare.canvas.width !== this.front.canvas.width)
      spare.canvas.width = this.front.canvas.width;
    if (spare.canvas.height !== this.front.canvas.height)
      spare.canvas.height = this.front.canvas.height;
    const lease = Object.freeze({ surface: spare });
    this.leases.set(lease, { lease, phase: "reserved", previous: null });
    return lease;
  }

  assertPublishable(lease: NativePresentationLease<Context>): void {
    const state = this.state(lease);
    if (state.phase !== "reserved" && state.phase !== "preflight")
      throw new NativePresentationLeaseError(
        "presentation-lease-state-invalid",
      );
    if (!this.front.canvas.isConnected)
      throw new NativePresentationLeaseError("presentation-front-disconnected");
    if (lease.surface.canvas.isConnected)
      throw new NativePresentationLeaseError("presentation-spare-visible");
    // FIFO transaction preflight owns the rollback front, not speculative encoding.
    if (state.phase === "reserved") {
      state.previous = this.front;
      state.phase = "preflight";
    } else if (state.previous !== this.front) {
      throw new NativePresentationLeaseError("presentation-front-changed");
    }
  }

  publish(
    lease: NativePresentationLease<Context>,
  ): NativePresentationSurface<Context> {
    const state = this.state(lease);
    if (state.phase !== "preflight")
      throw new NativePresentationLeaseError(
        "presentation-lease-state-invalid",
      );
    this.assertPublishable(lease);
    state.previous!.canvas.replaceWith(lease.surface.canvas);
    this.front = lease.surface;
    state.phase = "published";
    return this.front;
  }

  rollback(lease: NativePresentationLease<Context>): void {
    const state = this.state(lease);
    if (state.phase === "rolled-back")
      throw new NativePresentationLeaseError(
        "presentation-lease-state-invalid",
      );
    if (state.phase === "published") {
      if (
        this.front !== lease.surface ||
        !this.front.canvas.isConnected ||
        state.previous!.canvas.isConnected
      )
        throw new NativePresentationLeaseError("presentation-front-changed");
      lease.surface.canvas.replaceWith(state.previous!.canvas);
      this.front = state.previous!;
    }
    state.phase = "rolled-back";
  }

  finalize(lease: NativePresentationLease<Context>): void {
    const state = this.state(lease);
    if (state.phase !== "published" && state.phase !== "rolled-back")
      throw new NativePresentationLeaseError(
        "presentation-lease-state-invalid",
      );
    this.leases.delete(lease);
  }

  dispose(): void {
    if (this.retired) return;
    this.retired = true;
    this.leases.clear();
    for (const entry of this.entries) {
      if (entry === this.front) continue;
      entry.canvas.remove();
      this.retire(entry);
    }
  }

  private assertLive(): void {
    if (this.retired)
      throw new NativePresentationLeaseError("presentation-slots-retired");
  }

  private state(lease: NativePresentationLease<Context>): LeaseState<Context> {
    this.assertLive();
    const state = this.leases.get(lease);
    if (!state)
      throw new NativePresentationLeaseError("presentation-lease-stale");
    return state;
  }
}
