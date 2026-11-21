export const STEP_CAPTURE_SCHEMA_VERSION = 1;

export const STEP_CLICK_TYPES = ["left", "right", "double", "drag"] as const;

export type StepClickType = (typeof STEP_CLICK_TYPES)[number];

export interface StepPoint {
  x: number;
  y: number;
}

export interface StepRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StepDisplay {
  id: number;
  frame: StepRect;
  scale: number;
}

export type StepImage =
  | { status: "captured"; fileName: string; width: number; height: number }
  | { status: "failed"; error: string };

export type StepWindow =
  | {
      status: "found";
      id: number;
      frame: StepRect;
      ownerName?: string;
      ownerPid?: number;
      title?: string;
    }
  | { status: "none" };

export const STEP_TARGET_UNAVAILABLE_REASONS = [
  "not-trusted",
  "no-element",
  "ax-error",
  "unsupported",
] as const;

export type StepTargetUnavailableReason =
  (typeof STEP_TARGET_UNAVAILABLE_REASONS)[number];

export type StepTarget =
  | { status: "labeled"; role: string; label: string }
  | { status: "unlabeled"; role: string }
  | { status: "redacted"; role: string }
  | {
      status: "unavailable";
      reason: StepTargetUnavailableReason;
      code?: number;
    };

export interface StepCaptureStep {
  step: number;
  capturedAt: string;
  clickType: StepClickType;
  location: StepPoint;
  dragTo?: StepPoint;
  display: StepDisplay | null;
  image: StepImage;
  window: StepWindow;
  target: StepTarget;
}

export interface StepCaptureSession {
  schemaVersion: typeof STEP_CAPTURE_SCHEMA_VERSION;
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
  steps: StepCaptureStep[];
}

export type StepCaptureParseResult =
  | { ok: true; session: StepCaptureSession }
  | { ok: false; error: string };

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isPoint(value: unknown): value is StepPoint {
  return isObject(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

function isRect(value: unknown): value is StepRect {
  return (
    isObject(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height)
  );
}

function isDisplay(value: unknown): value is StepDisplay {
  return (
    isObject(value) &&
    isFiniteNumber(value.id) &&
    isRect(value.frame) &&
    isFiniteNumber(value.scale)
  );
}

function isImage(value: unknown): value is StepImage {
  if (!isObject(value)) return false;
  if (value.status === "captured") {
    return (
      typeof value.fileName === "string" &&
      isFiniteNumber(value.width) &&
      isFiniteNumber(value.height)
    );
  }
  return value.status === "failed" && typeof value.error === "string";
}

function isWindow(value: unknown): value is StepWindow {
  if (!isObject(value)) return false;
  if (value.status === "none") return true;
  return (
    value.status === "found" &&
    isFiniteNumber(value.id) &&
    isRect(value.frame) &&
    isOptionalString(value.ownerName) &&
    (value.ownerPid === undefined || isFiniteNumber(value.ownerPid)) &&
    isOptionalString(value.title)
  );
}

function isTarget(value: unknown): value is StepTarget {
  if (!isObject(value)) return false;
  switch (value.status) {
    case "labeled":
      return typeof value.role === "string" && typeof value.label === "string";
    case "unlabeled":
    case "redacted":
      return typeof value.role === "string";
    case "unavailable":
      return (
        (STEP_TARGET_UNAVAILABLE_REASONS as readonly unknown[]).includes(
          value.reason,
        ) &&
        (value.code === undefined || isFiniteNumber(value.code))
      );
    default:
      return false;
  }
}

function stepError(index: number, value: unknown): string | null {
  if (!isObject(value)) return `steps[${index}] is not an object`;
  if (value.step !== index + 1) {
    return `steps[${index}].step must be ${index + 1}`;
  }
  if (typeof value.capturedAt !== "string") {
    return `steps[${index}].capturedAt is missing`;
  }
  if (!(STEP_CLICK_TYPES as readonly unknown[]).includes(value.clickType)) {
    return `steps[${index}].clickType is not a known click type`;
  }
  if (!isPoint(value.location)) return `steps[${index}].location is invalid`;
  if (value.dragTo !== undefined) {
    if (value.clickType !== "drag") {
      return `steps[${index}].dragTo is only valid on a drag`;
    }
    if (!isPoint(value.dragTo)) return `steps[${index}].dragTo is invalid`;
  }
  if (value.display !== null && !isDisplay(value.display)) {
    return `steps[${index}].display is invalid`;
  }
  if (!isImage(value.image)) return `steps[${index}].image is invalid`;
  if (!isWindow(value.window)) return `steps[${index}].window is invalid`;
  if (!isTarget(value.target)) return `steps[${index}].target is invalid`;
  return null;
}

export function parseStepCaptureSession(
  value: unknown,
): StepCaptureParseResult {
  if (!isObject(value))
    return { ok: false, error: "manifest is not an object" };
  if (value.schemaVersion !== STEP_CAPTURE_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `unsupported schemaVersion ${String(value.schemaVersion)}`,
    };
  }
  if (typeof value.sessionId !== "string" || !value.sessionId) {
    return { ok: false, error: "sessionId is missing" };
  }
  if (typeof value.startedAt !== "string") {
    return { ok: false, error: "startedAt is missing" };
  }
  if (value.endedAt !== null && typeof value.endedAt !== "string") {
    return { ok: false, error: "endedAt must be a string or null" };
  }
  if (!Array.isArray(value.steps)) {
    return { ok: false, error: "steps is not an array" };
  }
  for (const [index, step] of value.steps.entries()) {
    const error = stepError(index, step);
    if (error) return { ok: false, error };
  }
  return { ok: true, session: value as unknown as StepCaptureSession };
}

const ROLE_NOUNS: Record<string, string> = {
  AXButton: "button",
  AXCheckBox: "checkbox",
  AXLink: "link",
  AXMenuBarItem: "menu",
  AXMenuButton: "menu",
  AXMenuItem: "menu item",
  AXPopUpButton: "menu",
  AXRadioButton: "option",
  AXTab: "tab",
  AXTextField: "field",
  AXTextArea: "field",
  AXSearchField: "search field",
  AXSecureTextField: "password field",
  AXComboBox: "field",
};

const CLICK_VERBS: Record<StepClickType, string> = {
  left: "Click",
  right: "Right-click",
  double: "Double-click",
  drag: "Drag",
};

export function defaultStepTitle(step: StepCaptureStep): string {
  const verb = CLICK_VERBS[step.clickType];
  const target = step.target;
  if (target.status === "labeled") {
    const noun = ROLE_NOUNS[target.role];
    return noun
      ? `${verb} "${target.label}" ${noun}`
      : `${verb} "${target.label}"`;
  }
  if (target.status === "unlabeled" || target.status === "redacted") {
    const noun = ROLE_NOUNS[target.role];
    if (noun) return `${verb} the ${noun}`;
  }
  if (step.window.status === "found" && step.window.ownerName) {
    return `${verb} in ${step.window.ownerName}`;
  }
  return verb;
}
