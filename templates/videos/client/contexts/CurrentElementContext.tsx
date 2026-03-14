import React, { createContext, useContext, useState, useCallback } from "react";
import type { ElementAnimation } from "@/types/elementAnimations";

export interface CurrentElement {
  id: string;
  type: string; // Component type, e.g., "Card", "Button"
  label: string;
  compositionId: string;
  cursorType?: "default" | "pointer" | "text"; // Current cursor type for this element
}

interface CurrentElementContextType {
  currentElement: CurrentElement | null;
  setCurrentElement: (element: CurrentElement | null) => void;

  // Element animations storage
  elementAnimations: Record<string, ElementAnimation[]>; // compositionId -> animations
  getAnimationsForElement: (
    compositionId: string,
    elementType: string,
  ) => ElementAnimation[];
  addAnimation: (compositionId: string, animation: ElementAnimation) => void;
  updateAnimation: (
    compositionId: string,
    animationId: string,
    updates: Partial<ElementAnimation>,
  ) => void;
  deleteAnimation: (compositionId: string, animationId: string) => void;

  // Cursor type storage per element
  getCursorType: (
    compositionId: string,
    elementType: string,
  ) => "default" | "pointer" | "text" | undefined;
  setCursorType: (
    compositionId: string,
    elementType: string,
    cursorType: "default" | "pointer" | "text",
  ) => void;
  deleteCursorType: (compositionId: string, elementType: string) => void;
}

const CurrentElementContext = createContext<
  CurrentElementContextType | undefined
>(undefined);

const ELEMENT_ANIMATIONS_KEY = "videos-element-animations";
const ELEMENT_CURSOR_TYPES_KEY = "videos-element-cursor-types";

function loadElementAnimations(): Record<string, ElementAnimation[]> {
  try {
    const stored = localStorage.getItem(ELEMENT_ANIMATIONS_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveElementAnimations(animations: Record<string, ElementAnimation[]>) {
  try {
    localStorage.setItem(ELEMENT_ANIMATIONS_KEY, JSON.stringify(animations));
  } catch (e) {
    console.error("Failed to save element animations:", e);
  }
}

type CursorTypeMap = Record<string, "default" | "pointer" | "text">; // "compositionId:elementType" -> cursorType

function loadCursorTypes(): CursorTypeMap {
  try {
    const stored = localStorage.getItem(ELEMENT_CURSOR_TYPES_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveCursorTypes(cursorTypes: CursorTypeMap) {
  try {
    localStorage.setItem(ELEMENT_CURSOR_TYPES_KEY, JSON.stringify(cursorTypes));
  } catch (e) {
    console.error("Failed to save cursor types:", e);
  }
}

export const CurrentElementProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [currentElement, setCurrentElement] = useState<CurrentElement | null>(
    null,
  );
  const [elementAnimations, setElementAnimations] = useState<
    Record<string, ElementAnimation[]>
  >(loadElementAnimations);
  const [cursorTypes, setCursorTypes] =
    useState<CursorTypeMap>(loadCursorTypes);

  // Reload animations after mount to catch module-level initializations
  React.useEffect(() => {
    const reloadAnimations = () => {
      const loaded = loadElementAnimations();
      setElementAnimations(loaded);
      console.log(
        "🔄 Reloaded animations:",
        Object.keys(loaded).reduce(
          (acc, key) => ({ ...acc, [key]: loaded[key].length }),
          {},
        ),
      );
    };

    // Reload once after a short delay to catch initialization
    const timer = setTimeout(reloadAnimations, 100);

    // Listen for storage events from other windows/tabs
    window.addEventListener("storage", reloadAnimations);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("storage", reloadAnimations);
    };
  }, []);

  const getAnimationsForElement = useCallback(
    (compositionId: string, elementType: string) => {
      const compAnimations = elementAnimations[compositionId] || [];
      return compAnimations.filter((anim) => anim.elementType === elementType);
    },
    [elementAnimations],
  );

  const addAnimation = useCallback(
    (compositionId: string, animation: ElementAnimation) => {
      setElementAnimations((prev) => {
        const next = {
          ...prev,
          [compositionId]: [...(prev[compositionId] || []), animation],
        };
        saveElementAnimations(next);
        return next;
      });
    },
    [],
  );

  const updateAnimation = useCallback(
    (
      compositionId: string,
      animationId: string,
      updates: Partial<ElementAnimation>,
    ) => {
      setElementAnimations((prev) => {
        const compAnimations = prev[compositionId] || [];
        const next = {
          ...prev,
          [compositionId]: compAnimations.map((anim) =>
            anim.id === animationId ? { ...anim, ...updates } : anim,
          ),
        };
        saveElementAnimations(next);
        return next;
      });
    },
    [],
  );

  const deleteAnimation = useCallback(
    (compositionId: string, animationId: string) => {
      setElementAnimations((prev) => {
        const compAnimations = prev[compositionId] || [];
        const next = {
          ...prev,
          [compositionId]: compAnimations.filter(
            (anim) => anim.id !== animationId,
          ),
        };
        saveElementAnimations(next);
        return next;
      });
    },
    [],
  );

  const getCursorType = useCallback(
    (compositionId: string, elementType: string) => {
      const key = `${compositionId}:${elementType}`;
      return cursorTypes[key];
    },
    [cursorTypes],
  );

  const setCursorTypeCallback = useCallback(
    (
      compositionId: string,
      elementType: string,
      cursorType: "default" | "pointer" | "text",
    ) => {
      const key = `${compositionId}:${elementType}`;
      setCursorTypes((prev) => {
        const next = { ...prev, [key]: cursorType };
        saveCursorTypes(next);
        return next;
      });
    },
    [],
  );

  const deleteCursorType = useCallback(
    (compositionId: string, elementType: string) => {
      const key = `${compositionId}:${elementType}`;
      setCursorTypes((prev) => {
        const next = { ...prev };
        delete next[key];
        saveCursorTypes(next);
        return next;
      });
    },
    [],
  );

  return (
    <CurrentElementContext.Provider
      value={{
        currentElement,
        setCurrentElement,
        elementAnimations,
        getAnimationsForElement,
        addAnimation,
        updateAnimation,
        deleteAnimation,
        getCursorType,
        setCursorType: setCursorTypeCallback,
        deleteCursorType,
      }}
    >
      {children}
    </CurrentElementContext.Provider>
  );
};

export const useCurrentElement = () => {
  const context = useContext(CurrentElementContext);
  if (!context) {
    throw new Error(
      "useCurrentElement must be used within CurrentElementProvider",
    );
  }
  return context;
};
