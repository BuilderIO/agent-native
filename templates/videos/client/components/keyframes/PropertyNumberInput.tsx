import { Label } from "../ui/label";

interface PropertyNumberInputProps {
  label: string;
  icon?: React.ReactNode;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  decimals?: number;
}

export function PropertyNumberInput({
  label,
  icon,
  value,
  onChange,
  step = 1,
  min,
  max,
  suffix = "",
  decimals = 0,
}: PropertyNumberInputProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseFloat(e.target.value);
    if (!Number.isFinite(newValue)) return;
    
    // Apply min/max constraints if provided
    let constrainedValue = newValue;
    if (min !== undefined) constrainedValue = Math.max(min, constrainedValue);
    if (max !== undefined) constrainedValue = Math.min(max, constrainedValue);
    
    onChange(constrainedValue);
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
        {icon}
        {label}
        {suffix && <span className="opacity-60">({suffix})</span>}
      </Label>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value.toFixed(decimals)}
        onChange={handleChange}
        className="w-full text-xs bg-secondary border border-border rounded-lg px-2.5 py-1.5 text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-blue-400/40"
      />
    </div>
  );
}
