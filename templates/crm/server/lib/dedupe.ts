/**
 * Duplicate-candidate detection over the sparse sub-field columns.
 *
 * Every predicate here reads an INDEXABLE column that the attribute writer
 * already populated (`email_local`/`email_domain`, `email_root_domain`,
 * `domain_root`, `name_first`/`name_last`) rather than pattern-matching a JSON
 * blob at query time — `json_extract` in a WHERE clause is dialect-divergent,
 * and a full scan over `crm_record_fields` is not something a grid can afford.
 *
 * Detection NEVER merges. It returns scored candidates with the reason each one
 * matched, because a duplicate the reviewer cannot see the reason for is a
 * duplicate the reviewer cannot act on — and a "known contact" silently dropped
 * at the end of a workflow is exactly the failure this module exists to avoid.
 */

import { accessFilter } from "@agent-native/core/sharing";
import { and, eq, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";

import { parseEmail, rootDomainOf } from "../../shared/crm-attributes.js";
import { schema } from "../db/index.js";
import type { CrmFieldWriteDb } from "./record-fields.js";

export const CRM_DUPLICATE_MATCH_REASONS = [
  "email",
  "domain",
  "name-and-location",
  "email-root-domain",
] as const;

export type CrmDuplicateMatchReason =
  (typeof CRM_DUPLICATE_MATCH_REASONS)[number];

/**
 * Per-reason confidence, combined with noisy-OR so two weak signals add up to
 * more than either alone without ever reaching certainty.
 *
 * `email` is near-certain because a mailbox is one person. `domain` is strong
 * for companies and deliberately never applied to people (colleagues share a
 * company domain — that is a relationship, not a duplicate). `email-root-domain`
 * is a hint only, for the same reason.
 */
const REASON_CONFIDENCE: Record<CrmDuplicateMatchReason, number> = {
  email: 0.95,
  domain: 0.7,
  "name-and-location": 0.6,
  "email-root-domain": 0.2,
};

/**
 * Domains that identify a mailbox provider rather than an organization. Without
 * this list every personal Gmail contact is a "duplicate" of every other.
 *
 * ponytail: hand-list, not a public mailbox-provider dataset. Symptom of a gap
 * is a low-confidence pile of `email-root-domain` candidates sharing one host;
 * add the host here rather than lowering the weight.
 */
const CONSUMER_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "gmx.de",
  "mail.com",
  "zoho.com",
  "yandex.ru",
  "qq.com",
  "163.com",
  "126.com",
]);

/** Legal-form suffixes that carry no identity — "Acme Inc" is "Acme". */
const COMPANY_SUFFIXES = new Set([
  "inc",
  "incorporated",
  "llc",
  "llp",
  "ltd",
  "limited",
  "plc",
  "corp",
  "corporation",
  "co",
  "company",
  "gmbh",
  "ag",
  "sa",
  "sas",
  "bv",
  "nv",
  "ab",
  "oy",
  "as",
  "pty",
  "pte",
  "srl",
  "spa",
  "kk",
  "holdings",
  "group",
  "the",
]);

/** Rows scanned per match class. Detection is a bounded probe, never a sweep. */
export const MAX_DEDUPE_SCAN = 500;

export interface CrmDuplicateSignal {
  reason: CrmDuplicateMatchReason;
  /** The shared value that matched, so a reviewer can see WHY. */
  value: string;
  confidence: number;
}

export interface CrmDuplicateCandidate {
  recordId: string;
  displayName: string;
  objectType: string;
  kind: string;
  connectionId: string;
  signals: CrmDuplicateSignal[];
  confidence: number;
}

export interface CrmDuplicateSeed {
  recordId: string;
  displayName: string;
  objectType: string;
  kind: string;
  connectionId: string;
  candidates: CrmDuplicateCandidate[];
}

interface SeedRow {
  id: string;
  displayName: string;
  objectType: string;
  kind: string;
  connectionId: string;
  primaryEmail: string | null;
  domain: string | null;
}

interface SeedKeys {
  /** Full normalized addresses, e.g. `ada@example.com`. */
  emails: Set<string>;
  emailRootDomains: Set<string>;
  domainRoots: Set<string>;
  normalizedName: string | null;
  /** Canonical location string, or null when the record declares none. */
  location: string | null;
}

/**
 * Comparable form of a display name: diacritics folded, punctuation dropped,
 * legal-form suffixes removed. This IS the fuzz — trigram similarity is not
 * expressible in dialect-agnostic SQL, so candidates are narrowed by an indexed
 * prefix and compared here.
 */
export function normalizeCrmDisplayName(value: string): string {
  const words = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .filter((word) => !COMPANY_SUFFIXES.has(word));
  return words.join(" ");
}

/** Canonical location key. `null` when nothing usable was declared. */
export function normalizeCrmLocation(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = normalizeCrmDisplayName(value);
    return normalized || null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const parts = ["locality", "city", "region", "state", "country"]
    .map((key) => record[key])
    .filter((part): part is string => typeof part === "string" && !!part.trim())
    .map((part) => normalizeCrmDisplayName(part))
    .filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

function isOrganizationKind(kind: string): boolean {
  return kind === "account";
}

async function loadSeedRows(
  db: CrmFieldWriteDb,
  recordIds: string[],
): Promise<SeedRow[]> {
  return db
    .select({
      id: schema.crmRecords.id,
      displayName: schema.crmRecords.displayName,
      objectType: schema.crmRecords.objectType,
      kind: schema.crmRecords.kind,
      connectionId: schema.crmRecords.connectionId,
      primaryEmail: schema.crmRecords.primaryEmail,
      domain: schema.crmRecords.domain,
    })
    .from(schema.crmRecords)
    .where(
      and(
        inArray(schema.crmRecords.id, recordIds),
        eq(schema.crmRecords.tombstone, false),
        accessFilter(schema.crmRecords, schema.crmRecordShares),
      ),
    );
}

/** Current sub-field values for a set of records, one query. */
async function loadIdentityFields(
  db: CrmFieldWriteDb,
  recordIds: string[],
): Promise<
  Array<{
    recordId: string;
    emailLocal: string | null;
    emailDomain: string | null;
    emailRootDomain: string | null;
    domainRoot: string | null;
    jsonValue: string | null;
    valueType: string;
  }>
> {
  if (!recordIds.length) return [];
  return db
    .select({
      recordId: schema.crmRecordFields.recordId,
      emailLocal: schema.crmRecordFields.emailLocal,
      emailDomain: schema.crmRecordFields.emailDomain,
      emailRootDomain: schema.crmRecordFields.emailRootDomain,
      domainRoot: schema.crmRecordFields.domainRoot,
      jsonValue: schema.crmRecordFields.jsonValue,
      valueType: schema.crmRecordFields.valueType,
    })
    .from(schema.crmRecordFields)
    .where(
      and(
        inArray(schema.crmRecordFields.recordId, recordIds),
        isNull(schema.crmRecordFields.entryId),
        isNull(schema.crmRecordFields.activeUntil),
        accessFilter(schema.crmRecordFields, schema.crmRecordFieldShares),
      ),
    )
    .limit(MAX_DEDUPE_SCAN);
}

function seedKeysFor(
  row: SeedRow,
  fields: Array<{
    emailLocal: string | null;
    emailDomain: string | null;
    emailRootDomain: string | null;
    domainRoot: string | null;
    jsonValue: string | null;
    valueType: string;
  }>,
): SeedKeys {
  const keys: SeedKeys = {
    emails: new Set(),
    emailRootDomains: new Set(),
    domainRoots: new Set(),
    normalizedName: normalizeCrmDisplayName(row.displayName) || null,
    location: null,
  };

  const addEmail = (local: string | null, domain: string | null) => {
    if (!local || !domain) return;
    keys.emails.add(`${local}@${domain}`);
  };

  const mirrored = parseEmail(row.primaryEmail);
  if (mirrored.status === "parsed") {
    addEmail(mirrored.local, mirrored.domain);
    if (!CONSUMER_EMAIL_DOMAINS.has(mirrored.rootDomain)) {
      keys.emailRootDomains.add(mirrored.rootDomain);
    }
  }
  const mirroredDomain = rootDomainOf(row.domain);
  if (mirroredDomain) keys.domainRoots.add(mirroredDomain);

  for (const field of fields) {
    addEmail(field.emailLocal, field.emailDomain);
    if (
      field.emailRootDomain &&
      !CONSUMER_EMAIL_DOMAINS.has(field.emailRootDomain)
    ) {
      keys.emailRootDomains.add(field.emailRootDomain);
    }
    if (field.domainRoot) keys.domainRoots.add(field.domainRoot);
    if (field.valueType === "json" && field.jsonValue && !keys.location) {
      try {
        keys.location = normalizeCrmLocation(JSON.parse(field.jsonValue));
      } catch {
        // A value the location parser cannot read is not a location match and
        // is not silently treated as one; it simply contributes no key.
      }
    }
  }

  // A consumer mailbox host is a company domain for nobody.
  for (const domain of [...keys.domainRoots]) {
    if (CONSUMER_EMAIL_DOMAINS.has(domain)) keys.domainRoots.delete(domain);
  }
  return keys;
}

interface CandidateAccumulator {
  signals: Map<CrmDuplicateMatchReason, CrmDuplicateSignal>;
}

function addSignal(
  bucket: Map<string, CandidateAccumulator>,
  recordId: string,
  signal: CrmDuplicateSignal,
): void {
  const existing = bucket.get(recordId) ?? { signals: new Map() };
  const prior = existing.signals.get(signal.reason);
  if (!prior || prior.confidence < signal.confidence) {
    existing.signals.set(signal.reason, signal);
  }
  bucket.set(recordId, existing);
}

/** Noisy-OR: independent weak signals accumulate but never reach certainty. */
function combineConfidence(signals: CrmDuplicateSignal[]): number {
  const combined = signals.reduce(
    (miss, signal) => miss * (1 - signal.confidence),
    1,
  );
  return Math.round((1 - combined) * 1000) / 1000;
}

export interface FindCrmDuplicatesInput {
  db: CrmFieldWriteDb;
  recordIds: string[];
  /** Candidates below this are not returned at all. */
  minConfidence?: number;
  /** Candidates per seed. */
  limit?: number;
}

/**
 * Scored duplicate candidates for each seed record, newest signal wins per
 * reason. Seeds the caller cannot read are absent from the result — an empty
 * candidate list means "checked, nothing matched", never "could not check".
 */
export async function findCrmDuplicateCandidates(
  input: FindCrmDuplicatesInput,
): Promise<CrmDuplicateSeed[]> {
  const limit = input.limit ?? 10;
  const minConfidence = input.minConfidence ?? 0.2;
  const seedRows = await loadSeedRows(input.db, input.recordIds);
  if (!seedRows.length) return [];

  const identityFields = await loadIdentityFields(
    input.db,
    seedRows.map((row) => row.id),
  );
  const fieldsByRecord = new Map<string, typeof identityFields>();
  for (const field of identityFields) {
    const bucket = fieldsByRecord.get(field.recordId) ?? [];
    bucket.push(field);
    fieldsByRecord.set(field.recordId, bucket);
  }

  const seeds: CrmDuplicateSeed[] = [];
  for (const row of seedRows) {
    const keys = seedKeysFor(row, fieldsByRecord.get(row.id) ?? []);
    const bucket = new Map<string, CandidateAccumulator>();

    await matchEmails(input.db, row, keys, bucket);
    await matchDomains(input.db, row, keys, bucket);
    await matchNameAndLocation(input.db, row, keys, bucket);

    const candidateIds = [...bucket.keys()];
    const candidateRows = candidateIds.length
      ? await input.db
          .select({
            id: schema.crmRecords.id,
            displayName: schema.crmRecords.displayName,
            objectType: schema.crmRecords.objectType,
            kind: schema.crmRecords.kind,
            connectionId: schema.crmRecords.connectionId,
          })
          .from(schema.crmRecords)
          .where(
            and(
              inArray(schema.crmRecords.id, candidateIds),
              eq(schema.crmRecords.tombstone, false),
              accessFilter(schema.crmRecords, schema.crmRecordShares),
            ),
          )
      : [];

    const candidates: CrmDuplicateCandidate[] = [];
    for (const candidate of candidateRows) {
      const signals = [...(bucket.get(candidate.id)?.signals.values() ?? [])];
      const confidence = combineConfidence(signals);
      if (confidence < minConfidence) continue;
      candidates.push({
        recordId: candidate.id,
        displayName: candidate.displayName,
        objectType: candidate.objectType,
        kind: candidate.kind,
        connectionId: candidate.connectionId,
        signals: signals.sort((a, b) => b.confidence - a.confidence),
        confidence,
      });
    }
    candidates.sort(
      (a, b) =>
        b.confidence - a.confidence || a.recordId.localeCompare(b.recordId),
    );

    seeds.push({
      recordId: row.id,
      displayName: row.displayName,
      objectType: row.objectType,
      kind: row.kind,
      connectionId: row.connectionId,
      candidates: candidates.slice(0, limit),
    });
  }
  return seeds;
}

/**
 * Records of the same object type that are not the seed and not tombstoned.
 *
 * Access scoping is deliberately NOT folded in here: every caller spells its own
 * `accessFilter` out at the query, because a scan that leaks other people's
 * records is exactly the bug this shape would hide behind one helper name.
 */
function comparableRecords(seed: SeedRow): SQL {
  return and(
    eq(schema.crmRecords.objectType, seed.objectType),
    ne(schema.crmRecords.id, seed.id),
    eq(schema.crmRecords.tombstone, false),
  ) as SQL;
}

async function matchEmails(
  db: CrmFieldWriteDb,
  seed: SeedRow,
  keys: SeedKeys,
  bucket: Map<string, CandidateAccumulator>,
): Promise<void> {
  if (!keys.emails.size && !keys.emailRootDomains.size) return;

  const emailPairs = [...keys.emails].map((email) => {
    const at = email.lastIndexOf("@");
    return { local: email.slice(0, at), domain: email.slice(at + 1) };
  });

  const shapes: SQL[] = [];
  if (emailPairs.length) {
    shapes.push(
      or(
        ...emailPairs.map(
          (pair) =>
            and(
              eq(schema.crmRecordFields.emailLocal, pair.local),
              eq(schema.crmRecordFields.emailDomain, pair.domain),
            ) as SQL,
        ),
      ) as SQL,
    );
  }
  if (keys.emailRootDomains.size) {
    shapes.push(
      inArray(schema.crmRecordFields.emailRootDomain, [
        ...keys.emailRootDomains,
      ]) as SQL,
    );
  }

  const rows = await db
    .select({
      recordId: schema.crmRecordFields.recordId,
      emailLocal: schema.crmRecordFields.emailLocal,
      emailDomain: schema.crmRecordFields.emailDomain,
      emailRootDomain: schema.crmRecordFields.emailRootDomain,
    })
    .from(schema.crmRecordFields)
    .innerJoin(
      schema.crmRecords,
      eq(schema.crmRecords.id, schema.crmRecordFields.recordId),
    )
    .where(
      and(
        or(...shapes),
        isNull(schema.crmRecordFields.entryId),
        isNull(schema.crmRecordFields.activeUntil),
        accessFilter(schema.crmRecordFields, schema.crmRecordFieldShares),
        accessFilter(schema.crmRecords, schema.crmRecordShares),
        comparableRecords(seed),
      ),
    )
    .limit(MAX_DEDUPE_SCAN);

  for (const row of rows) {
    const email =
      row.emailLocal && row.emailDomain
        ? `${row.emailLocal}@${row.emailDomain}`
        : null;
    if (email && keys.emails.has(email)) {
      addSignal(bucket, row.recordId, {
        reason: "email",
        value: email,
        confidence: REASON_CONFIDENCE.email,
      });
      continue;
    }
    if (
      row.emailRootDomain &&
      keys.emailRootDomains.has(row.emailRootDomain) &&
      !isOrganizationKind(seed.kind)
    ) {
      addSignal(bucket, row.recordId, {
        reason: "email-root-domain",
        value: row.emailRootDomain,
        confidence: REASON_CONFIDENCE["email-root-domain"],
      });
    }
  }

  // The denormalized mirror column carries an address for records whose email
  // attribute was never mirrored; skipping it would miss the obvious duplicate.
  if (keys.emails.size) {
    const mirrorRows = await db
      .select({
        id: schema.crmRecords.id,
        primaryEmail: schema.crmRecords.primaryEmail,
      })
      .from(schema.crmRecords)
      .where(
        and(
          inArray(sql`lower(${schema.crmRecords.primaryEmail})`, [
            ...keys.emails,
          ]),
          accessFilter(schema.crmRecords, schema.crmRecordShares),
          comparableRecords(seed),
        ),
      )
      .limit(MAX_DEDUPE_SCAN);
    for (const row of mirrorRows) {
      const parsed = parseEmail(row.primaryEmail);
      if (parsed.status !== "parsed") continue;
      addSignal(bucket, row.id, {
        reason: "email",
        value: `${parsed.local}@${parsed.domain}`,
        confidence: REASON_CONFIDENCE.email,
      });
    }
  }
}

async function matchDomains(
  db: CrmFieldWriteDb,
  seed: SeedRow,
  keys: SeedKeys,
  bucket: Map<string, CandidateAccumulator>,
): Promise<void> {
  // A shared company domain identifies an ORGANIZATION. Two people at the same
  // domain are colleagues; reporting that as a duplicate is how a real contact
  // gets merged away.
  if (!keys.domainRoots.size || !isOrganizationKind(seed.kind)) return;
  const roots = [...keys.domainRoots];

  const fieldRows = await db
    .select({
      recordId: schema.crmRecordFields.recordId,
      domainRoot: schema.crmRecordFields.domainRoot,
    })
    .from(schema.crmRecordFields)
    .innerJoin(
      schema.crmRecords,
      eq(schema.crmRecords.id, schema.crmRecordFields.recordId),
    )
    .where(
      and(
        inArray(schema.crmRecordFields.domainRoot, roots),
        isNull(schema.crmRecordFields.entryId),
        isNull(schema.crmRecordFields.activeUntil),
        accessFilter(schema.crmRecordFields, schema.crmRecordFieldShares),
        accessFilter(schema.crmRecords, schema.crmRecordShares),
        comparableRecords(seed),
      ),
    )
    .limit(MAX_DEDUPE_SCAN);
  for (const row of fieldRows) {
    if (!row.domainRoot) continue;
    addSignal(bucket, row.recordId, {
      reason: "domain",
      value: row.domainRoot,
      confidence: REASON_CONFIDENCE.domain,
    });
  }

  const mirrorRows = await db
    .select({ id: schema.crmRecords.id, domain: schema.crmRecords.domain })
    .from(schema.crmRecords)
    .where(
      and(
        inArray(sql`lower(${schema.crmRecords.domain})`, roots),
        accessFilter(schema.crmRecords, schema.crmRecordShares),
        comparableRecords(seed),
      ),
    )
    .limit(MAX_DEDUPE_SCAN);
  for (const row of mirrorRows) {
    const root = rootDomainOf(row.domain);
    if (!root) continue;
    addSignal(bucket, row.id, {
      reason: "domain",
      value: root,
      confidence: REASON_CONFIDENCE.domain,
    });
  }
}

async function matchNameAndLocation(
  db: CrmFieldWriteDb,
  seed: SeedRow,
  keys: SeedKeys,
  bucket: Map<string, CandidateAccumulator>,
): Promise<void> {
  if (!keys.normalizedName) return;
  const firstWord = keys.normalizedName.split(" ")[0];
  if (!firstWord) return;

  // `lower(...)` on both sides: SQLite LIKE folds ASCII case, Postgres LIKE
  // does not, and a match that differs by dialect is a bug.
  //
  // ponytail: a leading-wildcard LIKE cannot use an index, so this is a bounded
  // scan capped at MAX_DEDUPE_SCAN rows of the same object type. The upgrade is
  // a normalized-name column written by the attribute writer; add it when the
  // record count makes this probe show up in a slow query log.
  const rows = await db
    .select({
      id: schema.crmRecords.id,
      displayName: schema.crmRecords.displayName,
    })
    .from(schema.crmRecords)
    .where(
      and(
        sql`lower(${schema.crmRecords.displayName}) like ${`%${firstWord}%`}`,
        accessFilter(schema.crmRecords, schema.crmRecordShares),
        comparableRecords(seed),
      ),
    )
    .limit(MAX_DEDUPE_SCAN);
  if (!rows.length) return;

  const nameMatches = rows.filter(
    (row) => normalizeCrmDisplayName(row.displayName) === keys.normalizedName,
  );
  if (!nameMatches.length) return;

  const locations = await loadIdentityFields(
    db,
    nameMatches.map((row) => row.id),
  );
  const locationByRecord = new Map<string, string | null>();
  for (const field of locations) {
    if (field.valueType !== "json" || !field.jsonValue) continue;
    if (locationByRecord.has(field.recordId)) continue;
    try {
      locationByRecord.set(
        field.recordId,
        normalizeCrmLocation(JSON.parse(field.jsonValue)),
      );
    } catch {
      locationByRecord.set(field.recordId, null);
    }
  }

  for (const row of nameMatches) {
    // Name alone is not enough — two "John Smith" people are common. The pair
    // only counts when the location agrees, or when neither side declares one
    // for an organization (where the name itself is far more distinguishing).
    const candidateLocation = locationByRecord.get(row.id) ?? null;
    const agrees =
      keys.location !== null && candidateLocation !== null
        ? keys.location === candidateLocation
        : isOrganizationKind(seed.kind);
    if (!agrees) continue;
    addSignal(bucket, row.id, {
      reason: "name-and-location",
      value:
        keys.location && candidateLocation
          ? `${keys.normalizedName} @ ${keys.location}`
          : keys.normalizedName,
      confidence: REASON_CONFIDENCE["name-and-location"],
    });
  }
}
