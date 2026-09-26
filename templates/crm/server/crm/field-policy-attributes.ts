
import type {
  CrmAttributeAuthority,
  CrmFieldDefinition,
  CrmFieldStoragePolicy,
} from "../../shared/crm-contract.js";

/**
 * `authority` mirrors the `storage_policy -> authority` backfill the
 * `crm-typed-attributes-bitemporal-fields` migration ran once as SQL: a
 * locally owned storage policy gets locally owned authority, everything else
 * (mirrored, remote-only, redacted) is the provider's.
 */
export function crmAttributeAuthorityFor(
  storagePolicy: CrmFieldStoragePolicy,
): CrmAttributeAuthority {
  if (storagePolicy === "local-authoritative") return "local-authoritative";
  if (storagePolicy === "derived-local") return "derived-local";
  return "provider";
}

export function crmAttributeColumnsFor(
  field: CrmFieldDefinition,
  storagePolicy: CrmFieldStoragePolicy,
) {
  return {
    attributeType: field.attributeType ?? "text",
    multi: field.multi ?? false,
    authority: crmAttributeAuthorityFor(storagePolicy),
    configJson: field.config ? JSON.stringify(field.config) : "{}",
  };
}
