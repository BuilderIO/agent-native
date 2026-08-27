export type SimulationTargetName = "spectrum" | "ping" | "pong";

export interface IfftStage {
  readonly index: number;
  readonly axisStage: number;
  readonly horizontal: boolean;
  readonly subtransformSize: number;
  readonly input: SimulationTargetName;
  readonly output: Exclude<SimulationTargetName, "spectrum">;
}

export const OCEAN_RESOLUTION = 512 as const;
const AXIS_STAGES = 9;

/** The one immutable 18-pass Stockham table for the canonical 512² ocean. */
export function createIfftStageTable(): readonly IfftStage[] {
  return Object.freeze(
    Array.from({ length: AXIS_STAGES * 2 }, (_, index): IfftStage => {
      const output = index % 2 ? "pong" : "ping";
      return Object.freeze({
        index,
        axisStage: index % AXIS_STAGES,
        horizontal: index < AXIS_STAGES,
        subtransformSize: 2 ** ((index % AXIS_STAGES) + 1),
        input: index === 0 ? "spectrum" : output === "ping" ? "pong" : "ping",
        output,
      });
    })
  );
}
