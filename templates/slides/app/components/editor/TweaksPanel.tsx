import { IconX } from "@tabler/icons-react";
import type { TweakDefinition } from "@/lib/design-systems";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TweaksPanelProps {
  tweaks: TweakDefinition[];
  values: Record<string, string | number | boolean>;
  onChange: (id: string, value: string | number | boolean) => void;
  onClose: () => void;
}

export function TweaksPanel({
  tweaks,
  values,
  onChange,
  onClose,
}: TweaksPanelProps) {
  return (
    <div className="absolute bottom-4 right-4 w-64 rounded-xl border border-border bg-card shadow-2xl z-20">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          Tweaks
        </span>
        <button
          onClick={onClose}
          className="text-muted-foreground/70 hover:text-muted-foreground cursor-pointer"
        >
          <IconX className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="px-4 pb-4 space-y-4">
        {tweaks.map((tweak) => (
          <TweakControl
            key={tweak.id}
            tweak={tweak}
            value={values[tweak.id] ?? tweak.defaultValue}
            onChange={(v) => onChange(tweak.id, v)}
          />
        ))}
      </div>
    </div>
  );
}

function TweakControl({
  tweak,
  value,
  onChange,
}: {
  tweak: TweakDefinition;
  value: string | number | boolean;
  onChange: (v: string | number | boolean) => void;
}) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground mb-2">
        {tweak.label}
      </div>
      {tweak.type === "color-swatches" && (
        <div className="flex gap-2">
          {tweak.options?.map((opt) => (
            <Tooltip key={opt.value}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onChange(opt.value)}
                  className={`w-7 h-7 rounded-full cursor-pointer ${
                    value === opt.value
                      ? "ring-2 ring-foreground ring-offset-2 ring-offset-card"
                      : ""
                  }`}
                  style={{ backgroundColor: opt.color || opt.value }}
                />
              </TooltipTrigger>
              <TooltipContent>{opt.label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      )}
      {tweak.type === "segment" && (
        <div className="flex rounded-lg overflow-hidden border border-border">
          {tweak.options?.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onChange(opt.value)}
              className={`flex-1 px-3 py-1 text-[11px] font-medium cursor-pointer ${
                value === opt.value
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground/70 hover:text-muted-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
      {tweak.type === "toggle" && (
        <button
          onClick={() => onChange(!value)}
          className={`w-9 h-5 rounded-full cursor-pointer ${
            value ? "bg-primary/30" : "bg-accent"
          } relative`}
        >
          <span
            className={`block w-3.5 h-3.5 rounded-full bg-foreground absolute top-0.5 ${
              value ? "right-0.5" : "left-0.5"
            }`}
          />
        </button>
      )}
      {tweak.type === "slider" && (
        <input
          type="range"
          min={0}
          max={100}
          value={typeof value === "number" ? value : 50}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full cursor-pointer"
        />
      )}
    </div>
  );
}
