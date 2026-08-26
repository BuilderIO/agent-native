import { IconCheck } from "@tabler/icons-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

const VISIBLE_MS = 2400;
const TRANSITION_MS = 200;

interface SnackbarMessage {
  // Bumped per call so repeating the same text still restarts the timer and
  // re-announces to screen readers.
  id: number;
  text: string;
  icon: ReactNode;
}

type ShowSnackbar = (text: string, icon?: ReactNode) => void;

const SnackbarContext = createContext<ShowSnackbar | null>(null);

export function useSnackbar(): ShowSnackbar {
  const show = useContext(SnackbarContext);
  if (!show) {
    throw new Error("useSnackbar must be used inside a SnackbarProvider");
  }
  return show;
}

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<SnackbarMessage | null>(null);
  // Tracked separately from `message` so the pill stays mounted through its
  // exit transition instead of vanishing the moment the timer fires.
  const [shown, setShown] = useState(false);
  const timersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const frameRef = useRef(0);
  const nextIdRef = useRef(0);

  const clearPending = useCallback(() => {
    for (const timer of timersRef.current) clearTimeout(timer);
    timersRef.current = [];
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
  }, []);

  useEffect(() => clearPending, [clearPending]);

  const show = useCallback<ShowSnackbar>(
    (text, icon) => {
      clearPending();
      nextIdRef.current += 1;
      setMessage({
        id: nextIdRef.current,
        text,
        icon: icon ?? <IconCheck size={14} stroke={1.75} aria-hidden="true" />,
      });
      // Mount in the offset state, then flip on the next frame so the browser
      // has a "from" value to transition out of.
      setShown(false);
      frameRef.current = requestAnimationFrame(() => setShown(true));
      timersRef.current.push(
        setTimeout(() => setShown(false), VISIBLE_MS),
        setTimeout(() => setMessage(null), VISIBLE_MS + TRANSITION_MS),
      );
    },
    [clearPending],
  );

  return (
    <SnackbarContext.Provider value={show}>
      {children}
      <div
        role="status"
        aria-live="polite"
        // Centering lives on this wrapper so the pill's own transform is free
        // to carry the enter/exit slide. The z-index sits above the dialog
        // layers in ../../ui/dialog.tsx: copying the install command from
        // inside the Get Started modal has to stay visible.
        className="pointer-events-none fixed bottom-[var(--spacing-6)] left-1/2 z-[100060] -translate-x-1/2"
      >
        {message ? (
          <div
            key={message.id}
            // duration-200 must stay equal to TRANSITION_MS, which is what the
            // unmount timer waits on before dropping the pill.
            className={[
              "inline-flex items-center gap-[var(--spacing-2)] rounded-[var(--b-radius)] border border-solid border-[var(--b-snackbar-border)] bg-[var(--b-snackbar-bg)] px-[var(--spacing-4)] py-[10px] font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-1)] leading-none text-[var(--b-snackbar-text)]",
              "transition-[opacity,transform] duration-200 ease-[ease]",
              shown ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
            ].join(" ")}
          >
            {message.icon}
            {message.text}
          </div>
        ) : null}
      </div>
    </SnackbarContext.Provider>
  );
}
