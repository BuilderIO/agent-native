import { Starfield } from "@agent-native/toolkit/marketing";

export interface StarfieldBackgroundProps {
  className?: string;
  frameRate?: number;
}

export function StarfieldBackground({
  className,
  frameRate = 30,
}: StarfieldBackgroundProps) {
  return <Starfield className={className} frameRate={frameRate} />;
}
