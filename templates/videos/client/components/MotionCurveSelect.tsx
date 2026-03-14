import type { EasingKey } from "@/types";
import { EASING_OPTIONS } from "@/remotion/easingFunctions";
import { Label } from "./ui/label";

interface MotionCurveSelectProps {
  value: EasingKey;
  onChange: (easing: EasingKey) => void;
  accentColor?: string;
  label?: string;
}

export const MotionCurveSelect: React.FC<MotionCurveSelectProps> = ({
  value,
  onChange,
  accentColor = "blue-400",
  label = "Motion Curve (arriving)",
}) => {
  return (
    <div className="space-y-1.5 pt-2 border-t border-border/40">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as EasingKey)}
        className={`w-full text-xs bg-secondary border border-border rounded-lg pl-2.5 pr-8 py-1.5 text-foreground focus:outline-none focus:ring-2 focus:ring-${accentColor}/40`}
        title="Controls how the animation moves TO this keyframe"
      >
        {EASING_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
};
