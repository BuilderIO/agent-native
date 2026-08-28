import { CubeLoader } from "@agent-native/toolkit/ui/cube-loader";
import { useEffect, useState } from "react";

const LOADING_LABELS = [
  "Churning",
  "Accomplishing",
  "Actioning",
  "Actualizing",
  "Architecting",
  "Baking",
  "Befuddling",
  "Booping",
  "Brewing",
  "Calculating",
  "Canoodling",
  "Cerebrating",
  "Clauding",
  "Cogitating",
  "Combobulating",
  "Concocting",
  "Considering",
  "Cooking",
  "Crafting",
  "Creating",
  "Crystallizing",
  "Deciphering",
  "Discombobulating",
  "Doodling",
  "Finagling",
  "Flibbertigibbeting",
  "Generating",
  "Gesticulating",
  "Hatching",
  "Hullaballooing",
  "Ideating",
  "Lollygagging",
  "Manifesting",
  "Meandering",
  "Mulling",
  "Noodling",
  "Percolating",
  "Pondering",
  "Pontificating",
  "Puzzling",
  "Razzmatazzing",
  "Recombobulating",
  "Ruminating",
  "Sautéing",
  "Schlepping",
  "Spelunking",
  "Tinkering",
  "Tomfoolering",
  "Topsy-turvying",
  "Vibing",
  "Wibbling",
  "Wrangling",
  "Zigzagging",
] as const;

const LOADING_LABEL_INTERVAL_MS = 3_000;

/**
 * Full-screen loading spinner rendered during SSR and initial hydration.
 * Uses inline layout because Tailwind may not be loaded yet on the server.
 * Respects the user's OS color scheme so dark-mode users don't get a white flash.
 */

export function DefaultSpinner({
  ariaLabel = "Loading",
}: {
  ariaLabel?: string;
}) {
  const [loadingLabelIndex, setLoadingLabelIndex] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setLoadingLabelIndex((index) => (index + 1) % LOADING_LABELS.length);
    }, LOADING_LABEL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        width: "100%",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <CubeLoader aria-label={ariaLabel} className="size-6" />
        <span
          className="agent-running-shimmer"
          style={{
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
            fontSize: 16,
            fontWeight: 500,
            opacity: 0.65,
          }}
        >
          {LOADING_LABELS[loadingLabelIndex]}
        </span>
      </div>
      <style>{`
        html {
          background: hsl(var(--background, 0 0% 100%));
          color: hsl(var(--foreground, 240 10% 3.9%));
        }
        @media (prefers-color-scheme: dark) {
          html {
            background: hsl(var(--background, 240 10% 3.9%));
            color: hsl(var(--foreground, 0 0% 98%));
          }
        }
      `}</style>
    </div>
  );
}
