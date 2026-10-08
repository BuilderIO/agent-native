// @agent-native/pinpoint — Element selection via document.elementFromPoint()
// MIT License
//
// rAF-gated throttling (60fps). Target-identity short-circuit.
// Two-tier hover: fast path (highlight rect) + deferred path (component info after 100ms).
// Stash hovered element ref to prevent ghost-element race on click.

export interface ElementPickerOptions {
  onHover?: (element: Element | null, rect: DOMRect | null) => void;
  onStableHover?: (element: Element) => void;
  onSelect?: (element: Element) => void;
  ignoreSelector?: string;
  blockInteractions?: boolean;
}

export class ElementPicker {
  private active = false;
  private paused = false;
  private hoveredElement: Element | null = null;
  private rafId: number | null = null;
  private stableTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastTarget: Element | null = null;
  private options: ElementPickerOptions;

  private handleMouseMove: (e: MouseEvent) => void;
  private handleClick: (e: MouseEvent) => void;
  private handleKeyDown: (e: KeyboardEvent) => void;

  constructor(options: ElementPickerOptions = {}) {
    this.options = options;

    this.handleMouseMove = (e: MouseEvent) => {
      if (!this.active || this.paused) return;
      if (this.isOwnUI(e)) return;
      if (this.rafId !== null) return;
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        this.processHover(e.clientX, e.clientY);
      });
    };

    this.handleClick = (e: MouseEvent) => {
      if (!this.active || this.paused) return;

      if (this.isOwnUI(e)) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const target = this.hoveredElement;
      if (target && !this.shouldIgnore(target)) {
        this.options.onSelect?.(target);
      }
    };

    this.handleKeyDown = (e: KeyboardEvent) => {
      if (!this.active) return;
      if (e.key === "Escape") {
        this.deactivate();
      }
    };
  }

  private isOwnUI(e: Event): boolean {
    const path = e.composedPath();
    for (const node of path) {
      if (node instanceof HTMLElement) {
        if (node.id === "pinpoint-root") return true;
        if (node.hasAttribute?.("data-pinpoint-marker")) return true;
      }
    }
    return false;
  }

  private shouldIgnore(element: Element): boolean {
    const root = element.getRootNode();
    if (root instanceof ShadowRoot) {
      const host = root.host;
      if (host.id === "pinpoint-root") return true;
    }

    if (element.hasAttribute("data-pinpoint-marker")) return true;
    if (element.closest?.("[data-pinpoint-marker]")) return true;

    if (!this.options.ignoreSelector) return false;
    return (
      element.closest(this.options.ignoreSelector) !== null ||
      element.matches(this.options.ignoreSelector)
    );
  }

  private pierceElementFromPoint(x: number, y: number): Element | null {
    let element = document.elementFromPoint(x, y);
    if (!element) return null;

    while (element?.shadowRoot) {
      const inner = element.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === element) break;
      element = inner;
    }

    return element;
  }

  private processHover(x: number, y: number): void {
    const element = this.pierceElementFromPoint(x, y);

    if (!element || this.shouldIgnore(element)) {
      if (this.hoveredElement) {
        this.hoveredElement = null;
        this.lastTarget = null;
        this.clearStableTimeout();
        this.options.onHover?.(null, null);
      }
      return;
    }

    if (element === this.lastTarget) return;
    this.lastTarget = element;
    this.hoveredElement = element;

    const rect = element.getBoundingClientRect();
    this.options.onHover?.(element, rect);

    this.clearStableTimeout();
    this.stableTimeout = setTimeout(() => {
      if (this.hoveredElement === element) {
        this.options.onStableHover?.(element);
      }
    }, 100);
  }

  private clearStableTimeout(): void {
    if (this.stableTimeout !== null) {
      clearTimeout(this.stableTimeout);
      this.stableTimeout = null;
    }
  }

  activate(): void {
    if (this.active) return;
    this.active = true;

    document.addEventListener("mousemove", this.handleMouseMove, true);
    document.addEventListener("click", this.handleClick, true);
    document.addEventListener("keydown", this.handleKeyDown, true);

    if (this.options.blockInteractions) {
      document.body.style.pointerEvents = "none";
      const overlay = document.getElementById("pinpoint-root");
      if (overlay) overlay.style.pointerEvents = "auto";
    }
  }

  deactivate(): void {
    if (!this.active) return;
    this.active = false;

    document.removeEventListener("mousemove", this.handleMouseMove, true);
    document.removeEventListener("click", this.handleClick, true);
    document.removeEventListener("keydown", this.handleKeyDown, true);

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.clearStableTimeout();
    this.hoveredElement = null;
    this.lastTarget = null;

    if (this.options.blockInteractions) {
      document.body.style.pointerEvents = "";
    }

    this.options.onHover?.(null, null);
  }

  setBlockInteractions(value: boolean): void {
    const wasBlocking = this.options.blockInteractions;
    this.options.blockInteractions = value;

    if (this.active) {
      if (value && !wasBlocking) {
        document.body.style.pointerEvents = "none";
        const overlay = document.getElementById("pinpoint-root");
        if (overlay) overlay.style.pointerEvents = "auto";
      } else if (!value && wasBlocking) {
        document.body.style.pointerEvents = "";
      }
    }
  }

  pause(): void {
    this.paused = true;
    this.hoveredElement = null;
    this.lastTarget = null;
    this.clearStableTimeout();
    this.options.onHover?.(null, null);
  }

  resume(): void {
    this.paused = false;
  }

  isPaused(): boolean {
    return this.paused;
  }

  isActive(): boolean {
    return this.active;
  }

  getHoveredElement(): Element | null {
    return this.hoveredElement;
  }

  dispose(): void {
    this.deactivate();
  }
}
