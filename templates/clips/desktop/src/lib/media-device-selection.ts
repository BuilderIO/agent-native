export type AudioInputCandidate = Pick<
  MediaDeviceInfo,
  "deviceId" | "kind" | "label"
>;

export type AudioInputFallbackReason = "saved-label" | "best-concrete";

export interface AudioInputFallback {
  deviceId: string;
  label: string;
  reason: AudioInputFallbackReason;
}

const PSEUDO_MEDIA_DEVICE_ID_RE = /^(default|communications)$/i;
const PHONE_MIC_LABEL_RE =
  /\b(?:iphone|ipad|android phone|continuity|handoff|phone)\b/i;

function normalizedLabel(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\([^)]*\bdefault\b[^)]*\)/gi, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function labelsMatch(
  leftValue: string | null | undefined,
  rightValue: string | null | undefined,
): boolean {
  const left = normalizedLabel(leftValue);
  const right = normalizedLabel(rightValue);
  if (!left || !right) return false;
  if (left === right || left.includes(right) || right.includes(left)) {
    return true;
  }
  const leftTokens = left.split(" ");
  const rightTokens = right.split(" ");
  const [short, long] =
    leftTokens.length <= rightTokens.length
      ? [leftTokens, rightTokens]
      : [rightTokens, leftTokens];
  return short.every((token) => long.includes(token));
}

export function normalizedMediaDeviceId(
  value: string | null | undefined,
): string {
  return value?.trim() ?? "";
}

export function isPseudoMediaDeviceId(
  value: string | null | undefined,
): boolean {
  const id = normalizedMediaDeviceId(value);
  return !id || PSEUDO_MEDIA_DEVICE_ID_RE.test(id);
}

export function isLikelyPhoneMicLabel(
  label: string | null | undefined,
): boolean {
  return PHONE_MIC_LABEL_RE.test(label ?? "");
}

export function isSelectableAudioInputDevice(
  device: AudioInputCandidate,
): boolean {
  return (
    device.kind === "audioinput" &&
    !isPseudoMediaDeviceId(device.deviceId) &&
    !isLikelyPhoneMicLabel(device.label)
  );
}

function isBuiltInMicLabel(label: string | null | undefined): boolean {
  const normalized = normalizedLabel(label);
  return (
    normalized.includes("macbook") ||
    normalized.includes("built-in") ||
    normalized.includes("built in") ||
    normalized.includes("internal microphone")
  );
}

export function findAudioInputBySavedLabel(
  devices: Iterable<AudioInputCandidate>,
  options: {
    savedLabel: string | null | undefined;
    avoidDeviceIds?: Array<string | null | undefined>;
  },
): AudioInputFallback | null {
  const avoid = new Set(
    (options.avoidDeviceIds ?? [])
      .map((id) => normalizedMediaDeviceId(id))
      .filter(Boolean),
  );
  const candidates = Array.from(devices).filter(
    (device) =>
      isSelectableAudioInputDevice(device) && !avoid.has(device.deviceId),
  );

  const savedLabel = normalizedLabel(options.savedLabel);
  if (savedLabel) {
    const labelMatch = candidates.find((device) =>
      labelsMatch(device.label, savedLabel),
    );
    if (labelMatch) {
      return {
        deviceId: labelMatch.deviceId,
        label: labelMatch.label,
        reason: "saved-label",
      };
    }
  }

  return null;
}

export function chooseFallbackAudioInput(
  devices: Iterable<AudioInputCandidate>,
  options: {
    savedLabel?: string | null;
    avoidDeviceIds?: Array<string | null | undefined>;
  } = {},
): AudioInputFallback | null {
  const labelMatch = findAudioInputBySavedLabel(devices, {
    savedLabel: options.savedLabel,
    avoidDeviceIds: options.avoidDeviceIds,
  });
  if (labelMatch) return labelMatch;

  const avoid = new Set(
    (options.avoidDeviceIds ?? [])
      .map((id) => normalizedMediaDeviceId(id))
      .filter(Boolean),
  );
  const candidates = Array.from(devices).filter(
    (device) =>
      isSelectableAudioInputDevice(device) && !avoid.has(device.deviceId),
  );

  const best =
    candidates.find((device) => isBuiltInMicLabel(device.label)) ??
    candidates[0] ??
    null;
  return best
    ? { deviceId: best.deviceId, label: best.label, reason: "best-concrete" }
    : null;
}

export async function enumerateAudioInputDevices(): Promise<
  AudioInputCandidate[]
> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === "audioinput");
}
