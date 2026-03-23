import type { EasingKey } from "@/types";
import { EASING_OPTIONS } from "@/remotion/easingFunctions";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

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
      <Select value={value} onValueChange={(val) => onChange(val as EasingKey)}>
        <SelectTrigger
          className={`w-full h-auto text-xs bg-secondary border border-border rounded-lg pl-2.5 py-1.5 text-foreground focus:outline-none focus:ring-2 focus:ring-${accentColor}/40`}
          title="Controls how the animation moves TO this keyframe"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {EASING_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
