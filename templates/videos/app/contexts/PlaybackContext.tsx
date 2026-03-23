import {
  createContext,
  useContext,
  useState,
  useMemo,
  type ReactNode,
} from "react";
import { useComposition } from "./CompositionContext";

// ─── Context type ─────────────────────────────────────────────────────────────

type PlaybackContextType = {
  currentFrame: number;
  fps: number;
  onSeek: ((frame: number) => void) | undefined;
  setCurrentFrame: (frame: number) => void;
  registerSeek: (fn: ((frame: number) => void) | undefined) => void;
};

const PlaybackContext = createContext<PlaybackContextType | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

type PlaybackProviderProps = {
  children: ReactNode;
};

export function PlaybackProvider({ children }: PlaybackProviderProps) {
  const { effectiveComposition, compSettings } = useComposition();
  const [currentFrame, setCurrentFrame] = useState(0);
  const [seekToFrame, setSeekToFrame] = useState<
    ((frame: number) => void) | undefined
  >();

  // Get fps from effective composition or settings
  const fps = effectiveComposition?.fps ?? compSettings?.fps ?? 30;

  const value = useMemo(
    () => ({
      currentFrame,
      fps,
      onSeek: seekToFrame,
      setCurrentFrame,
      registerSeek: setSeekToFrame,
    }),
    [currentFrame, fps, seekToFrame],
  );

  return (
    <PlaybackContext.Provider value={value}>
      {children}
    </PlaybackContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePlayback() {
  const context = useContext(PlaybackContext);
  if (!context) {
    throw new Error("usePlayback must be used within PlaybackProvider");
  }
  return context;
}
