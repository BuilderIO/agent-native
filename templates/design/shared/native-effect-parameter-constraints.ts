export type EffectParameterConstraint =
  | {
      kind: "float-sum";
      properties: string[];
      maxSum: number;
    }
  | {
      kind: "ordered-floats";
      lesser: string;
      greater: string;
      minGap: number;
    }
  | {
      kind: "convex-quad";
      corners: [string, string, string, string];
      minArea: number;
      minCross: number;
    };

const PROPERTY_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const MAX_CONSTRAINTS = 8;

type ConstraintProperty = {
  type?: unknown;
  default?: unknown;
  min?: unknown;
  max?: unknown;
};

type ConstraintIssue =
  | "sum-limit"
  | "ordered-gap"
  | "quad-degenerate"
  | "quad-nonconvex";

export class NativeEffectParameterConstraintError extends Error {
  readonly code = "parameter-constraint";
  constructor(readonly issues: readonly string[]) {
    super(`Native parameter constraints rejected: ${issues.join("; ")}`);
    this.name = "NativeEffectParameterConstraintError";
  }
}

function constraintPropertyKeys(
  constraint: EffectParameterConstraint,
): string[] {
  if (constraint.kind === "ordered-floats")
    return [constraint.lesser, constraint.greater];
  if (constraint.kind === "float-sum") return constraint.properties;
  return constraint.corners;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function own(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => own(value, key))
  );
}

function boundedProperty(
  properties: Record<string, unknown>,
  key: unknown,
  type: "float" | "vec2",
): key is string {
  if (
    typeof key !== "string" ||
    !PROPERTY_NAME_RE.test(key) ||
    !own(properties, key)
  )
    return false;
  const property = properties[key];
  if (!object(property) || property.type !== type) return false;
  const { min, max } = property as ConstraintProperty;
  if (
    !finite(min) ||
    !finite(max) ||
    min >= max ||
    Math.abs(min) > 1_000_000 ||
    Math.abs(max) > 1_000_000
  )
    return false;
  if (type === "vec2" && (min !== 0 || max !== 1)) return false;
  return true;
}

function point(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every(
      (coordinate) => finite(coordinate) && coordinate >= 0 && coordinate <= 1,
    )
  );
}

function cross(
  a: [number, number],
  b: [number, number],
  c: [number, number],
): number {
  return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
}

export function evaluateParameterConstraint(
  constraint: EffectParameterConstraint,
  values: Readonly<Record<string, unknown>>,
): ConstraintIssue | null {
  if (constraint.kind === "float-sum") {
    const terms = constraint.properties.map((key) => values[key]);
    if (!terms.every(finite)) return "sum-limit";
    return terms.reduce((sum, value) => sum + value, 0) <= constraint.maxSum
      ? null
      : "sum-limit";
  }
  if (constraint.kind === "ordered-floats") {
    const lesser = values[constraint.lesser];
    const greater = values[constraint.greater];
    if (!finite(lesser) || !finite(greater)) return "ordered-gap";
    return greater - lesser >= constraint.minGap ? null : "ordered-gap";
  }
  const corners = constraint.corners.map((key) => values[key]);
  if (!corners.every(point)) return "quad-degenerate";
  const vertices = corners as [number, number][];
  const turns = vertices.map((_, index) =>
    cross(
      vertices[index],
      vertices[(index + 1) % 4],
      vertices[(index + 2) % 4],
    ),
  );
  if (turns.some((turn) => Math.abs(turn) < constraint.minCross))
    return "quad-degenerate";
  if (!turns.every((turn) => Math.sign(turn) === Math.sign(turns[0])))
    return "quad-nonconvex";
  const doubleArea = vertices.reduce((sum, vertex, index) => {
    const next = vertices[(index + 1) % 4];
    return sum + vertex[0] * next[1] - next[0] * vertex[1];
  }, 0);
  return Math.abs(doubleArea) / 2 >= constraint.minArea
    ? null
    : "quad-degenerate";
}

export function validateParameterConstraintDefinitions(
  raw: unknown,
  properties: unknown,
): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_CONSTRAINTS)
    return [`parameterConstraints needs 1–${MAX_CONSTRAINTS} entries`];
  if (!object(properties))
    return ["parameterConstraints needs declared properties"];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const [index, candidate] of raw.entries()) {
    const prefix = `parameterConstraints[${index}]`;
    if (!object(candidate)) {
      errors.push(`${prefix} is malformed`);
      continue;
    }
    let constraint: EffectParameterConstraint;
    if (candidate.kind === "float-sum") {
      if (
        !exactKeys(candidate, ["kind", "properties", "maxSum"]) ||
        !Array.isArray(candidate.properties) ||
        candidate.properties.length < 2 ||
        candidate.properties.length > 8 ||
        new Set(candidate.properties).size !== candidate.properties.length ||
        !candidate.properties.every((key) =>
          boundedProperty(properties, key, "float"),
        ) ||
        !finite(candidate.maxSum) ||
        candidate.maxSum <= 0 ||
        candidate.maxSum > 1_000_000
      ) {
        errors.push(
          `${prefix} needs two to eight distinct bounded float properties and a positive finite sum limit`,
        );
        continue;
      }
      constraint = candidate as EffectParameterConstraint;
    } else if (candidate.kind === "ordered-floats") {
      if (
        !exactKeys(candidate, ["kind", "lesser", "greater", "minGap"]) ||
        !boundedProperty(properties, candidate.lesser, "float") ||
        !boundedProperty(properties, candidate.greater, "float") ||
        candidate.lesser === candidate.greater ||
        !finite(candidate.minGap) ||
        candidate.minGap <= 0 ||
        candidate.minGap > 1_000
      ) {
        errors.push(
          `${prefix} needs two distinct bounded float properties and a positive finite gap`,
        );
        continue;
      }
      constraint = candidate as EffectParameterConstraint;
    } else if (candidate.kind === "convex-quad") {
      if (
        !exactKeys(candidate, ["kind", "corners", "minArea", "minCross"]) ||
        !Array.isArray(candidate.corners) ||
        candidate.corners.length !== 4 ||
        new Set(candidate.corners).size !== 4 ||
        !candidate.corners.every((key) =>
          boundedProperty(properties, key, "vec2"),
        ) ||
        !finite(candidate.minArea) ||
        candidate.minArea <= 0 ||
        candidate.minArea > 1 ||
        !finite(candidate.minCross) ||
        candidate.minCross <= 0 ||
        candidate.minCross > 1
      ) {
        errors.push(
          `${prefix} needs four distinct normalized vec2 properties and bounded positive area/cross limits`,
        );
        continue;
      }
      constraint = candidate as EffectParameterConstraint;
    } else {
      errors.push(`${prefix} kind is invalid`);
      continue;
    }
    const fingerprint = JSON.stringify(constraint);
    if (seen.has(fingerprint))
      errors.push(`${prefix} duplicates another constraint`);
    seen.add(fingerprint);
    const defaults = Object.fromEntries(
      constraintPropertyKeys(constraint).map((key) => [
        key,
        (properties[key] as ConstraintProperty).default,
      ]),
    );
    const issue = evaluateParameterConstraint(constraint, defaults);
    if (issue) errors.push(`${prefix} defaults violate ${issue}`);
  }
  return errors;
}

export function validateResolvedParameterConstraints(
  constraints: readonly EffectParameterConstraint[] | undefined,
  properties: Record<string, ConstraintProperty>,
  params: Readonly<Record<string, unknown>>,
): string[] {
  if (!constraints) return [];
  const values: Record<string, unknown> = {};
  for (const constraint of constraints) {
    const keys = constraintPropertyKeys(constraint);
    for (const key of keys) {
      values[key] = own(params as Record<string, unknown>, key)
        ? params[key]
        : properties[key]?.default;
    }
  }
  return constraints.flatMap((constraint, index) => {
    const issue = evaluateParameterConstraint(constraint, values);
    return issue ? [`parameterConstraints[${index}] violates ${issue}`] : [];
  });
}
