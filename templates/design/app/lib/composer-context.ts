import { readDesignSystemReference } from "@agent-native/core/client/agent-chat";
import { callAction } from "@agent-native/core/client/hooks";
import type {
  AgentChatContextItem,
  Reference,
} from "@agent-native/toolkit/composer";

export type ComposerSource = "design" | "slides" | "figma";
export interface ComposerSourceReference {
  source: ComposerSource;
  id: string;
  title: string;
  url?: string;
}

const REFERENCE_PREFIX = "design-reference:";
export const SYSTEM_CONTEXT_KEY = "design-system";

export function sourceContextKey(reference: ComposerSourceReference): string {
  return `${REFERENCE_PREFIX}${JSON.stringify(reference)}`;
}

export function referenceFromContextItem(
  item: Pick<AgentChatContextItem, "key">,
): ComposerSourceReference | null {
  if (!item.key.startsWith(REFERENCE_PREFIX)) return null;
  return validateSourceReference(
    JSON.parse(item.key.slice(REFERENCE_PREFIX.length)),
  );
}

function validateSourceReference(value: unknown): ComposerSourceReference {
  if (!value || typeof value !== "object")
    throw new Error("Invalid context reference");
  const ref = value as Partial<ComposerSourceReference>;
  if (
    !["design", "slides", "figma"].includes(ref.source ?? "") ||
    typeof ref.id !== "string" ||
    !ref.id ||
    typeof ref.title !== "string" ||
    (ref.url !== undefined && typeof ref.url !== "string")
  )
    throw new Error("Invalid context reference");
  return ref as ComposerSourceReference;
}

export function readSavedComposerReferences(
  data: string | null | undefined,
): ComposerSourceReference[] {
  if (data == null) return [];
  const parsed = JSON.parse(data);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid design context data");
  }
  if (parsed.composerContext === undefined) return [];
  if (!Array.isArray(parsed.composerContext))
    throw new Error("Invalid saved context");
  return parsed.composerContext.map(validateSourceReference);
}

export function snapshotComposerContext(
  items: readonly AgentChatContextItem[] = [],
) {
  if (items.some((item) => item.status && item.status !== "ready")) {
    throw new Error("Resolve or remove unavailable context before sending");
  }
  return Object.freeze(items.map((item) => Object.freeze({ ...item })));
}

export function formatComposerContext(
  items: readonly AgentChatContextItem[] = [],
): string {
  return snapshotComposerContext(items)
    .map((item) => `## ${item.title}\n${item.context}`)
    .join("\n\n");
}

export function formatComposerReferences(
  references: readonly Reference[],
): string {
  if (!references.length) return "";
  return (
    "Selected composer references (read these exact sources before using them):\n" +
    JSON.stringify(references)
  );
}

export async function persistComposerContext(
  designId: string,
  items: readonly AgentChatContextItem[],
): Promise<void> {
  const references = items
    .map(referenceFromContextItem)
    .filter((item) => item !== null);
  await callAction("update-design", {
    id: designId,
    dataOperations: [
      ...items
        .filter((item) => item.key === SYSTEM_CONTEXT_KEY)
        .map((item) => ({
          op: "set" as const,
          path: ["composerDesignSystemRef"],
          value: readDesignSystemReference(item.context),
        })),
      {
        op: "set",
        path: ["composerContext"],
        value: references.map((ref) => ({ ...ref })),
      },
    ],
  });
}
