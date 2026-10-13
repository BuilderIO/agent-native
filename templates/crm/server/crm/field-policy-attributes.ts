import type {
  CrmAttributeAuthority,
  CrmFieldDefinition,
  CrmFieldStoragePolicy,
} from "../../shared/crm-contract.js";

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
