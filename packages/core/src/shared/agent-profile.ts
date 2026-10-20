export interface AgentProfileMetadata {
  description?: string;
  whenToUse?: string[];
  aliases?: string[];
}

export interface AgentProfileMetadataFields {
  metadata: AgentProfileMetadata;
  invalidFields: Array<keyof AgentProfileMetadata>;
}

export const AGENT_PROFILE_DESCRIPTION_MAX_LENGTH = 1_000;
export const AGENT_PROFILE_WHEN_TO_USE_MAX_ITEMS = 6;
export const AGENT_PROFILE_WHEN_TO_USE_MAX_LENGTH = 140;
export const AGENT_PROFILE_ALIASES_MAX_ITEMS = 10;
export const AGENT_PROFILE_ALIAS_MAX_LENGTH = 80;

function isPlainText(value: string): boolean {
  return !/[\u0000-\u001f\u007f]/.test(value);
}

/** Parses optional agent profile fields; null signals malformed supplied data. */
export function parseAgentProfileMetadata(value: {
  description?: unknown;
  whenToUse?: unknown;
  aliases?: unknown;
}): AgentProfileMetadata | null {
  const metadata: AgentProfileMetadata = {};

  if (value.description !== undefined) {
    if (typeof value.description !== "string") return null;
    const description = value.description.trim();
    if (
      description.length > AGENT_PROFILE_DESCRIPTION_MAX_LENGTH ||
      !isPlainText(description)
    )
      return null;
    if (description) metadata.description = description;
  }

  if (value.whenToUse !== undefined) {
    if (
      !Array.isArray(value.whenToUse) ||
      value.whenToUse.length > AGENT_PROFILE_WHEN_TO_USE_MAX_ITEMS ||
      value.whenToUse.some(
        (item) =>
          typeof item !== "string" ||
          !item.trim() ||
          item.trim().length > AGENT_PROFILE_WHEN_TO_USE_MAX_LENGTH ||
          !isPlainText(item.trim()),
      )
    ) {
      return null;
    }
    if (value.whenToUse.length) {
      metadata.whenToUse = value.whenToUse.map((item: string) => item.trim());
    }
  }

  if (value.aliases !== undefined) {
    if (
      !Array.isArray(value.aliases) ||
      value.aliases.length > AGENT_PROFILE_ALIASES_MAX_ITEMS ||
      value.aliases.some(
        (item) =>
          typeof item !== "string" ||
          !item.trim() ||
          item.trim().length > AGENT_PROFILE_ALIAS_MAX_LENGTH ||
          !isPlainText(item.trim()),
      )
    ) {
      return null;
    }
    const seen = new Set<string>();
    const aliases = value.aliases
      .map((item: string) => item.trim())
      .filter((item) => {
        const key = item.toLocaleLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    if (aliases.length) metadata.aliases = aliases;
  }

  return metadata;
}

export function parseAgentProfileMetadataFields(value: {
  description?: unknown;
  whenToUse?: unknown;
  aliases?: unknown;
}): AgentProfileMetadataFields {
  const metadata: AgentProfileMetadata = {};
  const invalidFields: Array<keyof AgentProfileMetadata> = [];

  for (const field of ["description", "whenToUse", "aliases"] as const) {
    if (value[field] === undefined) continue;
    const parsed = parseAgentProfileMetadata({ [field]: value[field] });
    if (!parsed) {
      invalidFields.push(field);
      continue;
    }
    Object.assign(metadata, parsed);
  }

  return { metadata, invalidFields };
}
