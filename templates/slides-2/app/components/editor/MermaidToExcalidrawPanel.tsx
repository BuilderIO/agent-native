import { useT } from "@agent-native/core/client/i18n";
import { IconTransform, IconLoader2 } from "@tabler/icons-react";
import { useState, useCallback } from "react";

import { Button } from "@/components/ui/button";

interface MermaidToExcalidrawPanelProps {
  mermaidDefinition: string;
  onConvert: (excalidrawData: string) => void;
  onCancel: () => void;
}

export function MermaidToExcalidrawPanel({
  mermaidDefinition,
  onConvert,
  onCancel,
}: MermaidToExcalidrawPanelProps) {
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleConvert = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { parseMermaidToExcalidraw } =
        await import("@excalidraw/mermaid-to-excalidraw");
      const { convertToExcalidrawElements } =
        await import("@excalidraw/excalidraw");

      const { elements, files } =
        await parseMermaidToExcalidraw(mermaidDefinition);
      const excalidrawElements = convertToExcalidrawElements(elements);

      const data = JSON.stringify({
        elements: excalidrawElements,
        appState: {
          viewBackgroundColor: "transparent",
        },
        files: files || {},
      });

      onConvert(data);
    } catch (err: any) {
      setError(err?.message || t("editorToolbar.convertMermaidFailed"));
    } finally {
      setLoading(false);
    }
  }, [mermaidDefinition, onConvert, t]);

  return (
    <div className="p-3 space-y-3">
      <div className="text-xs text-muted-foreground">
        {t("raw.mermaidConvertPrompt")}
      </div>
      <pre className="text-[10px] text-muted-foreground bg-muted rounded p-2 max-h-24 overflow-auto">
        {mermaidDefinition.slice(0, 300)}
        {mermaidDefinition.length > 300 ? "..." : ""}
      </pre>
      {error && <div className="text-xs text-destructive">{error}</div>}
      <div className="flex gap-2">
        <Button
          type="button"
          size="xs"
          onClick={handleConvert}
          disabled={loading}
          className="h-auto gap-1.5 rounded-md bg-[hsl(var(--slides-accent))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--slides-accent-foreground))] hover:bg-[hsl(var(--slides-accent-hover))] hover:text-[hsl(var(--slides-accent-foreground))] active:scale-100 [&_svg]:size-3"
        >
          {loading ? (
            <IconLoader2 className="w-3 h-3 animate-spin" />
          ) : (
            <IconTransform className="w-3 h-3" />
          )}
          {t("raw.convert")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={onCancel}
          className="h-auto rounded-md px-3 py-1.5 text-xs font-normal text-muted-foreground hover:text-foreground hover:bg-accent active:scale-100"
        >
          {t("designSystems.cancel")}
        </Button>
      </div>
    </div>
  );
}

export async function convertMermaidToExcalidraw(
  mermaidDefinition: string,
): Promise<string> {
  const { parseMermaidToExcalidraw } =
    await import("@excalidraw/mermaid-to-excalidraw");
  const { convertToExcalidrawElements } =
    await import("@excalidraw/excalidraw");

  const { elements, files } = await parseMermaidToExcalidraw(mermaidDefinition);
  const excalidrawElements = convertToExcalidrawElements(elements);

  return JSON.stringify({
    elements: excalidrawElements,
    appState: { viewBackgroundColor: "transparent" },
    files: files || {},
  });
}
