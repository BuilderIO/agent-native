import type { ActionEntry } from "../agent/production-agent.js";
import {
  resourceDeleteByPath,
  resourceGetByPath,
  resourceList,
  resourcePut,
} from "../resources/store.js";
import { getIntegrationRequestContext } from "../server/request-context.js";

const INDEX_PATH = "memory/MEMORY.md";
const MAX_PROMPT_CHARS = 12_000;
const EMPTY_INDEX = "# Channel Memory\n";

function requireScopeId(): string {
  const scopeId = getIntegrationRequestContext()?.scopeId;
  if (!scopeId) {
    throw new Error(
      "Channel memory is only available inside an authorized integration scope.",
    );
  }
  return scopeId;
}

function ownerForScope(scopeId: string): string {
  return `__integration_scope__:${scopeId}`;
}

function memoryName(value: unknown): string {
  const name = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(name)) {
    throw new Error(
      "Memory name must use 1-80 lowercase letters, numbers, dashes, or underscores.",
    );
  }
  return name;
}

function memoryText(value: unknown, name: string, max: number): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${name} is required`);
  return text.slice(0, max);
}

export async function listIntegrationMemory(scopeId = requireScopeId()) {
  const owner = ownerForScope(scopeId);
  const resources = await resourceList(owner, "memory/");
  return resources
    .filter((resource) => resource.path !== INDEX_PATH)
    .map((resource) => ({
      name: resource.path.replace(/^memory\//, "").replace(/\.md$/, ""),
      path: resource.path,
      updatedAt: resource.updatedAt,
      size: resource.size,
    }));
}

export async function rememberForIntegrationScope(
  input: {
    name: string;
    description: string;
    content: string;
  },
  scopeId = requireScopeId(),
): Promise<{ name: string; description: string }> {
  const owner = ownerForScope(scopeId);
  const name = memoryName(input.name);
  const description = memoryText(input.description, "description", 300);
  const content = memoryText(input.content, "content", 20_000);
  const date = new Date().toISOString().slice(0, 10);
  await resourcePut(
    owner,
    `memory/${name}.md`,
    `---\ntype: channel\ndescription: ${description.replace(/\n/g, " ")}\nupdated: ${date}\n---\n\n${content}`,
    "text/markdown",
  );

  const existing = await resourceGetByPath(owner, INDEX_PATH);
  const lines = (existing?.content || EMPTY_INDEX)
    .split("\n")
    .filter((line) => !line.startsWith(`- [${name}]`));
  lines.push(`- [${name}](${name}.md) — ${description}`);
  await resourcePut(
    owner,
    INDEX_PATH,
    lines.join("\n").trimEnd() + "\n",
    "text/markdown",
  );
  return { name, description };
}

export async function forgetIntegrationMemory(
  input: {
    name: string;
  },
  scopeId = requireScopeId(),
): Promise<{ name: string; deleted: boolean }> {
  const owner = ownerForScope(scopeId);
  const name = memoryName(input.name);
  const deleted = await resourceDeleteByPath(owner, `memory/${name}.md`);
  const existing = await resourceGetByPath(owner, INDEX_PATH);
  if (existing?.content) {
    const next = existing.content
      .split("\n")
      .filter((line) => !line.startsWith(`- [${name}]`))
      .join("\n")
      .trimEnd();
    await resourcePut(owner, INDEX_PATH, `${next}\n`, "text/markdown");
  }
  return { name, deleted };
}

export async function loadIntegrationMemoryPrompt(
  scopeId: string | undefined,
): Promise<string> {
  if (!scopeId) return "";
  const owner = ownerForScope(scopeId);
  const index = await resourceGetByPath(owner, INDEX_PATH);
  if (!index?.content) return "";
  const resources = await resourceList(owner, "memory/");
  const entries: string[] = [];
  for (const resource of resources
    .filter((item) => item.path !== INDEX_PATH)
    .slice(0, 20)) {
    const full = await resourceGetByPath(owner, resource.path);
    if (full?.content) entries.push(full.content.slice(0, 4_000));
  }
  if (!entries.length) return "";
  return `\n\n<integration-memory scope="${scopeId}">\nThese are explicit memories saved for this conversation scope. Policy and system instructions override them.\n${entries.join("\n\n")}\n</integration-memory>`.slice(
    0,
    MAX_PROMPT_CHARS,
  );
}

export function integrationMemoryActions(): Record<string, ActionEntry> {
  return {
    "list-integration-memory": {
      tool: {
        description:
          "List explicit memories saved for the current messaging channel. This is unavailable outside an authorized channel scope.",
        parameters: { type: "object", properties: {} },
      },
      readOnly: true,
      parallelSafe: true,
      run: async () => JSON.stringify(await listIntegrationMemory()),
    },
    "remember-for-integration-scope": {
      tool: {
        description:
          "Save a durable memory ONLY when the user explicitly asks to remember something for this channel/conversation. Never infer consent or auto-save ordinary chat.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            content: { type: "string" },
          },
          required: ["name", "description", "content"],
        },
      },
      run: async (args: Record<string, unknown>) =>
        JSON.stringify(
          await rememberForIntegrationScope({
            name: String(args.name ?? ""),
            description: String(args.description ?? ""),
            content: String(args.content ?? ""),
          }),
        ),
    },
    "forget-integration-memory": {
      tool: {
        description:
          "Delete one explicit memory from the current messaging channel when the user asks to forget it.",
        parameters: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
      run: async (args: Record<string, unknown>) =>
        JSON.stringify(
          await forgetIntegrationMemory({ name: String(args.name ?? "") }),
        ),
    },
  };
}
