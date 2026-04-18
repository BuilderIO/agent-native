import type { TranscriptSegment } from "../../../shared/api.js";

function normalizeLabel(raw: unknown): string {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return `Speaker ${Math.max(0, Math.trunc(raw))}`;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return "Speaker 0";
    if (/^speaker\s+\d+$/i.test(trimmed)) {
      const n = parseInt(trimmed.replace(/\D/g, ""), 10);
      return `Speaker ${Number.isFinite(n) ? n : 0}`;
    }
    if (/^\d+$/.test(trimmed)) return `Speaker ${parseInt(trimmed, 10)}`;
    return trimmed;
  }
  return "Speaker 0";
}

export function labelSpeakers(
  segments: TranscriptSegment[],
): TranscriptSegment[] {
  if (!Array.isArray(segments)) return [];
  return segments.map((seg) => ({
    ...seg,
    speakerLabel: normalizeLabel(seg.speakerLabel),
  }));
}

export function uniqueSpeakerLabels(segments: TranscriptSegment[]): string[] {
  if (!Array.isArray(segments)) return [];
  const seen = new Set<string>();
  for (const seg of segments) {
    const label = normalizeLabel(seg.speakerLabel);
    seen.add(label);
  }
  return Array.from(seen).sort((a, b) => {
    const an = parseInt(a.replace(/\D/g, ""), 10);
    const bn = parseInt(b.replace(/\D/g, ""), 10);
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
    return a.localeCompare(b);
  });
}
