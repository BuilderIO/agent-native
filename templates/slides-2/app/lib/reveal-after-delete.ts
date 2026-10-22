import {
  getPersistedElementPath,
  resolveElementPath,
  resolveSlideAnimationElement,
  storedPathOfRenderedElement,
  type AnimationTarget,
} from "./slide-animation-elements";

/**
 * The reveals that survive deleting the rendered `removed` objects from a slide,
 * renumbered to where their elements sit once the objects are gone. `stored` is
 * the HTML the canvas was rendered from, so every path here is a stored-HTML
 * path, the one playback and save resolve against.
 *
 * A reveal whose element is removed, or sits inside a removed object, is dropped.
 * A reveal that already fails to resolve is kept unchanged, so the save refuses
 * it instead of letting it land on a different object.
 */
export function revealsAfterDelete<T extends AnimationTarget>(
  stored: string,
  removed: readonly Element[],
  animations: readonly T[],
): T[] {
  const doc = new DOMParser().parseFromString(stored, "text/html");
  const root = doc.querySelector(".fmd-slide");
  if (!root) return [...animations];

  const deleted = removed.flatMap((element) => {
    const path = storedPathOfRenderedElement(stored, element);
    const object = path ? resolveElementPath(root, path) : null;
    return object ? [object] : [];
  });
  // Resolve before removing: a path only names an element on the untouched tree.
  const targets = animations.map((animation) =>
    resolveSlideAnimationElement(root, animation),
  );
  const gone = targets.map(
    (target) =>
      target !== null && deleted.some((object) => object.contains(target)),
  );
  for (const object of deleted) object.remove();

  return animations.flatMap((animation, index) => {
    const target = targets[index];
    if (!target) return [animation];
    if (gone[index]) return [];
    const path = getPersistedElementPath(root, target);
    if (!path?.length) return [animation];
    // Written as a path so the reveal no longer depends on the legacy
    // container's child order, which a delete also shifts.
    return [
      { ...animation, elementPath: path, elementIndex: path[path.length - 1]! },
    ];
  });
}
