import {
  designSystemReferenceSchema,
  type DesignSystemReference,
} from "../shared/design-system-authoring.js";

const prefix = "Design system reference: ";

export function formatDesignSystemReference(
  reference: DesignSystemReference,
  context: string,
): string {
  return `${prefix}${JSON.stringify(reference)}\nWhen creating or generating with this attached system, pass this exact object as designSystemRef to create-design, generate-design, or create-deck. Preserve its ownerApp, id, and consumedRevision; a read alone or a bare designSystemId does not persist this pin. Do not silently replace it with the latest revision.\n${context}`;
}

export function readDesignSystemReference(
  context: string,
): DesignSystemReference | null {
  if (!context.startsWith(prefix)) return null;
  return designSystemReferenceSchema.parse(
    JSON.parse(context.slice(prefix.length).split("\n")[0]),
  );
}
