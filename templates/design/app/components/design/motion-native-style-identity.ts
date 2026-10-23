import type {
  MotionNativeStyleInstance,
  MotionNativeStyleKey,
} from "@shared/motion-native-style";

export interface MotionNativeStyleIdentity {
  key: string;
  styleKey: MotionNativeStyleKey;
  targetNodeId: string;
  index: number;
  sourceInstanceId?: string;
}

export function createMotionNativeStyleIdentity(
  instance: MotionNativeStyleInstance,
  index: number,
): MotionNativeStyleIdentity {
  return {
    key: JSON.stringify([instance.styleKey, instance.targetNodeId, index]),
    styleKey: instance.styleKey,
    targetNodeId: instance.targetNodeId,
    index,
    ...(instance.sourceInstanceId
      ? { sourceInstanceId: instance.sourceInstanceId }
      : {}),
  };
}

export function resolveMotionNativeStyleIdentity(
  styles: MotionNativeStyleInstance[],
  targetNodeId: string | null | undefined,
  selected: MotionNativeStyleIdentity | null | undefined,
): MotionNativeStyleIdentity | null {
  if (selected) {
    const current = styles[selected.index];
    if (
      current?.styleKey === selected.styleKey &&
      current.targetNodeId === selected.targetNodeId &&
      (!selected.sourceInstanceId ||
        current.sourceInstanceId === selected.sourceInstanceId) &&
      (!targetNodeId || current.targetNodeId === targetNodeId)
    ) {
      return createMotionNativeStyleIdentity(current, selected.index);
    }
  }

  for (let index = styles.length - 1; index >= 0; index -= 1) {
    const instance = styles[index];
    if (instance && (!targetNodeId || instance.targetNodeId === targetNodeId)) {
      return createMotionNativeStyleIdentity(instance, index);
    }
  }

  return null;
}
