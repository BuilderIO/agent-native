import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router";
import { StudioHeader } from "@/components/StudioHeader";
import { ComponentLibraryView } from "@/pages/ComponentLibraryView";
import { ComponentLibrarySidebar } from "@/components/ComponentLibrarySidebar";
import { libraryComponents } from "@/remotion/componentRegistry";
import { CurrentElementProvider } from "@/contexts/CurrentElementContext";
import { useIsMobile } from "@/hooks/use-mobile";

export default function ComponentLibrary() {
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const initialSidebarSet = useRef(false);

  useEffect(() => {
    if (!initialSidebarSet.current && isMobile) {
      setSidebarOpen(false);
      initialSidebarSet.current = true;
    }
  }, [isMobile]);

  // Get component from URL param (?id=card) or default to first
  const componentIdFromUrl = searchParams.get("id");
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(
    componentIdFromUrl ||
      (libraryComponents.length > 0 ? libraryComponents[0].id : null),
  );

  // Get initial frame from URL param (?frame=60)
  const frameFromUrl = searchParams.get("frame");
  const initialFrame = frameFromUrl ? parseInt(frameFromUrl, 10) : undefined;

  const selectedComponent = libraryComponents.find(
    (c) => c.id === selectedComponentId,
  );

  // Live prop values for preview (not saved)
  const [propValues, setPropValues] = useState<Record<string, any>>({});

  // Reset prop values when component changes
  useEffect(() => {
    if (selectedComponent) {
      setPropValues(selectedComponent.defaultProps);
    }
  }, [selectedComponentId]);

  // Update URL when component selection changes
  const handleSelectComponent = (id: string) => {
    setSelectedComponentId(id);
    const newParams = new URLSearchParams(searchParams);
    newParams.set("id", id);
    setSearchParams(newParams, { replace: true });
  };

  // Handle prop value changes
  const handlePropChange = (propName: string, value: any) => {
    setPropValues((prev) => ({ ...prev, [propName]: value }));
  };

  // Sync URL params on mount
  useEffect(() => {
    if (selectedComponentId && !componentIdFromUrl) {
      const newParams = new URLSearchParams(searchParams);
      newParams.set("id", selectedComponentId);
      setSearchParams(newParams, { replace: true });
    }
  }, []);

  return (
    <CurrentElementProvider>
      <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
        <StudioHeader
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        />

        <div className="flex flex-1 min-h-0 relative">
          {/* Left Sidebar with Tabs */}
          <ComponentLibrarySidebar
            open={sidebarOpen}
            selectedComponentId={selectedComponentId}
            selectedComponent={selectedComponent}
            onSelectComponent={handleSelectComponent}
            propValues={propValues}
            onPropChange={handlePropChange}
          />

          {/* Center - Preview */}
          <div className="flex-1 min-w-0 overflow-y-auto">
            {selectedComponent ? (
              <ComponentLibraryView
                component={selectedComponent}
                initialFrame={initialFrame}
                propValues={propValues}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <p className="text-lg">No component selected</p>
                  <p className="text-sm mt-2">
                    Select a component from the sidebar to preview
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </CurrentElementProvider>
  );
}
