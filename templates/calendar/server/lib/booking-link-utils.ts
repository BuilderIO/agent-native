import { z } from "zod";

import type {
  BookingHost,
  BookingLink,
  ConferencingConfig,
} from "../../shared/api.js";
import { schema } from "../db/index.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function stripCrlf(value: unknown): string {
  return (
    typeof value === "string"
      ? value
      : value == null
        ? ""
        : JSON.stringify(value)
  )
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

const conferencingConfigSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none"), url: z.string().optional() }),
  z.object({ type: z.literal("google_meet"), url: z.string().optional() }),
  z.object({ type: z.literal("zoom"), url: z.string().optional() }),
  z.object({ type: z.literal("custom"), url: z.string().optional() }),
]);

export function parseBookingConferencingConfig(
  value: string | null | undefined,
):
  | { status: "absent" }
  | { status: "invalid" }
  | { status: "valid"; config: ConferencingConfig } {
  if (value == null) return { status: "absent" };
  try {
    const parsed = conferencingConfigSchema.safeParse(JSON.parse(value));
    return parsed.success
      ? { status: "valid", config: parsed.data }
      : { status: "invalid" };
  } catch {
    return { status: "invalid" };
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

export function isBookingLinkHost(
  row: Pick<typeof schema.bookingLinks.$inferSelect, "hosts" | "ownerEmail">,
  userEmail: unknown,
): boolean {
  const email = normalizeBookingHostEmail(userEmail);
  return !!email && getBookingLinkRequiredHostEmails(row).includes(email);
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
