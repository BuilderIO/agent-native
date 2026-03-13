import "./global.css";

import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { DeckProvider } from "@/context/DeckContext";
import Index from "./pages/Index";
import DeckEditor from "./pages/DeckEditor";
import Presentation from "./pages/Presentation";
import SharedPresentation from "./pages/SharedPresentation";
import NotFound from "./pages/NotFound";

// Key forces DeckProvider remount when code changes (HMR)
const DECK_KEY = 3;

import {
  enterStyleEditing as coreEnterStyleEditing,
  enterTextEditing as coreEnterTextEditing,
  exitSelectionMode as coreExitSelectionMode,
} from "@agent-native/core/client";

/** Track whether we (the app) put the user into selection mode via a slide click */
let weEnteredSelectionMode = false;

/** Helper to send selection mode messages and track state */
export function enterSelectionMode(type: "builder.enterStyleEditing" | "builder.enterTextEditing", data: { selector: string }) {
  weEnteredSelectionMode = true;
  if (type === "builder.enterStyleEditing") {
    coreEnterStyleEditing(data.selector);
  } else {
    coreEnterTextEditing(data.selector);
  }
}

export function exitSelectionMode() {
  weEnteredSelectionMode = false;
  coreExitSelectionMode();
}

function useExitSelectionOnOutsideClick() {
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      // Only exit if we are the ones who entered selection mode
      if (!weEnteredSelectionMode) return;

      const target = e.target as HTMLElement;
      // If the click is inside a slide, don't exit — SlideEditor handles those
      if (target.closest(".slide-content") || target.closest(".slide-image-clickable")) {
        return;
      }
      console.log("[App] exitSelectionMode — clicked outside slide", target.tagName, target.className);
      exitSelectionMode();
    };
    window.addEventListener("pointerdown", handler, { capture: true });
    return () => window.removeEventListener("pointerdown", handler, { capture: true });
  }, []);
}


const App = () => {
  useExitSelectionOnOutsideClick();
  return (
  <DeckProvider key={DECK_KEY}>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/deck/:id" element={<DeckEditor />} />
        <Route path="/deck/:id/present" element={<Presentation />} />
        <Route path="/share/:token" element={<SharedPresentation />} />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </DeckProvider>
  );
};

createRoot(document.getElementById("root")!).render(<App />);
