import {
  getPersistedChildren,
  getPersistedElementPath,
  resolveSlideAnimationElement,
  type AnimationTarget,
} from "./slide-animation-elements";

function commonSubsequence<T>(
  a: readonly T[],
  b: readonly T[],
  same: (x: T, y: T) => boolean,
): [number, number][] {
  const lengths = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i][j] = same(a[i], b[j])
        ? lengths[i + 1][j + 1] + 1
        : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (same(a[i], b[j])) pairs.push([i++, j++]);
    else if (lengths[i + 1][j] >= lengths[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

function htmlCounts(root: Element): Map<string, number> {
  const counts = new Map<string, number>();
  for (const element of root.querySelectorAll("*")) {
    counts.set(element.outerHTML, (counts.get(element.outerHTML) ?? 0) + 1);
  }
  return counts;
}

/**
 * Pairs each element of the `before` slide root with the element it became in
 * `after`. An element with no pair was removed, or cannot be told apart from
 * an identical sibling. Unchanged subtrees pair first; an edited element pairs
 * with the one that took its place when no sibling was added or removed beside it; a moved element (grouped, reordered) pairs
 * only when its HTML is unique on both sides, so a move is never mistaken for
 * an edit of whatever now sits at its old position.
 */
export function matchSlideElements(
  before: Element,
  after: Element,
): Map<Element, Element> {
  const matched = new Map<Element, Element>();
  const claimed = new Set<Element>();
  const beforeCounts = htmlCounts(before);
  const afterCounts = htmlCounts(after);

  const pair = (a: Element, b: Element) => {
    matched.set(a, b);
    claimed.add(b);
  };
  const pairIdentical = (a: Element, b: Element) => {
    pair(a, b);
    const bChildren = getPersistedChildren(b);
    getPersistedChildren(a).forEach((child, index) => {
      // Identical HTML has the same children, so every index has a counterpart.
      pairIdentical(child, bChildren[index]);
    });
  };
  const align = (a: Element, b: Element) => {
    pair(a, b);
    const olds = getPersistedChildren(a);
    const news = getPersistedChildren(b);
    const anchors = commonSubsequence(
      olds,
      news,
      (x, y) => x.outerHTML === y.outerHTML,
    );
    let oldStart = 0;
    let newStart = 0;
    for (const [oldEnd, newEnd] of [
      ...anchors,
      [olds.length, news.length] as [number, number],
    ]) {
      // An element whose exact HTML exists on the other side moved there; leave
      // it to the move pass instead of pairing it with its old neighbour.
      const gapOld = olds
        .slice(oldStart, oldEnd)
        .filter((element) => !afterCounts.has(element.outerHTML));
      const gapNew = news
        .slice(newStart, newEnd)
        .filter((element) => !beforeCounts.has(element.outerHTML));
      // Only a gap that kept its length pairs edits in place: with an element
      // removed or added, which old element an edited one came from is a guess.
      if (gapOld.length === gapNew.length) {
        gapOld.forEach((element, index) => align(element, gapNew[index]));
      }
      if (oldEnd < olds.length) pairIdentical(olds[oldEnd], news[newEnd]);
      oldStart = oldEnd + 1;
      newStart = newEnd + 1;
    }
  };

  align(before, after);
  const afterByHtml = new Map<string, Element>();
  for (const element of after.querySelectorAll("*")) {
    afterByHtml.set(element.outerHTML, element);
  }
  for (const element of before.querySelectorAll("*")) {
    if (matched.has(element)) continue;
    const html = element.outerHTML;
    const counterpart = afterByHtml.get(html);
    if (
      counterpart &&
      !claimed.has(counterpart) &&
      beforeCounts.get(html) === 1 &&
      afterCounts.get(html) === 1
    ) {
      pairIdentical(element, counterpart);
    }
  }
  return matched;
}

/**
 * The reveals of a slide whose HTML went from `before` to `after`, each moved
 * to the path of the element its target became. A reveal whose target has no
 * counterpart, or that did not resolve before, is kept unchanged so the save
 * refuses it instead of letting it land on a different element.
 */
export function revealsAfterEdit<T extends AnimationTarget>(
  before: string,
  after: string,
  animations: readonly T[],
): T[] {
  const parser = new DOMParser();
  const beforeRoot = parser
    .parseFromString(before, "text/html")
    .querySelector(".fmd-slide");
  const afterRoot = parser
    .parseFromString(after, "text/html")
    .querySelector(".fmd-slide");
  if (!beforeRoot || !afterRoot) return [...animations];
  const matched = matchSlideElements(beforeRoot, afterRoot);

  return animations.map((animation) => {
    const target = resolveSlideAnimationElement(beforeRoot, animation);
    const counterpart = target ? matched.get(target) : undefined;
    if (
      !counterpart ||
      resolveSlideAnimationElement(afterRoot, animation) === counterpart
    ) {
      return animation;
    }
    const path = getPersistedElementPath(afterRoot, counterpart);
    if (!path?.length) return animation;
    return {
      ...animation,
      elementPath: path,
      elementIndex: path[path.length - 1],
    };
  });
}
