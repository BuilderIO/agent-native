const POSITIONER_KEYS = [
  "anchor",
  "side",
  "align",
  "sideOffset",
  "alignOffset",
  "collisionBoundary",
  "collisionPadding",
  "collisionAvoidance",
  "sticky",
  "arrowPadding",
  "disableAnchorTracking",
  "positionMethod",
] as const;

type PositionerKey = (typeof POSITIONER_KEYS)[number];

export function splitPositionerProps<
  Props extends Partial<Record<PositionerKey, unknown>>,
>(props: Props): [Pick<Props, PositionerKey>, Omit<Props, PositionerKey>] {
  const positioner: Record<string, unknown> = {};
  const rest: Record<string, unknown> = { ...props };
  for (const key of POSITIONER_KEYS) {
    if (rest[key] !== undefined) positioner[key] = rest[key];
    delete rest[key];
  }
  return [
    positioner as Pick<Props, PositionerKey>,
    rest as Omit<Props, PositionerKey>,
  ];
}
