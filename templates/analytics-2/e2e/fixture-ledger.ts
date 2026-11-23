import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";

export type FixtureKind = "project" | "dataset" | "thread";
export type Fixture = { kind: FixtureKind; id: string };

export type FixtureLedger = {
  readonly path: string;
  created(kind: FixtureKind, id: string): void;
  cleaned(kind: FixtureKind, id: string): void;
};

function appendDurably(path: string, line: string) {
  const fd = openSync(path, "a");
  try {
    writeSync(fd, `${line}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function openFixtureLedger(
  path: string,
  options: { echo?: boolean } = {},
): FixtureLedger {
  const echo = options.echo ?? true;
  mkdirSync(dirname(path), { recursive: true });
  const record = (
    event: "created" | "cleaned",
    kind: FixtureKind,
    id: string,
  ) => {
    appendDurably(path, JSON.stringify({ event, kind, id }));
    if (echo) writeSync(2, `FIXTURE ${event} ${kind} ${id}\n`);
  };
  return {
    path,
    created: (kind, id) => record("created", kind, id),
    cleaned: (kind, id) => record("cleaned", kind, id),
  };
}

export function readOutstandingFixtures(path: string): Fixture[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const outstanding = new Map<string, Fixture>();
  for (const line of text.split("\n")) {
    if (!line) continue;
    let entry: { event?: unknown; kind?: unknown; id?: unknown };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof entry.kind !== "string" || typeof entry.id !== "string")
      continue;
    const key = `${entry.kind}\0${entry.id}`;
    if (entry.event === "created")
      outstanding.set(key, { kind: entry.kind as FixtureKind, id: entry.id });
    else if (entry.event === "cleaned") outstanding.delete(key);
  }
  return [...outstanding.values()];
}

export class LedgerSet extends Set<string> {
  constructor(
    private readonly ledger: FixtureLedger,
    private readonly kind: FixtureKind,
  ) {
    super();
  }
  override add(id: string) {
    if (!this.has(id)) this.ledger.created(this.kind, id);
    return super.add(id);
  }
  override delete(id: string) {
    const had = super.delete(id);
    if (had) this.ledger.cleaned(this.kind, id);
    return had;
  }
}
