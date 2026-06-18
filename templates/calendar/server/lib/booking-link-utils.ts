import type { BookingHost, BookingLink } from "../../shared/api.js";
import { schema } from "../db/index.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function stripCrlf(value: unknown): string {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

export function normalizeBookingHostEmail(value: unknown): string | null {
  const email = stripCrlf(value).toLowerCase();
  return EMAIL_RE.test(email) ? email : null;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function normalizeBookingHosts(
  input: unknown,
  ownerEmail?: string | null,
): BookingHost[] {
  const owner = normalizeBookingHostEmail(ownerEmail);
  const rawItems =
    typeof input === "string"
      ? input
          .split(/[\s,;]+/)
          .map((email) => ({ email }))
          .filter((item) => item.email)
      : Array.isArray(input)
        ? input
        : [];

  const seen = new Set<string>();
  const hosts: BookingHost[] = [];
  for (const item of rawItems) {
    const email =
      typeof item === "string"
        ? normalizeBookingHostEmail(item)
        : item && typeof item === "object" && "email" in item
          ? normalizeBookingHostEmail((item as { email?: unknown }).email)
          : null;
    if (!email || email === owner || seen.has(email)) continue;
    seen.add(email);
    const displayName =
      item && typeof item === "object" && "displayName" in item
        ? stripCrlf((item as { displayName?: unknown }).displayName)
        : "";
    hosts.push({
      email,
      ...(displayName ? { displayName } : {}),
    });
  }
  return hosts;
}

export function parseBookingHosts(
  value: string | null,
  ownerEmail?: string | null,
): BookingHost[] {
  return normalizeBookingHosts(parseJson<unknown>(value, []), ownerEmail);
}

export function serializeBookingHosts(
  input: unknown,
  ownerEmail?: string | null,
): string | null {
  const hosts = normalizeBookingHosts(input, ownerEmail);
  return hosts.length > 0 ? JSON.stringify(hosts) : null;
}

export function getBookingLinkCoHostEmails(
  row: Pick<typeof schema.bookingLinks.$inferSelect, "hosts" | "ownerEmail">,
): string[] {
  return parseBookingHosts(row.hosts, row.ownerEmail).map((host) => host.email);
}

export function getBookingLinkRequiredHostEmails(
  row: Pick<typeof schema.bookingLinks.$inferSelect, "hosts" | "ownerEmail">,
): string[] {
  const emails: string[] = [];
  const owner = normalizeBookingHostEmail(row.ownerEmail);
  if (owner) emails.push(owner);
  for (const host of parseBookingHosts(row.hosts, owner)) {
    if (!emails.includes(host.email)) emails.push(host.email);
  }
  return emails;
}

export function rowToBookingLink(
  row: typeof schema.bookingLinks.$inferSelect,
): BookingLink {
  const hosts = parseBookingHosts(row.hosts, row.ownerEmail);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description ?? undefined,
    duration: row.duration,
    durations: parseJson<number[] | undefined>(row.durations, undefined),
    hosts: hosts.length > 0 ? hosts : undefined,
    customFields: parseJson<BookingLink["customFields"]>(
      row.customFields,
      undefined,
    ),
    conferencing: parseJson<BookingLink["conferencing"]>(
      row.conferencing,
      undefined,
    ),
    color: row.color ?? undefined,
    isActive: row.isActive,
    visibility: row.visibility,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
