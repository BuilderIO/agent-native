import { WaveBackground } from "@agent-native/toolkit/app/shared";

export function HeroBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0">
      <WaveBackground className="h-full w-full" />
    </div>
  );
}
