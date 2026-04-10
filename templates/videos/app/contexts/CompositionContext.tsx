import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";
import { compositions, type CompositionEntry } from "@/remotion/registry";
import type { CompSettings } from "@/components/CompSettingsEditor";

// ─── Persistence helpers ──────────────────────────────────────────────────────

const PROPS_KEY = (id: string) => `videos-props:${id}`;
const SETTINGS_KEY = (id: string) => `videos-comp-settings:${id}`;

function loadCompSettings(id: string, defaults: CompSettings): CompSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY(id));
    if (!raw) return defaults;
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}

function saveCompSettings(id: string, settings: CompSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY(id), JSON.stringify(settings));
  } catch {}
}

function loadProps(
  compositionId: string,
  defaults: Record<string, any>,
): Record<string, any> {
  try {
    const raw = localStorage.getItem(PROPS_KEY(compositionId));
    if (!raw) return defaults;
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}

function saveProps(compositionId: string, props: Record<string, any>) {
  try {
    localStorage.setItem(PROPS_KEY(compositionId), JSON.stringify(props));
  } catch {}
}

// ─── Context type ─────────────────────────────────────────────────────────────

type CompositionContextType = {
  compositionId: string;
  isNew: boolean;
  selected: CompositionEntry | undefined;
  effectiveComposition: CompositionEntry | undefined;
  currentProps: Record<string, any>;
  compSettings: CompSettings | undefined;
  onNavigate: (path: string) => void;
  onDelete: (id: string) => void;
  onPropsChange: (props: Record<string, any>) => void;
  onTitleChange: (title: string) => void;
  onCompSettingsChange: (patch: Partial<CompSettings>) => void;
};

const CompositionContext = createContext<CompositionContextType | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

type CompositionProviderProps = {
  children: ReactNode;
  compositionId: string;
};

export function CompositionProvider({
  children,
  compositionId,
}: CompositionProviderProps) {
  const navigate = useNavigate();

  const isNew = compositionId === "new";
  const selected = useMemo(
    () => compositions.find((c) => c.id === compositionId),
    [compositionId],
  );

  // ── Composition settings (duration + fps) ─────────────────────────────────
  const [compSettingsOverrides, setCompSettingsOverrides] = useState<
    Record<string, CompSettings>
  >(() => {
    const initial: Record<string, CompSettings> = {};
    for (const c of compositions) {
      initial[c.id] = loadCompSettings(c.id, {
        durationInFrames: c.durationInFrames,
        fps: c.fps,
        width: c.width,
        height: c.height,
      });
    }
    return initial;
  });

  const handleCompSettingsChange = useCallback(
    (patch: Partial<CompSettings>) => {
      if (!selected) return;
      setCompSettingsOverrides((prev) => {
        const current = prev[selected.id] ?? {
          durationInFrames: selected.durationInFrames,
          fps: selected.fps,
          width: selected.width,
          height: selected.height,
        };
        const next = { ...current, ...patch };
        saveCompSettings(selected.id, next);
        return { ...prev, [selected.id]: next };
      });
    },
    [selected],
  );

  // Build the effective composition — registry defaults merged with user overrides
  const effectiveComposition = useMemo(() => {
    if (!selected) return undefined;
    const settings = compSettingsOverrides[selected.id];
    if (!settings) return selected;

    const effective = {
      ...selected,
      durationInFrames: settings.durationInFrames,
      fps: settings.fps,
      width: settings.width,
      height: settings.height,
    };

    // Debug log to help diagnose FPS timing issues
    if (selected.fps !== settings.fps) {
      console.log(`[Videos] FPS mismatch detected for ${selected.id}:`);
      console.log(
        `  Registry: ${selected.fps} fps, ${selected.durationInFrames} frames`,
      );
      console.log(
        `  Settings: ${settings.fps} fps, ${settings.durationInFrames} frames`,
      );
      console.log(
        `  This may cause timing issues if keyframes were designed for ${selected.fps} fps`,
      );
    }

    return effective;
  }, [selected, compSettingsOverrides]);

  // ── Composition props ─────────────────────────────────────────────────────
  const [propsOverrides, setPropsOverrides] = useState<
    Record<string, Record<string, any>>
  >(() => {
    const initial: Record<string, Record<string, any>> = {};
    for (const c of compositions) {
      initial[c.id] = loadProps(c.id, c.defaultProps);
    }
    return initial;
  });

  const currentProps = selected
    ? (propsOverrides[selected.id] ?? selected.defaultProps)
    : {};

  // Save props to localStorage when changed (skip first load)
  const prevPropsRef = useRef<Record<string, Record<string, any>>>({});
  const propsInitialLoadRef = useRef(true);

  useEffect(() => {
    // Skip the very first load
    if (propsInitialLoadRef.current) {
      propsInitialLoadRef.current = false;
      prevPropsRef.current = propsOverrides;
      return;
    }

    for (const id of Object.keys(propsOverrides)) {
      if (propsOverrides[id] !== prevPropsRef.current[id]) {
        console.log("[Videos] 💾 Saving props to localStorage (user edit)");
        saveProps(id, propsOverrides[id]);
      }
    }
    prevPropsRef.current = propsOverrides;
  }, [propsOverrides]);

  // Sync changes from other tabs via storage event
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (!selected?.id) return;

      const propsKey = PROPS_KEY(selected.id);
      const settingsKey = SETTINGS_KEY(selected.id);

      if (e.key === propsKey && e.newValue) {
        const newProps = loadProps(selected.id, selected.defaultProps);
        setPropsOverrides((prev) => ({ ...prev, [selected.id]: newProps }));
        console.log("[Videos] Synced props from another tab");
      } else if (e.key === settingsKey && e.newValue) {
        const newSettings = loadCompSettings(selected.id, {
          durationInFrames: selected.durationInFrames,
          fps: selected.fps,
          width: selected.width,
          height: selected.height,
        });
        setCompSettingsOverrides((prev) => ({
          ...prev,
          [selected.id]: newSettings,
        }));
        console.log("[Videos] Synced composition settings from another tab");
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [selected]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handlePropsChange = useCallback(
    (newProps: Record<string, any>) => {
      if (!selected) return;
      setPropsOverrides((prev) => ({ ...prev, [selected.id]: newProps }));
    },
    [selected],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      // Delete from DB FIRST. If this fails, we leave the in-memory
      // registry untouched so the composition doesn't reappear on reload.
      // Note: action routes return HTTP 200 even when the action body
      // contains `{ error }`, so we have to check the body too.
      try {
        const res = await fetch(`/_agent-native/actions/delete-composition`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        if (!res.ok) {
          throw new Error(`delete-composition failed: ${res.status}`);
        }
        const data = (await res.json().catch(() => null)) as {
          success?: boolean;
          error?: string;
        } | null;
        if (!data?.success) {
          throw new Error(
            data?.error ?? "delete-composition returned no success flag",
          );
        }
      } catch (err) {
        console.error("[Videos] Failed to delete composition:", err);
        // Bail out — UI stays in sync with the database
        return;
      }

      // DB delete succeeded; now safe to update the in-memory registry
      const idx = compositions.findIndex((c) => c.id === id);
      if (idx !== -1) compositions.splice(idx, 1);

      const remaining = compositions.filter((c) => c.id !== id);
      if (id === compositionId && remaining.length > 0) {
        navigate(`/c/${remaining[0].id}`, { replace: true });
      } else if (remaining.length === 0) {
        navigate("/c/new", { replace: true });
      }
    },
    [compositionId, navigate],
  );

  const handleTitleChange = useCallback(
    (title: string) => {
      if (!selected) return;
      const compIndex = compositions.findIndex((c) => c.id === selected.id);
      if (compIndex !== -1) {
        compositions[compIndex].title = title;
        console.log(`[Videos] Renamed composition to: ${title}`);
        setPropsOverrides((prev) => ({ ...prev }));
      }
    },
    [selected],
  );

  const value = useMemo(
    () => ({
      compositionId,
      isNew,
      selected,
      effectiveComposition,
      currentProps,
      compSettings: selected
        ? (compSettingsOverrides[selected.id] ?? {
            durationInFrames: selected.durationInFrames,
            fps: selected.fps,
            width: selected.width,
            height: selected.height,
          })
        : undefined,
      onNavigate: (path: string) => navigate(path),
      onDelete: handleDelete,
      onPropsChange: handlePropsChange,
      onTitleChange: handleTitleChange,
      onCompSettingsChange: handleCompSettingsChange,
    }),
    [
      compositionId,
      isNew,
      selected,
      effectiveComposition,
      currentProps,
      compSettingsOverrides,
      navigate,
      handleDelete,
      handlePropsChange,
      handleTitleChange,
      handleCompSettingsChange,
    ],
  );

  return (
    <CompositionContext.Provider value={value}>
      {children}
    </CompositionContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useComposition() {
  const context = useContext(CompositionContext);
  if (!context) {
    throw new Error("useComposition must be used within CompositionProvider");
  }
  return context;
}
