import { fail } from "../action.js";
import {
  loadAgentDesignSystemContext,
  type AgentDesignSystemReader,
} from "../shared/design-system-agent-context.js";
import {
  designSystemReferenceSchema,
  type DesignSystemReference,
} from "../shared/design-system-authoring.js";

export async function resolveDesignSystemGenerationSelection(
  input: {
    ownerApp: "design" | "slides";
    designSystemId?: string | null;
    designSystemRef?: DesignSystemReference | null;
    existingDesignSystemId?: string | null;
    existingReference?: DesignSystemReference | null;
    full?: boolean;
  },
  reader: AgentDesignSystemReader,
) {
  const explicitRef = input.designSystemRef;
  if (
    explicitRef !== undefined &&
    input.designSystemId &&
    (!explicitRef ||
      explicitRef.ownerApp !== input.ownerApp ||
      explicitRef.id !== input.designSystemId)
  )
    return fail(
      "The owner-qualified reference conflicts with the local design-system ID.",
      {
        errorCode: "design_system_selection_conflict",
        statusCode: 409,
      },
    );
  const retained = input.existingReference;
  const reference =
    explicitRef !== undefined
      ? explicitRef
      : input.designSystemId === undefined ||
          (retained?.ownerApp === input.ownerApp &&
            retained.id === input.designSystemId)
        ? retained
        : undefined;
  const localId =
    input.designSystemId !== undefined
      ? input.designSystemId
      : input.existingDesignSystemId;
  const id =
    reference === null && explicitRef !== undefined
      ? null
      : (reference?.id ?? localId);
  if (!id)
    return { designSystemId: null, designSystemRef: null, designSystem: null };

  let result: unknown;
  let readError: unknown;
  const designSystem = await loadAgentDesignSystemContext(
    id,
    {
      run: async (args) => {
        try {
          result = await reader.run({
            ...args,
            ownerApp: reference?.ownerApp ?? input.ownerApp,
          });
          return result;
        } catch (error) {
          readError = error;
          throw error;
        }
      },
    },
    { full: input.full, reference },
  );
  if (readError) throw readError;
  if (!designSystem || designSystem.status !== "available")
    return fail(
      designSystem?.message ?? "The selected design system could not be read.",
      {
        errorCode: "design_system_context_unavailable",
        statusCode: 409,
      },
    );
  const value = result as {
    id?: unknown;
    reference?: { ownerApp?: unknown; systemId?: unknown; revision?: unknown };
  };
  const resolved = designSystemReferenceSchema.safeParse({
    id: value.reference?.systemId,
    ownerApp: value.reference?.ownerApp,
    consumedRevision: value.reference?.revision,
  });
  if (
    !resolved.success ||
    value.id !== id ||
    resolved.data.id !== id ||
    resolved.data.ownerApp !== (reference?.ownerApp ?? input.ownerApp) ||
    (reference && resolved.data.consumedRevision !== reference.consumedRevision)
  )
    return fail(
      "The design-system read did not resolve the requested owner and revision.",
      {
        errorCode: "design_system_reference_unresolved",
        statusCode: 409,
      },
    );
  return {
    designSystemId:
      resolved.data.ownerApp === input.ownerApp ? resolved.data.id : null,
    designSystemRef: resolved.data,
    designSystem,
  };
}
