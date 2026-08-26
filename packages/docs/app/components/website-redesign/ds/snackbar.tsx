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
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextIdRef = useRef(0);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const show = useCallback<ShowSnackbar>((text, icon) => {
    nextIdRef.current += 1;
    setMessage({
      id: nextIdRef.current,
      text,
      icon: icon ?? <IconCheck size={14} stroke={1.75} aria-hidden="true" />,
    });
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setMessage(null), VISIBLE_MS);
  }, []);

  return (
    <SnackbarContext.Provider value={show}>
      {children}
      <div
        role="status"
        aria-live="polite"
        style={{
          position: "fixed",
          bottom: "var(--spacing-6)",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 100,
          pointerEvents: "none",
        }}
      >
        {message ? (
          <div
            key={message.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--spacing-2)",
              padding: "10px var(--spacing-4)",
              borderRadius: "var(--b-radius)",
              border: "1px solid var(--b-snackbar-border)",
              background: "var(--b-snackbar-bg)",
              color: "var(--b-snackbar-text)",
              fontFamily: "var(--b-font-mono)",
              fontSize: "var(--b-t-label-1)",
              lineHeight: 1,
            }}
          >
            {message.icon}
            {message.text}
          </div>
        ) : null}
      </div>
    </SnackbarContext.Provider>
  );
}
