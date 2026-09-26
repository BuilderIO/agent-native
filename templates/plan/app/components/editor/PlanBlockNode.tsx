import { RegistryBlockDataProvider } from "@agent-native/core/blocks";
import {
  createRegistryBlockNode,
  type RegistryBlockDataValue,
  useRegistryBlockData,
} from "@agent-native/toolkit/editor";
import { createPlanBlockId, type PlanBlock } from "@shared/plan-content";
import type { ReactNode } from "react";


export type PlanBlockDataValue = RegistryBlockDataValue<PlanBlock>;

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

export function usePlanBlockData(): PlanBlockDataValue | null {
  return useRegistryBlockData<PlanBlock>();
}

export const PlanBlockNode = createRegistryBlockNode({
  nodeName: "planBlock",
  dataTag: "data-plan-block",
  mintId: createPlanBlockId,
});

export default PlanBlockNode;
