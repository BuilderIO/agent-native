import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";

export const HouseSurfaceRoot =
  createContext<RefObject<HTMLElement | null> | null>(null);
const openSurfaces: object[] = [];

const landmarkSelector = "[data-shell-focus-landmark]";
const controlSelector =
  'button,a[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';
const available = (element: HTMLElement) =>
  element.isConnected &&
  !element.matches(':disabled,[aria-disabled="true"],[aria-busy="true"]') &&
  !element.closest(
    '[hidden],[inert],[aria-hidden="true"],[role="dialog"][data-state="closed"]',
  );

/** Keep the ancestor chain before a disappearing opener detaches from it. */
export function useHouseSurface(
  open: boolean,
  options: {
    opener(): HTMLElement | null;
    panel(): HTMLElement | null;
    dismiss?: (() => void) | undefined;
    modal?: boolean;
  },
) {
  const root = useContext(HouseSurfaceRoot);
  const token = useRef({});
  const latest = useRef(options);
  latest.current = options;
  const target = useRef<{
    opener: HTMLElement | null;
    landmarks: HTMLElement[];
  } | null>(null);
  const remember = () => {
    const opener = latest.current.opener();
    const landmarks: HTMLElement[] = [];
    let ancestor = opener ?? latest.current.panel();
    while (ancestor) {
      if (ancestor.matches(landmarkSelector)) landmarks.push(ancestor);
      ancestor = ancestor.parentElement;
    }
    if (root?.current && !landmarks.includes(root.current))
      landmarks.push(root.current);
    target.current = { opener, landmarks };
  };
  const restore = (saved = target.current) => {
    if (!saved) return false;
    const focus = (element: HTMLElement | null) => {
      if (!element || !available(element)) return false;
      element.focus({ preventScroll: true });
      return document.activeElement === element;
    };
    if (focus(saved.opener)) return true;
    for (const landmark of saved.landmarks) {
      if (!available(landmark)) continue;
      for (const control of landmark.querySelectorAll<HTMLElement>(
        controlSelector,
      )) {
        if (focus(control)) return true;
      }
      if (focus(landmark)) return true;
    }
    return false;
  };
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (open && !wasOpen.current && !target.current) remember();
    if (!open && wasOpen.current && !latest.current.modal) {
      const saved = target.current;
      restore(saved);
      setTimeout(() => {
        if (!wasOpen.current) restore(saved);
      }, 0);
    }
    if (!open) target.current = latest.current.modal ? target.current : null;
    wasOpen.current = open;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const owner = token.current;
    openSurfaces.push(owner);
    const forget = () => {
      const index = openSurfaces.indexOf(owner);
      if (index >= 0) openSurfaces.splice(index, 1);
    };
    if (!options.dismiss) return forget;
    const key = (event: KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest("[data-shell-rename]")
      )
        return;
      const panel = latest.current.panel();
      const opener = latest.current.opener();
      if (
        openSurfaces.at(-1) === owner &&
        event.key === "Escape" &&
        !event.defaultPrevented &&
        event.target instanceof Node &&
        (panel?.contains(event.target) ||
          opener?.contains(event.target) ||
          (target.current?.opener &&
            !available(target.current.opener) &&
            (event.target === document.body ||
              target.current.landmarks.some((landmark) =>
                landmark.contains(event.target as Node),
              ))))
      ) {
        event.preventDefault();
        latest.current.dismiss?.();
      }
    };
    const outside = (event: PointerEvent) => {
      if (
        openSurfaces.at(-1) !== owner ||
        event.defaultPrevented ||
        event.button !== 0 ||
        !(event.target instanceof Node)
      )
        return;
      if (
        !latest.current.panel()?.contains(event.target) &&
        !latest.current.opener()?.contains(event.target)
      )
        latest.current.dismiss?.();
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("pointerdown", outside, true);
    return () => {
      forget();
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("pointerdown", outside, true);
    };
  }, [open, Boolean(options.dismiss)]);
  useEffect(
    () => () => {
      if (wasOpen.current) {
        const saved = target.current;
        setTimeout(() => restore(saved), 0);
      }
    },
    [],
  );
  return {
    remember,
    restore() {
      const saved = target.current;
      if (!restore(saved)) setTimeout(() => restore(saved), 0);
      target.current = null;
    },
  };
}
