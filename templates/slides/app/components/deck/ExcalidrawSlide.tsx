import {
  useEffect,
  useRef,
  useCallback,
  useState,
  lazy,
  Suspense,
} from "react";
import { Skeleton } from "@/components/ui/skeleton";

const Excalidraw = lazy(async () => {
  const mod = await import("@excalidraw/excalidraw");
  return { default: mod.Excalidraw };
});

export interface ExcalidrawData {
  elements: any[];
  appState?: Record<string, any>;
  files?: Record<string, any>;
}

interface ExcalidrawSlideProps {
  initialData?: string; // JSON string of ExcalidrawData
  onChange?: (data: string) => void;
  readOnly?: boolean;
}

export function parseExcalidrawData(json?: string): ExcalidrawData | null {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function ExcalidrawSlide({
  initialData,
  onChange,
  readOnly = false,
}: ExcalidrawSlideProps) {
  const excalidrawRef = useRef<any>(null);
  const [mounted, setMounted] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSerializedRef = useRef<string>(initialData || "");

  const parsed = parseExcalidrawData(initialData);

  const handleChange = useCallback(
    (elements: any[], appState: any, files: any) => {
      if (readOnly || !onChange) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const data: ExcalidrawData = {
          elements: elements.filter((el: any) => !el.isDeleted),
          appState: {
            viewBackgroundColor: appState.viewBackgroundColor,
            gridSize: appState.gridSize,
          },
          files: files || {},
        };
        const serialized = JSON.stringify(data);
        if (serialized !== lastSerializedRef.current) {
          lastSerializedRef.current = serialized;
          onChange(serialized);
        }
      }, 500);
    },
    [onChange, readOnly],
  );

  useEffect(() => {
    setMounted(true);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  if (!mounted) {
    return <Skeleton className="w-full h-full bg-white/[0.06]" />;
  }

  return (
    <div className="w-full h-full" style={{ minHeight: 200 }}>
      <Suspense
        fallback={<Skeleton className="w-full h-full bg-white/[0.06]" />}
      >
        <Excalidraw
          excalidrawAPI={(api: any) => {
            excalidrawRef.current = api;
          }}
          initialData={{
            elements: parsed?.elements || [],
            appState: {
              theme: "dark",
              viewBackgroundColor: "transparent",
              ...(parsed?.appState || {}),
            },
            files: parsed?.files,
          }}
          onChange={handleChange}
          viewModeEnabled={readOnly}
          zenModeEnabled={readOnly}
          UIOptions={{
            canvasActions: readOnly
              ? {
                  changeViewBackgroundColor: false,
                  export: false,
                  loadScene: false,
                  saveToActiveFile: false,
                  toggleTheme: false,
                }
              : {},
          }}
        />
      </Suspense>
    </div>
  );
}

/**
 * Static SVG export for thumbnails — much lighter than rendering
 * the full Excalidraw component.
 */
export function ExcalidrawThumbnail({ data }: { data: string }) {
  const [svg, setSvg] = useState<string>("");

  useEffect(() => {
    const parsed = parseExcalidrawData(data);
    if (!parsed?.elements?.length) return;

    import("@excalidraw/excalidraw").then(async (mod) => {
      try {
        const svgEl = await mod.exportToSvg({
          elements: parsed.elements,
          appState: {
            theme: "dark",
            viewBackgroundColor: "transparent",
            exportWithDarkMode: true,
            ...(parsed.appState || {}),
          },
          files: parsed.files || {},
        });
        setSvg(svgEl.outerHTML);
      } catch {
        // silently fail for thumbnails
      }
    });
  }, [data]);

  if (!svg) return null;

  return (
    <div
      className="w-full h-full flex items-center justify-center [&_svg]:max-w-full [&_svg]:max-h-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
