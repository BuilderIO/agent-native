import { z } from "zod";

export const DOMAIN_STATUSES = ["pending", "verified"] as const;

export const dnsRecordSchema = z.object({
  type: z.enum(["CNAME", "TXT"]),
  name: z.string(),
  value: z.string(),
});
export type DnsRecord = z.infer<typeof dnsRecordSchema>;

export const domainFormSchema = z.object({
  id: z.string(),
  formId: z.string(),
  formName: z.string(),
  slug: z.string(),
});

export const domainSchema = z.object({
  id: z.string(),
  host: z.string(),
  status: z.enum(DOMAIN_STATUSES),
  lastCheckedAt: z.string().nullable(),
  records: z.array(dnsRecordSchema),
  forms: z.array(domainFormSchema),
});
export type DomainRow = z.infer<typeof domainSchema>;

const HOST =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const SLUG = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

export const isValidHost = (host: string) => HOST.test(host);
export const isValidSlug = (slug: string) => SLUG.test(slug);

/** Lower-cased host with no scheme, path, port or trailing dot. */
export function normalizeHost(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
}

export const VERIFY_LABEL = "_forms-verify";

export function dnsRecords(
  host: string,
  token: string,
  cnameTarget: string,
): DnsRecord[] {
  return [
    { type: "CNAME", name: host, value: cnameTarget },
    {
      type: "TXT",
      name: `${VERIFY_LABEL}.${host}`,
      value: `forms-verify=${token}`,
    },
  ];
}
