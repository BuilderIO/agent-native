import {
  IMPORT_NOTE_SEVERITY,
  type ImportNote,
  type ImportNoteKind,
  type ImportNoteSeverity,
} from "./types";

const MAX_SAMPLES = 3;
const MAX_SAMPLE_LENGTH = 80;
const SEVERITY_ORDER: ImportNoteSeverity[] = ["lost", "kept", "converted"];
const KIND_ORDER = Object.keys(IMPORT_NOTE_SEVERITY) as ImportNoteKind[];

export class ImportNoteBag {
  private readonly notes = new Map<ImportNoteKind, ImportNote>();

  add(kind: ImportNoteKind, sample?: string, count = 1) {
    const note = this.notes.get(kind) ?? {
      kind,
      severity: IMPORT_NOTE_SEVERITY[kind],
      count: 0,
      samples: [],
    };
    note.count += count;
    const excerpt = sample ? clip(sample) : "";
    if (
      excerpt &&
      note.samples.length < MAX_SAMPLES &&
      !note.samples.includes(excerpt)
    ) {
      note.samples.push(excerpt);
    }
    this.notes.set(kind, note);
  }

  clone(): ImportNoteBag {
    const copy = new ImportNoteBag();
    for (const note of this.notes.values()) {
      copy.notes.set(note.kind, { ...note, samples: [...note.samples] });
    }
    return copy;
  }

  toArray(): ImportNote[] {
    return [...this.notes.values()].sort(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a.severity) -
          SEVERITY_ORDER.indexOf(b.severity) ||
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
    );
  }
}

/**
 * Samples are stored with the import record, so an embedded file never goes
 * into one: a data URL is named by its type and size instead. Its payload can
 * hold spaces and parentheses, so it runs to the next quote or tag boundary.
 * Its type can't hold a colon, so a search for the comma that ends the type
 * stops at the next `data:`; without that, a line of them takes a scan of the
 * rest of the line each.
 */
function clip(sample: string): string {
  const text = sample
    .replace(/\bdata:[^\s"'<>(),:]*,[^"'<>]*/gi, describeDataUrl)
    .replace(/\s+/g, " ")
    .trim();
  return text.length > MAX_SAMPLE_LENGTH
    ? `${text.slice(0, MAX_SAMPLE_LENGTH - 1)}…`
    : text;
}

export function describeDataUrl(url: string): string {
  const mediaType = /^data:([^;,]+)/i.exec(url)?.[1] ?? "data";
  const kilobytes = Math.max(1, Math.round((url.length * 3) / 4 / 1024));
  return `${mediaType} (${kilobytes} KB, embedded)`;
}
