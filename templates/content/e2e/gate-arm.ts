// Kept apart from live-body-gate.ts, which imports helpers.ts: helpers reads
// the arm too, and an import cycle would hand one of them an unset arm.

export type GateArm = "off" | "on";

function readArm(): GateArm {
  const raw = process.env.CONTENT_LIVE_BODY_GATE ?? "off";
  if (raw === "off" || raw === "on") return raw;
  throw new Error(
    `CONTENT_LIVE_BODY_GATE must be "off" or "on", not ${JSON.stringify(raw)}.`,
  );
}

/** Which side of the D2 gate this run checks: CI runs the lane once per arm. */
export const GATE_ARM: GateArm = readArm();
