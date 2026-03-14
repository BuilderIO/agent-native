import { useState } from "react";
import { CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MetricValidationForm } from "./MetricValidationForm";

interface MetricValidationButtonProps {
  metricName: string;
  metricValue?: number | string | null;
  metricId?: string; // If it exists in data dictionary
  variant?: "default" | "ghost" | "outline";
  size?: "default" | "sm" | "icon";
  showLabel?: boolean;
}

export function MetricValidationButton({
  metricName,
  metricValue,
  metricId,
  variant = "ghost",
  size = "sm",
  showLabel = false,
}: MetricValidationButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button
        onClick={() => setIsOpen(true)}
        variant={variant}
        size={size}
        className="text-muted-foreground hover:text-foreground"
        title={`Validate "${metricName}"`}
      >
        <CheckCircle className="h-3.5 w-3.5" />
        {showLabel && <span className="ml-1.5">Validate</span>}
      </Button>

      <MetricValidationForm
        metricName={metricName}
        metricId={metricId}
        metricValue={metricValue}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
}
