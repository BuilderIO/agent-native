import { IconArrowRight } from "@tabler/icons-react";
import { useEffect, useState } from "react";

type Props = {
  active: boolean;
  value: string;
  label: string;
};

export default function Slides2JumpInput({ active, value, label }: Props) {
  const [display, setDisplay] = useState("");

  useEffect(() => {
    if (active && value) setDisplay(value);
  }, [active, value]);

  useEffect(() => {
    if ((active && value) || !display) return;
    const timeout = window.setTimeout(() => setDisplay(""), 150);
    return () => window.clearTimeout(timeout);
  }, [active, display, value]);

  if (!display && !value) return null;
  return (
    <div
      aria-label={label}
      aria-live="polite"
      className={`pointer-events-none absolute left-1/2 top-1/2 z-40 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-background/90 px-6 py-4 font-mono text-4xl font-medium tabular-nums text-foreground shadow-2xl backdrop-blur-md transition-[opacity,scale] duration-150 ${
        value ? "scale-100 opacity-100" : "scale-95 opacity-0"
      }`}
    >
      <span aria-hidden="true" className="text-muted-foreground">
        <IconArrowRight className="inline size-7 align-middle" />
      </span>{" "}
      {value || display}
    </div>
  );
}
