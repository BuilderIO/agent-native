import { useState, useCallback } from "react";
import { IconTransform, IconLoader2 } from "@tabler/icons-react";

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
      setError(err?.message || "Failed to convert mermaid to excalidraw");
    } finally {
      setLoading(false);
    }
  }, [mermaidDefinition, onConvert]);

  return (
    <div className="p-3 space-y-3">
      <div className="text-xs text-white/50">
        Convert this mermaid diagram to an editable Excalidraw drawing?
      </div>
      <pre className="text-[10px] text-white/40 bg-white/[0.03] rounded p-2 max-h-24 overflow-auto">
        {mermaidDefinition.slice(0, 300)}
        {mermaidDefinition.length > 300 ? "..." : ""}
      </pre>
      {error && <div className="text-xs text-red-400">{error}</div>}
      <div className="flex gap-2">
        <button
          onClick={handleConvert}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#609FF8] hover:bg-[#7AB2FA] text-black text-xs font-medium disabled:opacity-50"
        >
          {loading ? (
            <IconLoader2 className="w-3 h-3 animate-spin" />
          ) : (
            <IconTransform className="w-3 h-3" />
          )}
          Convert
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-md text-xs text-white/50 hover:text-white/70 hover:bg-white/[0.06]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Standalone converter function for use outside the panel UI
 */
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
