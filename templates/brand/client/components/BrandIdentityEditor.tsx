import { useEffect, useState } from "react";
import { useBrandConfig, useUpdateBrandConfig } from "@/hooks/use-brand";
import type { BrandConfig } from "@shared/types";

const DEFAULT_CONFIG: BrandConfig = {
  name: "",
  description: "",
  colors: {
    primary: "#3B82F6",
    secondary: "#6366F1",
    accent: "#F59E0B",
    background: "#FFFFFF",
    text: "#111827",
  },
  fonts: {
    heading: "Inter",
    body: "Inter",
  },
};

const COLOR_FIELDS = [
  { key: "primary" as const, label: "Primary" },
  { key: "secondary" as const, label: "Secondary" },
  { key: "accent" as const, label: "Accent" },
  { key: "background" as const, label: "Background" },
  { key: "text" as const, label: "Text" },
];

export function BrandIdentityEditor() {
  const { data: savedConfig, isLoading } = useBrandConfig();
  const updateConfig = useUpdateBrandConfig();
  const [config, setConfig] = useState<BrandConfig>(DEFAULT_CONFIG);
  const [dirty, setDirty] = useState(false);

  // Sync from server
  useEffect(() => {
    if (savedConfig) {
      setConfig(savedConfig);
    }
  }, [savedConfig]);

  // Debounced save
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => {
      updateConfig.mutate(config);
      setDirty(false);
    }, 600);
    return () => clearTimeout(timer);
  }, [config, dirty]);

  function update(partial: Partial<BrandConfig>) {
    setConfig((prev) => ({ ...prev, ...partial }));
    setDirty(true);
  }

  function updateColor(key: keyof BrandConfig["colors"], value: string) {
    setConfig((prev) => ({
      ...prev,
      colors: { ...prev.colors, [key]: value },
    }));
    setDirty(true);
  }

  function updateFont(key: keyof BrandConfig["fonts"], value: string) {
    setConfig((prev) => ({
      ...prev,
      fonts: { ...prev.fonts, [key]: value },
    }));
    setDirty(true);
  }

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-muted-foreground">
        Loading brand config...
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6 space-y-6">
      {/* Name & Description */}
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            Brand Name
          </label>
          <input
            type="text"
            value={config.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="Your brand name"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            Description
          </label>
          <textarea
            value={config.description}
            onChange={(e) => update({ description: e.target.value })}
            placeholder="Describe your brand's identity and values"
            rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
        </div>
      </div>

      {/* Colors */}
      <div>
        <h3 className="mb-3 text-sm font-medium text-foreground">Colors</h3>
        <div className="grid grid-cols-5 gap-4">
          {COLOR_FIELDS.map(({ key, label }) => (
            <div key={key} className="space-y-1.5">
              <label className="block text-xs text-muted-foreground">
                {label}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={config.colors[key]}
                  onChange={(e) => updateColor(key, e.target.value)}
                  className="h-8 w-8 cursor-pointer rounded border border-input bg-transparent"
                />
                <input
                  type="text"
                  value={config.colors[key]}
                  onChange={(e) => updateColor(key, e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Fonts */}
      <div>
        <h3 className="mb-3 text-sm font-medium text-foreground">Fonts</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1.5 block text-xs text-muted-foreground">
              Heading Font
            </label>
            <input
              type="text"
              value={config.fonts.heading}
              onChange={(e) => updateFont("heading", e.target.value)}
              placeholder="e.g. Inter, Poppins"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-muted-foreground">
              Body Font
            </label>
            <input
              type="text"
              value={config.fonts.body}
              onChange={(e) => updateFont("body", e.target.value)}
              placeholder="e.g. Inter, Open Sans"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
      </div>

      {/* Save indicator */}
      {updateConfig.isPending && (
        <p className="text-xs text-muted-foreground">Saving...</p>
      )}
    </div>
  );
}
