import {
  createRegistryBlockNode,
  RegistryBlockDataProvider,
  useRegistryBlockData,
  type RegistryBlockDataValue,
} from "@agent-native/core/client";
import { createPlanBlockId, type PlanBlock } from "@shared/plan-content";
import type { ReactNode } from "react";

/* -------------------------------------------------------------------------- */
/* Plan's registry-block node — a thin wrapper over the shared core node.      */
/*                                                                            */
/* The generic NodeView, side-map provider, and dedupe plugin now live in core */
/* (`packages/core/src/client/rich-markdown-editor/RegistryBlockNode.tsx`).    */
/* Plan re-targets its existing `planBlock` node onto the core factory and     */
/* re-exports the provider/hook under their historical plan names so           */
/* `PlanDocumentEditor`'s imports stay unchanged. Rendering behavior —         */
/* registry `BlockView`, legacy-block fallback, Notion-incompatible badge,     */
/* paste/duplicate dedupe — stays centralized in the shared implementation.    */
/* -------------------------------------------------------------------------- */

/**
 * The plan-typed side-map value. `getBlock`/`renderLegacyBlock` are narrowed to
 * `PlanBlock` (the plan's authoritative block union) on top of the generic core
 * contract. The orchestrator's `PlanDocumentEditor` wraps the live editor in
 * `<PlanBlockDataProvider>`, sourcing `getBlock` from `PlanContent.blocks[]` and
 * routing `onBlockDataChange` back into `blocks[]` + a re-serialize.
 */
export type PlanBlockDataValue = RegistryBlockDataValue<PlanBlock>;

/** Plan-named, plan-typed wrapper of the shared registry-block side-map provider. */
export function PlanBlockDataProvider({
  value,
  children,
}: {
  value: PlanBlockDataValue;
  children: ReactNode;
}) {
  return (
    <RegistryBlockDataProvider<PlanBlock> value={value}>
      {children}
    </RegistryBlockDataProvider>
  );
}

/** Read the plan block side-map. Returns `null` outside a provider. */
export function usePlanBlockData(): PlanBlockDataValue | null {
  return useRegistryBlockData<PlanBlock>();
}

/**
 * The `planBlock` Tiptap atom node. Keeps the exact node name (`"planBlock"`)
 * and data tag (`"data-plan-block"`) the plan's `plan-doc.ts` serializer and
 * copy/paste round-trip expect, and mints fresh ids with `createPlanBlockId` for
 * the dedupe pass.
 */
export const PlanBlockNode = createRegistryBlockNode({
  nodeName: "planBlock",
  dataTag: "data-plan-block",
  mintId: createPlanBlockId,
});

export default PlanBlockNode;
