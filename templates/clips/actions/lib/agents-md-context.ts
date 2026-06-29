import {
  resourceGetByPath,
  SHARED_OWNER,
} from "@agent-native/core/resources/store";

const MAX_AGENTS_MD_CONTEXT_CHARS = 60_000;

type AgentsContextPurpose = "title" | "cleanup" | "summary";

function trimAgentsMdContext(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= MAX_AGENTS_MD_CONTEXT_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_AGENTS_MD_CONTEXT_CHARS).trimEnd()}\n\n[Truncated AGENTS.md context]`;
}

async function readAgentsMdBlock(
  owner: string,
  label: "Organization AGENTS.md" | "Personal AGENTS.md",
): Promise<string | null> {
  try {
    const resource = await resourceGetByPath(owner, "AGENTS.md");
    const content = resource?.content?.trim();
    if (!content) return null;
    return `### ${label}\n\n${trimAgentsMdContext(content)}`;
  } catch {
    return null;
  }
}

function purposeInstruction(purpose: AgentsContextPurpose): string {
  if (purpose === "cleanup") {
    return "Use these AGENTS.md resources only for relevant transcript cleanup preferences: vocabulary, casing, punctuation style, formatting style, terminology, speaker voice, and team/personal conventions. If the personal and organization instructions conflict, prefer the personal instructions.";
  }
  if (purpose === "summary") {
    return "Use these AGENTS.md resources only for relevant meeting-summary preferences: vocabulary, casing, terminology, action-item style, formatting style, and team/personal conventions. If the personal and organization instructions conflict, prefer the personal instructions.";
  }

  return "Use these AGENTS.md resources only for relevant Clip naming, terminology, style, and personal/team preferences. If the personal and organization instructions conflict, prefer the personal instructions.";
}

export async function loadAgentsMdContext({
  ownerEmail,
  purpose,
}: {
  ownerEmail: string | null | undefined;
  purpose: AgentsContextPurpose;
}): Promise<string | undefined> {
  const [sharedBlock, personalBlock] = await Promise.all([
    readAgentsMdBlock(SHARED_OWNER, "Organization AGENTS.md"),
    ownerEmail
      ? readAgentsMdBlock(ownerEmail, "Personal AGENTS.md")
      : Promise.resolve(null),
  ]);

  const blocks = [sharedBlock, personalBlock].filter(Boolean);
  if (blocks.length === 0) return undefined;

  return [purposeInstruction(purpose), ...blocks].join("\n\n");
}
