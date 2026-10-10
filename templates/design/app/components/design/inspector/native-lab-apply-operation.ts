import type { NativeEffectEdit } from "@shared/native-effect-edits";
import type { EffectDefinition, EffectValue } from "@shared/native-effects";

export type NativeLabApplyOperation = Extract<
  NativeEffectEdit,
  { kind: "revise-definition" | "set-params" | "set-params-many" }
>;

export function nativeLabApplyOperation({
  definition,
  fromVersion,
  instanceId,
  sharedInstanceIds,
  params,
  sourceDirty,
  shared,
}: {
  definition: EffectDefinition;
  fromVersion: number;
  instanceId: string;
  sharedInstanceIds: string[];
  params: Record<string, EffectValue>;
  sourceDirty: boolean;
  shared: boolean;
}): NativeLabApplyOperation {
  if (sourceDirty)
    return {
      kind: "revise-definition",
      definition,
      fromVersion,
      instanceIds: shared ? sharedInstanceIds : [instanceId],
      params,
    };
  return shared
    ? { kind: "set-params-many", instanceIds: sharedInstanceIds, params }
    : { kind: "set-params", instanceId, params };
}
