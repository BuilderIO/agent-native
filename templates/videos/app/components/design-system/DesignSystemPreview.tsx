import type { DesignSystemData } from "../../../shared/api";
import { cn } from "@/lib/utils";

interface DesignSystemPreviewProps {
  data: DesignSystemData;
  className?: string;
}

export function DesignSystemPreview({
  data,
  className,
}: DesignSystemPreviewProps) {
  const swatches = [
    { label: "Primary", color: data.colors.primary },
    { label: "Secondary", color: data.colors.secondary },
    { label: "Accent", color: data.colors.accent },
    { label: "Background", color: data.colors.background },
    { label: "Text", color: data.colors.text },
  ];

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card overflow-hidden",
        className,
      )}
    >
      {/* Color swatches */}
      <div className="p-4 border-b border-border">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 mb-3">
          Colors
        </div>
        <div className="flex items-center gap-3">
          {swatches.map((s) => (
            <div key={s.label} className="flex flex-col items-center gap-1.5">
              <div
                className="w-8 h-8 rounded-full border border-border"
                style={{ background: s.color }}
              />
              <span className="text-[10px] text-muted-foreground/70">
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Typography sample */}
      <div className="p-4 border-b border-border">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 mb-3">
          Typography
        </div>
        <div
          style={{
            fontFamily: `'${data.typography.headingFont}', sans-serif`,
            fontWeight: data.typography.headingWeight,
            fontSize: "20px",
            color: data.colors.text,
            lineHeight: 1.2,
          }}
        >
          {data.typography.headingFont} Heading
        </div>
        <div
          style={{
            fontFamily: `'${data.typography.bodyFont}', sans-serif`,
            fontWeight: data.typography.bodyWeight,
            fontSize: "13px",
            color: data.colors.textMuted,
            marginTop: "6px",
            lineHeight: 1.5,
          }}
        >
          Body text rendered in {data.typography.bodyFont} at weight{" "}
          {data.typography.bodyWeight}. This is how paragraph content will
          appear.
        </div>
      </div>

      {/* Mini composition preview */}
      <div className="p-4">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 mb-3">
          Composition Preview
        </div>
        <div
          className="rounded-lg overflow-hidden"
          style={{
            background: data.slideDefaults.background,
            aspectRatio: "16 / 9",
            padding: "20px 28px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              fontSize: "8px",
              fontWeight: 700,
              letterSpacing: "2px",
              textTransform:
                data.slideDefaults.labelStyle === "none"
                  ? undefined
                  : data.slideDefaults.labelStyle,
              color: data.colors.accent,
              marginBottom: "6px",
            }}
          >
            SECTION
          </div>
          <div
            style={{
              fontFamily: `'${data.typography.headingFont}', sans-serif`,
              fontWeight: data.typography.headingWeight,
              fontSize: "16px",
              color: data.colors.text,
              lineHeight: 1.15,
              letterSpacing: "-0.5px",
            }}
          >
            Composition Title
          </div>
          <div
            style={{
              fontFamily: `'${data.typography.bodyFont}', sans-serif`,
              fontWeight: data.typography.bodyWeight,
              fontSize: "7px",
              color: data.colors.textMuted,
              marginTop: "6px",
              lineHeight: 1.5,
            }}
          >
            Supporting text appears here with your brand styling applied
            consistently across all compositions.
          </div>
          {/* Accent bar */}
          <div
            style={{
              width: "24px",
              height: data.borders.accentWidth,
              background: data.colors.accent,
              borderRadius: data.borders.radius,
              marginTop: "10px",
            }}
          />
        </div>
      </div>

      {/* Logos */}
      {data.logos.length > 0 && (
        <div className="p-4 border-t border-border">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 mb-3">
            Logos
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {data.logos.map((logo, i) => (
              <div
                key={`${logo.name}-${i}`}
                className="w-10 h-10 rounded-lg bg-accent/50 border border-border flex items-center justify-center overflow-hidden"
              >
                <img
                  src={logo.url}
                  alt={logo.name}
                  className="max-w-full max-h-full object-contain"
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
