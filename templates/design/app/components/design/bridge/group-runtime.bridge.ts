(function () {
  interface GroupState {
    width: string;
    height: string;
    sourceStyle?: string;
    lastWidth?: number;
    lastHeight?: number;
    lastRevision: number;
    unstablePasses: number;
    cyclicRevision?: number;
    lastRuntimeStyle?: string;
  }

  interface GroupRuntimeApi {
    version: number;
    scan: () => void;
  }

  const W = window as unknown as Window &
    typeof globalThis & { __anGroupRuntime?: GroupRuntimeApi };
  if (W.__anGroupRuntime?.version === 2) {
    W.__anGroupRuntime.scan();
    return;
  }

  const GROUP_SELECTOR = "[data-agent-native-measured-flow-group]";
  const states = new WeakMap<HTMLElement, GroupState>();
  const observed = new WeakSet<Element>();
  const resizeObserver =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => schedule());
  let frame = 0;
  let sourceRevision = 0;

  function writeStyle(
    group: HTMLElement,
    property: "width" | "height",
    value: string,
  ): void {
    if (group.style.getPropertyValue(property) !== value) {
      group.style.setProperty(property, value);
    }
  }

  function restore(group: HTMLElement, state: GroupState): void {
    writeStyle(group, "width", state.width);
    writeStyle(group, "height", state.height);
    state.lastRuntimeStyle = group.getAttribute("style") ?? "";
    group.setAttribute("data-agent-native-group-runtime-state", "unsupported");
  }

  function hasNonIdentityScale(value: string): boolean {
    const scale = value.trim().toLowerCase();
    if (!scale || scale === "none") return false;
    return scale.split(/\s+/).some((part) => Number(part) !== 1);
  }

  function hasNonZeroTranslate(value: string): boolean {
    const translate = value.trim().toLowerCase();
    if (!translate || translate === "none") return false;
    return translate
      .split(/\s+/)
      .some((part) => !/^[-+]?0(?:\.0+)?(?:[a-z%]+)?$/.test(part));
  }

  function transformed(element: HTMLElement): boolean {
    const computed = getComputedStyle(element);
    return (
      computed.transform !== "none" ||
      hasNonZeroTranslate(computed.translate) ||
      (computed.rotate !== "none" &&
        computed.rotate !== "0deg" &&
        computed.rotate !== "0") ||
      hasNonIdentityScale(computed.scale) ||
      !/^(?:1|normal)?$/.test(computed.getPropertyValue("zoom"))
    );
  }

  function translationOnlyTransform(value: string): boolean {
    if (typeof DOMMatrixReadOnly === "undefined") return false;
    try {
      const matrix = new DOMMatrixReadOnly(value);
      return (
        matrix.is2D &&
        Math.abs(matrix.a - 1) <= 0.001 &&
        Math.abs(matrix.b) <= 0.001 &&
        Math.abs(matrix.c) <= 0.001 &&
        Math.abs(matrix.d - 1) <= 0.001
      );
    } catch (error) {
      console.debug(
        "[agent-native] measured Group rejected an invalid transform matrix",
        error,
      );
      return false;
    }
  }

  function distortsRelativeGeometry(element: HTMLElement): boolean {
    const computed = getComputedStyle(element);
    return (
      (computed.transform !== "none" &&
        !translationOnlyTransform(computed.transform)) ||
      computed.perspective !== "none" ||
      (computed.rotate !== "none" &&
        computed.rotate !== "0deg" &&
        computed.rotate !== "0") ||
      hasNonIdentityScale(computed.scale) ||
      !/^(?:1|normal)?$/.test(computed.getPropertyValue("zoom"))
    );
  }

  function unsupported(element: HTMLElement): boolean {
    const style = element.style;
    return (
      [
        style.width,
        style.height,
        style.minWidth,
        style.maxWidth,
        style.minHeight,
        style.maxHeight,
        style.flexBasis,
      ].some((value) => /%|\b(?:calc|var|min|max|clamp)\s*\(/i.test(value)) ||
      Number.parseFloat(getComputedStyle(element).flexGrow) > 0 ||
      transformed(element)
    );
  }

  function hasTransformedAncestor(group: HTMLElement): boolean {
    for (
      let parent = group.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      if (distortsRelativeGeometry(parent)) return true;
    }
    return false;
  }

  function refreshCanonicalState(group: HTMLElement, state: GroupState): void {
    const sourceStyle = (
      group as HTMLElement & { __anSourceMeta?: { style: string } }
    ).__anSourceMeta?.style;
    if (sourceStyle === undefined || sourceStyle === state.sourceStyle) return;
    const probe = document.createElement("div");
    probe.style.cssText = sourceStyle;
    state.width = probe.style.width;
    state.height = probe.style.height;
    state.sourceStyle = sourceStyle;
  }

  function measure(group: HTMLElement): void {
    let state = states.get(group);
    if (!state) {
      state = {
        width: group.style.width,
        height: group.style.height,
        lastRevision: sourceRevision,
        unstablePasses: 0,
      };
      states.set(group, state);
    }
    refreshCanonicalState(group, state);
    if (state.cyclicRevision === sourceRevision) {
      restore(group, state);
      return;
    }
    const children = Array.from(group.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    );
    if (
      children.length === 0 ||
      unsupported(group) ||
      hasTransformedAncestor(group) ||
      children.some(unsupported)
    ) {
      restore(group, state);
      return;
    }
    const groupRect = group.getBoundingClientRect();
    let minLeft = 0;
    let minTop = 0;
    let maxRight = 0;
    let maxBottom = 0;
    for (const child of children) {
      const rect = child.getBoundingClientRect();
      minLeft = Math.min(minLeft, rect.left - groupRect.left);
      minTop = Math.min(minTop, rect.top - groupRect.top);
      maxRight = Math.max(maxRight, rect.right - groupRect.left);
      maxBottom = Math.max(maxBottom, rect.bottom - groupRect.top);
    }
    if (minLeft < -0.01 || minTop < -0.01) {
      restore(group, state);
      return;
    }
    const width = maxRight - minLeft;
    const height = maxBottom - minTop;
    if (![width, height].every(Number.isFinite) || width < 0 || height < 0) {
      restore(group, state);
      return;
    }
    const changedAgain =
      state.lastRevision === sourceRevision &&
      state.lastWidth !== undefined &&
      state.lastHeight !== undefined &&
      (Math.abs(width - state.lastWidth) > 0.01 ||
        Math.abs(height - state.lastHeight) > 0.01);
    state.unstablePasses = changedAgain ? state.unstablePasses + 1 : 0;
    state.lastRevision = sourceRevision;
    state.lastWidth = width;
    state.lastHeight = height;
    if (state.unstablePasses >= 2) {
      state.cyclicRevision = sourceRevision;
      restore(group, state);
      return;
    }

    writeStyle(group, "width", `${Number(width.toFixed(4))}px`);
    writeStyle(group, "height", `${Number(height.toFixed(4))}px`);
    state.lastRuntimeStyle = group.getAttribute("style") ?? "";
    group.setAttribute("data-agent-native-group-runtime-state", "active");
  }

  function depth(element: Element): number {
    let value = 0;
    for (
      let parent = element.parentElement;
      parent;
      parent = parent.parentElement
    )
      value += 1;
    return value;
  }

  function scan(): void {
    const groups = Array.from(
      document.querySelectorAll<HTMLElement>(GROUP_SELECTOR),
    ).sort((left, right) => depth(right) - depth(left));
    for (const group of groups) {
      if (resizeObserver && !observed.has(group)) {
        observed.add(group);
        resizeObserver.observe(group);
      }
      for (const child of group.children) {
        if (resizeObserver && !observed.has(child)) {
          observed.add(child);
          resizeObserver.observe(child);
        }
      }
      measure(group);
    }
  }

  function schedule(): void {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      scan();
    });
  }

  W.__anGroupRuntime = { version: 2, scan: schedule };
  if (typeof MutationObserver !== "undefined" && document.body) {
    new MutationObserver((records) => {
      if (
        records.some((record) => {
          if (
            record.type !== "attributes" ||
            record.attributeName !== "style" ||
            !(record.target instanceof HTMLElement)
          ) {
            return true;
          }
          const state = states.get(record.target);
          return (
            !state ||
            state.lastRuntimeStyle !==
              (record.target.getAttribute("style") ?? "")
          );
        })
      ) {
        sourceRevision += 1;
      }
      schedule();
    }).observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "hidden", "style"],
      childList: true,
      characterData: true,
      subtree: true,
    });
  }
  W.addEventListener("resize", () => {
    sourceRevision += 1;
    schedule();
  });
  if (document.fonts) {
    void document.fonts.ready.then(() => {
      sourceRevision += 1;
      schedule();
    });
    if (typeof document.fonts.addEventListener === "function") {
      document.fonts.addEventListener("loadingdone", () => {
        sourceRevision += 1;
        schedule();
      });
    }
  }
  schedule();
})();
