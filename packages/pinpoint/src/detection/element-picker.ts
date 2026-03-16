// @agent-native/pinpoint — Element selection via document.elementFromPoint()
// MIT License
//
// rAF-gated throttling (60fps). Target-identity short-circuit.
// Two-tier hover: fast path (highlight rect) + deferred path (component info after 100ms).
// Stash hovered element ref to prevent ghost-element race on click.

export interface ElementPickerOptions {
  /** Called on hover with the element under the cursor */
  onHover?: (element: Element | null, rect: DOMRect | null) => void;
  /** Called after stable hover (100ms) with full element context */
  onStableHover?: (element: Element) => void;
  /** Called when an element is clicked/selected */
  onSelect?: (element: Element) => void;
  /** Elements to ignore (e.g., pinpoint's own UI) */
  ignoreSelector?: string;
  /** Whether to block page interactions during selection */
  blockInteractions?: boolean;
}

export class ElementPicker {
  private active = false;
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
      if (!this.active) return;
      // rAF-gated throttling for 60fps
      if (this.rafId !== null) return;
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        this.processHover(e.clientX, e.clientY);
      });
    };

    this.handleClick = (e: MouseEvent) => {
      if (!this.active) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      // Use the stashed hovered element to prevent ghost-element race
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

  private shouldIgnore(element: Element): boolean {
    if (!this.options.ignoreSelector) return false;
    return (
      element.closest(this.options.ignoreSelector) !== null ||
      element.matches(this.options.ignoreSelector)
    );
  }

  private pierceElementFromPoint(x: number, y: number): Element | null {
    let element = document.elementFromPoint(x, y);
    if (!element) return null;

    // Pierce through Shadow DOM
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

    // Target-identity short-circuit: skip processing if same element
    if (element === this.lastTarget) return;
    this.lastTarget = element;
    this.hoveredElement = element;

    // Fast path: immediate highlight rect
    const rect = element.getBoundingClientRect();
    this.options.onHover?.(element, rect);

    // Deferred path: component info after 100ms stable hover
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

    // Use capture to intercept before any element handlers
    document.addEventListener("mousemove", this.handleMouseMove, true);
    document.addEventListener("click", this.handleClick, true);
    document.addEventListener("keydown", this.handleKeyDown, true);

    if (this.options.blockInteractions) {
      document.body.style.pointerEvents = "none";
      // Re-enable pointer events on our own overlay
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

  isActive(): boolean {
    return this.active;
  }

  /** Get the currently hovered element */
  getHoveredElement(): Element | null {
    return this.hoveredElement;
  }

  dispose(): void {
    this.deactivate();
  }
}
