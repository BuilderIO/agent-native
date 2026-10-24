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
    if (selected.sourceInstanceId) {
      const index = styles.findIndex(
        (instance) =>
          instance.sourceInstanceId === selected.sourceInstanceId &&
          instance.styleKey === selected.styleKey &&
          instance.targetNodeId === selected.targetNodeId,
      );
      if (index >= 0) {
        return createMotionNativeStyleIdentity(styles[index]!, index);
      }
    }

    const current = styles[selected.index];
    if (
      current?.styleKey === selected.styleKey &&
      current.targetNodeId === selected.targetNodeId &&
      (!selected.sourceInstanceId ||
        current.sourceInstanceId === selected.sourceInstanceId)
    ) {
      return createMotionNativeStyleIdentity(current, selected.index);
    }

    const matchingIndices = styles.flatMap((instance, index) =>
      instance.styleKey === selected.styleKey &&
      instance.targetNodeId === selected.targetNodeId
        ? [index]
        : [],
    );
    if (matchingIndices.length > 0) {
      const index = matchingIndices.reduce((closest, candidate) =>
        Math.abs(candidate - selected.index) <
        Math.abs(closest - selected.index)
          ? candidate
          : closest,
      );
      return createMotionNativeStyleIdentity(styles[index]!, index);
    }
  }

  const fallbackTargetNodeId = selected?.targetNodeId ?? targetNodeId;
  for (let index = styles.length - 1; index >= 0; index -= 1) {
    const instance = styles[index];
    if (
      instance &&
      (!fallbackTargetNodeId || instance.targetNodeId === fallbackTargetNodeId)
    ) {
      return createMotionNativeStyleIdentity(instance, index);
    }
  }

  return null;
}

export function removeMotionNativeStyleAndReconcileSelection(
  styles: MotionNativeStyleInstance[],
  selection: MotionNativeStyleIdentity | null,
  identity: MotionNativeStyleIdentity,
  fallbackTargetNodeId?: string | null,
): {
  styles: MotionNativeStyleInstance[];
  selection: MotionNativeStyleIdentity | null;
} {
  const index = identity.sourceInstanceId
    ? styles.findIndex(
        (instance) =>
          instance.sourceInstanceId === identity.sourceInstanceId &&
          instance.styleKey === identity.styleKey &&
          instance.targetNodeId === identity.targetNodeId,
      )
    : identity.index;
  const removed = styles[index];
  if (
    !removed ||
    removed.styleKey !== identity.styleKey ||
    removed.targetNodeId !== identity.targetNodeId ||
    (identity.sourceInstanceId &&
      removed.sourceInstanceId !== identity.sourceInstanceId)
  ) {
    return { styles, selection };
  }

  const nextStyles = styles.filter((_, currentIndex) => currentIndex !== index);
  const resolvedSelection = resolveMotionNativeStyleIdentity(
    styles,
    selection?.targetNodeId ?? fallbackTargetNodeId,
    selection,
  );
  const selectedIndex = resolvedSelection?.index ?? -1;
  const nextSelectedIndex =
    selectedIndex < 0 || selectedIndex === index
      ? -1
      : selectedIndex > index
        ? selectedIndex - 1
        : selectedIndex;
  const nextSelected =
    nextSelectedIndex >= 0 ? nextStyles[nextSelectedIndex] : undefined;

  return {
    styles: nextStyles,
    selection: nextSelected
      ? createMotionNativeStyleIdentity(nextSelected, nextSelectedIndex)
      : resolveMotionNativeStyleIdentity(
          nextStyles,
          resolvedSelection?.targetNodeId ??
            fallbackTargetNodeId ??
            identity.targetNodeId,
          null,
        ),
  };
}
