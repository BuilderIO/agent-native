import { useT } from "@agent-native/core/client/i18n";
import { useEffect, useRef } from "react";

import { createSailTweaks, startSail } from "./sail-renderer";

export function HeroBackground() {
  const t = useT();
  const sailTweaks = createSailTweaks({
    speed: t("homepage.hero.tweaks.speed"),
    color: (index) => t("homepage.hero.tweaks.color", { index }),
    opacity: t("homepage.hero.tweaks.opacity"),
    grain: t("homepage.hero.tweaks.grain"),
    angle: t("homepage.hero.tweaks.angle"),
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      return startSail(canvas);
    } catch (error) {
      console.error("Could not start hero sail background", error);
      canvas.hidden = true;
    }
  }, []);
  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[-1] hero-sail"
      />
      <script
        type="application/json"
        id="design-tweaks"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(sailTweaks) }}
      />
    </>
  );
}
