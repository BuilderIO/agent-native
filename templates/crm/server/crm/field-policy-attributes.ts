/**
 * The `crm_field_policies` typed-attribute columns every field-policy writer
 * must set — native adapter and mirror, insert and update alike. One helper
 * here instead of four near-identical `values` objects is what keeps a fifth
 * write site (or the next edit to one of these two) from reintroducing the
 * "every field lands as text/provider" boundary bug this replaced.
 */

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

/**
 * The additive typed-attribute columns (`attribute_type`, `multi`,
 * `authority`, `config_json`) for one field's `crm_field_policies` row. Does
 * NOT compute `value_type`: native fields derive it from `attributeType` via
 * `legacyValueTypeFor` at field-definition time, while provider-discovered
 * fields keep their own `field.valueType` from schema discovery — collapsing
 * both into one derivation here would downgrade every provider field (e.g. a
 * HubSpot currency amount) to the `text` fallback.
 */
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
