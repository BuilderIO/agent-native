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
  const width = b.length + 1;
  const lengths = new Array<number>((a.length + 1) * width).fill(0);
  const length = (i: number, j: number) => lengths.at(i * width + j) ?? 0;
  const matches = (i: number, j: number) => {
    const x = a.at(i);
    const y = b.at(j);
    return x !== undefined && y !== undefined && same(x, y);
  };
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i * width + j] = matches(i, j)
        ? length(i + 1, j + 1) + 1
        : Math.max(length(i + 1, j), length(i, j + 1));
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (matches(i, j)) pairs.push([i++, j++]);
    else if (length(i + 1, j) >= length(i, j + 1)) i++;
    else j++;
  }
  return pairs;
}

/**
 * How much of their text two elements share at its start and end, ranked by the
 * shared start first: splitting an element keeps the original's start on the
 * first half. 0 unless the shared text covers at least half the shorter text,
 * so a common word or letter does not make unrelated elements look alike.
 */
function textAffinity(a: Element, b: Element): number {
  const x = a.textContent.trim();
  const y = b.textContent.trim();
  let start = 0;
  while (start < x.length && start < y.length && x[start] === y[start]) {
    start++;
  }
  let end = 0;
  while (
    end < x.length - start &&
    end < y.length - start &&
    x[x.length - 1 - end] === y[y.length - 1 - end]
  ) {
    end++;
  }
  const shared = start + end;
  if (shared === 0 || shared * 2 < Math.min(x.length, y.length)) return 0;
  // Slide text is far shorter than this, so any shared start outranks any end.
  return start * 1_000_000 + end;
}

function sharesChild(a: Element, b: Element): boolean {
  const html = new Set(getPersistedChildren(b).map((child) => child.outerHTML));
  return getPersistedChildren(a).some((child) => html.has(child.outerHTML));
}

/**
 * Pairs the edited elements of a gap between unchanged siblings. An old element
 * pairs with the new one it shares the most text with when each is the other's
 * only best match. With no text in common anywhere in its row and column, an
 * element pairs with the one at its position when the gap kept its length and
 * the two still look alike (same tag, or a shared child). A pair that crosses
 * another is a reorder whose pairing is a guess, so neither is kept.
 */
function pairGap(
  gapOld: readonly Element[],
  gapNew: readonly Element[],
): [Element, Element][] {
  const scores = gapOld.map((old) =>
    gapNew.map((next) => textAffinity(old, next)),
  );
  const score = (i: number, j: number) => scores.at(i)?.at(j) ?? 0;
  const candidates: [number, number][] = [];
  gapOld.forEach((old, i) => {
    const row = gapNew.map((_, j) => score(i, j));
    const best = Math.max(0, ...row);
    if (best > 0) {
      const j = row.indexOf(best);
      const unique =
        row.filter((value) => value === best).length === 1 &&
        gapOld.every((_, k) => k === i || score(k, j) < best);
      if (unique) candidates.push([i, j]);
      return;
    }
    const next = gapNew.at(i);
    if (
      next &&
      gapOld.length === gapNew.length &&
      gapOld.every((_, k) => score(k, i) === 0) &&
      (old.tagName === next.tagName || sharesChild(old, next))
    ) {
      candidates.push([i, i]);
    }
  });
  return candidates.flatMap(([i, j]) => {
    const old = gapOld.at(i);
    const next = gapNew.at(j);
    const crosses = candidates.some(([k, l]) => (k - i) * (l - j) < 0);
    return old && next && !crosses ? [[old, next] as [Element, Element]] : [];
  });
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
 * what replaced it. Unchanged subtrees pair first, and identical siblings pair
 * in order, so of two identical copies the first is assumed to be the original.
 * An edited element pairs with the element between the same unchanged
 * siblings that it still resembles (see pairGap).
 * A moved element (grouped, reordered) pairs only when its HTML is unique on
 * both sides, so a move is never mistaken for an edit of whatever now sits at
 * its old position.
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
      const counterpart = bChildren.at(index);
      if (counterpart) pairIdentical(child, counterpart);
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
      for (const [element, counterpart] of pairGap(gapOld, gapNew)) {
        align(element, counterpart);
      }
      const oldAnchor = olds.at(oldEnd);
      const newAnchor = news.at(newEnd);
      if (oldAnchor && newAnchor) pairIdentical(oldAnchor, newAnchor);
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
  return revealsAfterRootEdit(beforeRoot, afterRoot, animations);
}

/**
 * {@link matchSlideElements} across a slide that went through each root in
 * turn, so every edit is paired on its own instead of as one combined change.
 */
export function matchSlideElementsAcross(
  roots: readonly Element[],
): Map<Element, Element> {
  let matched: Map<Element, Element> | undefined;
  for (const [index, root] of roots.entries()) {
    const previous = roots.at(index - 1);
    if (index === 0 || !previous) continue;
    const step = matchSlideElements(previous, root);
    matched = matched
      ? new Map(
          [...matched].flatMap(([element, current]) => {
            const counterpart = step.get(current);
            return counterpart ? [[element, counterpart] as const] : [];
          }),
        )
      : step;
  }
  return matched ?? new Map();
}

/** {@link revealsAfterEdit} for slide roots the caller already parsed. */
export function revealsAfterRootEdit<T extends AnimationTarget>(
  beforeRoot: Element,
  afterRoot: Element,
  animations: readonly T[],
  matched: ReadonlyMap<Element, Element> = matchSlideElements(
    beforeRoot,
    afterRoot,
  ),
): T[] {
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
