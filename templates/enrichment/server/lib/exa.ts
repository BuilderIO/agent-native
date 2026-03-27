import fs from "fs/promises";
import path from "path";
import Exa, { type WebsetItem } from "exa-js";
import type { EnrichedRow, ImportRecord } from "../../shared/types.js";

let exaSingleton: Exa | null = null;

export function getExaClient(): Exa {
  if (!exaSingleton) {
    const key = process.env.EXA_API_KEY;
    if (!key?.trim()) {
      throw new Error("EXA_API_KEY is not set");
    }
    exaSingleton = new Exa(key.trim());
  }
  return exaSingleton;
}

type MatchKind = "domain" | "email" | "company" | "name";

export function detectSearchType(columns: string[]): "people" | "companies" {
  let peopleScore = 0;
  let companyScore = 0;

  for (const col of columns) {
    const low = col.toLowerCase().trim();

    if (
      low === "email" ||
      low === "e-mail" ||
      low.includes("linkedin") ||
      low === "first name" ||
      low === "last name" ||
      low === "firstname" ||
      low === "lastname" ||
      low === "first_name" ||
      low === "last_name" ||
      low.includes("job title") ||
      low === "title" ||
      low === "position" ||
      low === "role" ||
      low.includes("contact name") ||
      (low.includes("person") && !low.includes("company"))
    ) {
      peopleScore += 1;
    }

    if (
      low.includes("company") ||
      low.includes("organization") ||
      low.includes("organisation") ||
      low === "org" ||
      low.includes("domain") ||
      low === "website" ||
      low === "url" ||
      low.includes("employees") ||
      low.includes("headcount") ||
      low.includes("industry")
    ) {
      companyScore += 1;
    }
  }

  if (peopleScore === 0 && companyScore === 0) {
    return "companies";
  }
  return peopleScore >= companyScore ? "people" : "companies";
}

function normalizeString(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeDomain(raw: string): string {
  let s = raw.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^www\./, "");
  const slash = s.indexOf("/");
  if (slash !== -1) {
    s = s.slice(0, slash);
  }
  const q = s.indexOf("?");
  if (q !== -1) {
    s = s.slice(0, q);
  }
  s = s.replace(/:\d+$/, "");
  return s.trim();
}

function isDomainColumnHeader(low: string): boolean {
  return (
    low.includes("domain") ||
    low === "website" ||
    low === "web site" ||
    low === "url" ||
    low === "website url" ||
    low.endsWith("_url") ||
    low === "site"
  );
}

function isEmailColumnHeader(low: string): boolean {
  return (
    low === "email" ||
    low === "e-mail" ||
    low.endsWith(" email") ||
    low === "mail"
  );
}

function isCompanyColumnHeader(low: string): boolean {
  return (
    low.includes("company") ||
    low.includes("organization") ||
    low.includes("organisation") ||
    low === "org" ||
    /^org(_id|id|name)?$/i.test(low)
  );
}

function isNameColumnHeader(low: string): boolean {
  if (low.includes("company")) {
    return false;
  }
  return (
    low === "name" ||
    low === "full name" ||
    low === "full_name" ||
    low === "contact" ||
    low === "contact name" ||
    low === "contact_name" ||
    low === "first name" ||
    low === "last name" ||
    low === "firstname" ||
    low === "lastname" ||
    low === "first_name" ||
    low === "last_name"
  );
}

function findFirstMatchingColumn(
  columns: string[],
  predicate: (low: string) => boolean,
): string | undefined {
  for (const c of columns) {
    if (predicate(c.toLowerCase().trim())) {
      return c;
    }
  }
  return undefined;
}

function getRowMatchKey(
  row: Record<string, string>,
  columns: string[],
): { kind: MatchKind; value: string } | null {
  const domainCol = findFirstMatchingColumn(columns, isDomainColumnHeader);
  if (domainCol) {
    const v = row[domainCol]?.trim();
    if (v) {
      const nd = normalizeDomain(v);
      if (nd) {
        return { kind: "domain", value: nd };
      }
    }
  }

  const emailCol = findFirstMatchingColumn(columns, isEmailColumnHeader);
  if (emailCol) {
    const v = row[emailCol]?.trim();
    if (v) {
      return { kind: "email", value: normalizeString(v) };
    }
  }

  const companyCol = findFirstMatchingColumn(columns, isCompanyColumnHeader);
  if (companyCol) {
    const v = row[companyCol]?.trim();
    if (v) {
      return { kind: "company", value: normalizeString(v) };
    }
  }

  const firstNameCol = findFirstMatchingColumn(
    columns,
    (low) =>
      low === "first name" || low === "firstname" || low === "first_name",
  );
  const lastNameCol = findFirstMatchingColumn(
    columns,
    (low) => low === "last name" || low === "lastname" || low === "last_name",
  );
  const singleNameCol = findFirstMatchingColumn(columns, isNameColumnHeader);

  if (firstNameCol && lastNameCol) {
    const combined =
      `${row[firstNameCol] ?? ""} ${row[lastNameCol] ?? ""}`.trim();
    if (combined) {
      return { kind: "name", value: normalizeString(combined) };
    }
  }

  if (singleNameCol) {
    const v = row[singleNameCol]?.trim();
    if (v) {
      return { kind: "name", value: normalizeString(v) };
    }
  }

  return null;
}

function extractItemDomain(item: WebsetItem): string | null {
  const p = item.properties;
  if ("url" in p && typeof p.url === "string" && p.url) {
    return normalizeDomain(p.url);
  }
  return null;
}

const EMAIL_IN_TEXT = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi;

function extractItemEmail(item: WebsetItem): string | null {
  if (!item.enrichments?.length) {
    return null;
  }
  for (const e of item.enrichments) {
    if (!e.result?.length) {
      continue;
    }
    for (const line of e.result) {
      const matches = line.match(EMAIL_IN_TEXT);
      if (matches?.[0]) {
        return normalizeString(matches[0]);
      }
    }
  }
  return null;
}

function extractItemCompany(item: WebsetItem): string | null {
  const p = item.properties;
  if (p.type === "company") {
    return normalizeString(p.company.name);
  }
  if (p.type === "person" && p.person.company?.name) {
    return normalizeString(p.person.company.name);
  }
  return null;
}

function extractItemPersonName(item: WebsetItem): string | null {
  const p = item.properties;
  if (p.type === "person") {
    return normalizeString(p.person.name);
  }
  return null;
}

function itemMatchesRowKey(
  item: WebsetItem,
  key: { kind: MatchKind; value: string },
): boolean {
  switch (key.kind) {
    case "domain": {
      const d = extractItemDomain(item);
      return d !== null && d === key.value;
    }
    case "email": {
      const e = extractItemEmail(item);
      return e !== null && e === key.value;
    }
    case "company": {
      const c = extractItemCompany(item);
      return c !== null && c === key.value;
    }
    case "name": {
      const n = extractItemPersonName(item);
      return n !== null && n === key.value;
    }
    default:
      return false;
  }
}

function flattenWebsetItem(item: WebsetItem): Record<string, string | null> {
  const out: Record<string, string | null> = {
    websetItemId: item.id,
    websetId: item.websetId,
    source: item.source,
    sourceId: item.sourceId,
  };

  const p = item.properties;
  out.itemType = p.type;

  if ("url" in p) {
    out.url = p.url;
  }
  if ("description" in p) {
    out.description = p.description;
  }
  if ("content" in p) {
    out.content = p.content;
  }

  if (p.type === "person") {
    out.personName = p.person.name;
    out.personPosition = p.person.position;
    out.personLocation = p.person.location;
    out.personPictureUrl = p.person.pictureUrl;
    out.personCompanyName = p.person.company?.name ?? null;
    out.personCompanyLocation = p.person.company?.location ?? null;
  } else if (p.type === "company") {
    out.companyName = p.company.name;
    out.companyAbout = p.company.about;
    out.companyIndustry = p.company.industry;
    out.companyLocation = p.company.location;
    out.companyEmployees =
      p.company.employees !== null && p.company.employees !== undefined
        ? String(p.company.employees)
        : null;
    out.companyLogoUrl = p.company.logoUrl;
  } else if (p.type === "article") {
    out.articleTitle = p.article.title;
    out.articleAuthor = p.article.author;
    out.articlePublishedAt = p.article.publishedAt;
  } else if (p.type === "research_paper") {
    out.researchPaperTitle = p.researchPaper.title;
    out.researchPaperAuthor = p.researchPaper.author;
    out.researchPaperPublishedAt = p.researchPaper.publishedAt;
  } else if (p.type === "custom") {
    out.customTitle = p.custom.title;
    out.customAuthor = p.custom.author;
    out.customPublishedAt = p.custom.publishedAt;
  }

  if (item.enrichments?.length) {
    item.enrichments.forEach((enr, i) => {
      const prefix = `enrichment_${i}`;
      out[`${prefix}_id`] = enr.enrichmentId;
      out[`${prefix}_status`] = enr.status;
      out[`${prefix}_format`] = enr.format;
      out[`${prefix}_reasoning`] = enr.reasoning;
      out[`${prefix}_result`] = enr.result?.join("\n") ?? null;
    });
  }

  return out;
}

function nullEnrichedShape(
  sample: Record<string, string | null>,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const k of Object.keys(sample)) {
    out[k] = null;
  }
  return out;
}

export function mergeResults(
  importData: ImportRecord,
  websetItems: WebsetItem[],
): EnrichedRow[] {
  const columns = importData.columns;
  const rowKeys = importData.rows.map((row) => getRowMatchKey(row, columns));

  const itemToRowIndices = new Map<WebsetItem, number[]>();
  for (const item of websetItems) {
    const indices: number[] = [];
    rowKeys.forEach((key, idx) => {
      if (key && itemMatchesRowKey(item, key)) {
        indices.push(idx);
      }
    });
    itemToRowIndices.set(item, indices);
  }

  let enrichedKeyUnion: Record<string, string | null> = {};
  for (const item of websetItems) {
    const flat = flattenWebsetItem(item);
    enrichedKeyUnion = { ...enrichedKeyUnion, ...flat };
  }
  const nullTemplate = nullEnrichedShape(enrichedKeyUnion);

  const results: EnrichedRow[] = [];

  importData.rows.forEach((row, idx) => {
    const matchingItems = websetItems.filter(
      (it) => itemToRowIndices.get(it)?.includes(idx) ?? false,
    );

    if (matchingItems.length === 0) {
      results.push({
        originalRow: row,
        enriched: { ...nullTemplate },
        websetItemId: null,
      });
      return;
    }

    for (const item of matchingItems) {
      results.push({
        originalRow: row,
        enriched: flattenWebsetItem(item),
        websetItemId: item.id,
      });
    }
  });

  for (const item of websetItems) {
    const indices = itemToRowIndices.get(item) ?? [];
    if (indices.length === 0) {
      results.push({
        originalRow: {},
        enriched: flattenWebsetItem(item),
        websetItemId: item.id,
      });
    }
  }

  return results;
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function writeJsonFile(
  filePath: string,
  data: unknown,
): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}
