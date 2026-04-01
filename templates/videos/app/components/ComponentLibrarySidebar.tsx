import { useState, useMemo, Component, type ReactNode } from "react";
import {
  libraryComponents,
  type LibraryComponentEntry,
  type ComponentCategory,
} from "@/remotion/componentRegistry";
import { cn } from "@/lib/utils";
import {
  IconBox,
  IconAdjustmentsHorizontal,
  IconChevronRight,
  IconFileText,
  IconInfoCircle,
} from "@tabler/icons-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CurrentElementPanel } from "@/components/CurrentElementPanel";

class SafeBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

type ComponentLibrarySidebarProps = {
  open: boolean;
  selectedComponentId: string | null;
  selectedComponent: LibraryComponentEntry | undefined;
  onSelectComponent: (id: string) => void;
  propValues: Record<string, any>;
  onPropChange: (propName: string, value: any) => void;
};

export function ComponentLibrarySidebar({
  open,
  selectedComponentId,
  selectedComponent,
  onSelectComponent,
  propValues,
  onPropChange,
}: ComponentLibrarySidebarProps) {
  const [tab, setTab] = useState<"components" | "properties">("components");
  const [openSections, setOpenSections] = useState({
    props: true,
  });
  const [expandedCategories, setExpandedCategories] = useState<
    Set<ComponentCategory>
  >(new Set(["Atoms", "Molecules", "Organisms", "Templates", "Pages"]));

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const toggleCategory = (category: ComponentCategory) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  // Group components by category
  const componentsByCategory = useMemo(() => {
    const grouped = new Map<ComponentCategory, LibraryComponentEntry[]>();
    const categories: ComponentCategory[] = [
      "Atoms",
      "Molecules",
      "Organisms",
      "Templates",
      "Pages",
    ];

    categories.forEach((cat) => grouped.set(cat, []));

    libraryComponents.forEach((component) => {
      const category = component.category || "Atoms";
      if (!grouped.has(category)) {
        grouped.set(category, []);
      }
      grouped.get(category)!.push(component);
    });

    return grouped;
  }, []);

  if (!open) return null;

  return (
    <div className="w-64 border-r border-border bg-secondary/30 flex flex-col overflow-hidden">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "components" | "properties")}
        className="flex flex-col h-full"
      >
        <TabsList className="w-full rounded-none border-b border-border bg-transparent h-auto p-0 shrink-0">
          <TabsTrigger
            value="components"
            className="flex-1 rounded-none border-b-2 border-transparent px-3 py-2.5 text-[11px] font-medium text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            Components
          </TabsTrigger>
          <TabsTrigger
            value="properties"
            className="flex-1 rounded-none border-b-2 border-transparent px-3 py-2.5 text-[11px] font-medium text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            Properties
          </TabsTrigger>
        </TabsList>

        {/* Components Tab */}
        <TabsContent value="components" className="flex-1 overflow-hidden mt-0">
          <div className="h-full flex flex-col">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">
                Component Library
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                Organized by atomic design
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2 scrollbar-thin">
              {libraryComponents.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  <IconBox className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No components yet</p>
                  <p className="text-xs mt-1">Components will appear here</p>
                </div>
              ) : (
                Array.from(componentsByCategory.entries()).map(
                  ([category, components]) => {
                    if (components.length === 0) return null;

                    const isExpanded = expandedCategories.has(category);

                    return (
                      <div key={category} className="space-y-1.5">
                        {/* Category Header */}
                        <button
                          onClick={() => toggleCategory(category)}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-secondary/50 transition-colors text-xs font-semibold text-muted-foreground"
                        >
                          <IconChevronRight
                            className={cn(
                              "w-3 h-3 transition-transform",
                              isExpanded && "rotate-90",
                            )}
                          />
                          {category}
                          <span className="ml-auto text-[10px] font-mono">
                            {components.length}
                          </span>
                        </button>

                        {/* Components in Category */}
                        {isExpanded && (
                          <div className="space-y-1 pl-3">
                            {components.map((component) => (
                              <button
                                key={component.id}
                                onClick={() => onSelectComponent(component.id)}
                                className={cn(
                                  "w-full text-left px-3 py-2 rounded-md transition-colors",
                                  "hover:bg-secondary",
                                  selectedComponentId === component.id
                                    ? "bg-primary/10 text-primary border border-primary/20"
                                    : "bg-secondary/50 text-foreground",
                                )}
                              >
                                <div className="font-medium text-sm">
                                  {component.title}
                                </div>
                                {component.description && (
                                  <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                    {component.description}
                                  </div>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  },
                )
              )}
            </div>
          </div>
        </TabsContent>

        {/* Properties Tab */}
        <TabsContent value="properties" className="flex-1 overflow-hidden mt-0">
          <div className="h-full flex flex-col overflow-y-auto scrollbar-thin">
            {selectedComponent ? (
              <>
                {/* Cursor Interactions Section */}
                <details className="group">
                  <summary className="cursor-pointer list-none">
                    <div className="flex items-center gap-2 p-2 rounded hover:bg-secondary/50 transition-colors">
                      <IconAdjustmentsHorizontal className="w-3.5 h-3.5 text-green-400" />
                      <span className="text-xs font-medium">
                        Cursor Interactions
                      </span>
                      <IconChevronRight className="w-3 h-3 ml-auto group-open:rotate-90 transition-transform text-muted-foreground" />
                    </div>
                  </summary>
                  <div className="mt-1">
                    <SafeBoundary>
                      <CurrentElementPanel />
                    </SafeBoundary>
                  </div>
                </details>

                {/* Text Animations Section - Only for CreateProjectPrompt */}
                {selectedComponent.id === "create-project-prompt" && (
                  <details className="group" open>
                    <summary className="cursor-pointer list-none">
                      <div className="flex items-center gap-2 p-2 rounded hover:bg-secondary/50 transition-colors">
                        <IconFileText className="w-3.5 h-3.5 text-purple-400" />
                        <span className="text-xs font-medium">
                          Text Animations
                        </span>
                        <IconChevronRight className="w-3 h-3 ml-auto group-open:rotate-90 transition-transform text-muted-foreground" />
                      </div>
                    </summary>
                    <div className="mt-1 px-4 py-3 space-y-3 bg-secondary/20">
                      <div className="px-4 py-3 bg-purple-500/10 rounded-lg border border-purple-500/20">
                        <div className="flex items-start gap-2">
                          <IconInfoCircle className="w-4 h-4 text-purple-400 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-xs font-medium text-purple-200 mb-1">
                              Interactive Text Input
                            </p>
                            <p className="text-xs text-purple-300/80">
                              Type in the "Ask Builder" textarea below. The send
                              button will light up blue when text is entered.
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">
                          This component is now fully interactive:
                        </p>
                        <ul className="text-xs text-muted-foreground space-y-1 ml-4 list-disc">
                          <li>
                            Type in the textarea to see the blue send button
                          </li>
                          <li>Click the send button to clear the text</li>
                          <li>
                            Hover over the button to see the grow/brightness
                            effect
                          </li>
                        </ul>
                      </div>
                    </div>
                  </details>
                )}

                {/* Component Props Section */}
                <details className="group" open={openSections.props}>
                  <summary
                    className="cursor-pointer list-none"
                    onClick={(e) => {
                      e.preventDefault();
                      toggleSection("props");
                    }}
                  >
                    <div className="flex items-center gap-2 p-2 rounded hover:bg-secondary/50 transition-colors">
                      <IconFileText className="w-3.5 h-3.5 text-blue-400" />
                      <span className="text-xs font-medium">
                        Component Props
                      </span>
                      <IconChevronRight className="w-3 h-3 ml-auto group-open:rotate-90 transition-transform text-muted-foreground" />
                    </div>
                  </summary>

                  {openSections.props && (
                    <div className="mt-1 px-4 py-3 space-y-4 bg-secondary/20">
                      {/* Preview Notice */}
                      <div className="px-4 py-3 bg-muted/30 rounded-lg border border-dashed border-border">
                        <p className="text-xs text-muted-foreground">
                          Changes are for preview only and won't be saved
                        </p>
                      </div>

                      {selectedComponent.propTypes.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          No configurable props
                        </p>
                      ) : (
                        selectedComponent.propTypes.map((prop) => {
                          const isColorProp = prop.name
                            .toLowerCase()
                            .includes("color");
                          const isLongText = prop.name
                            .toLowerCase()
                            .includes("description");
                          const currentValue =
                            propValues[prop.name] ?? prop.defaultValue;

                          return (
                            <div key={prop.name} className="space-y-1.5">
                              <div className="flex items-baseline justify-between gap-2">
                                <label
                                  className="text-sm font-medium"
                                  htmlFor={`prop-${prop.name}`}
                                >
                                  {prop.name}
                                </label>
                                <span className="text-xs text-muted-foreground font-mono">
                                  {prop.type}
                                </span>
                              </div>

                              {prop.description && (
                                <p className="text-xs text-muted-foreground">
                                  {prop.description}
                                </p>
                              )}

                              {/* Input based on prop type */}
                              {isColorProp ? (
                                <div className="flex items-center gap-2">
                                  <div className="h-5 w-5 rounded-full border border-border overflow-hidden flex-shrink-0">
                                    <input
                                      id={`prop-${prop.name}`}
                                      type="color"
                                      value={currentValue}
                                      onChange={(e) =>
                                        onPropChange(prop.name, e.target.value)
                                      }
                                      className="cursor-pointer border-none"
                                      style={{
                                        width: "200%",
                                        height: "200%",
                                        marginLeft: "-50%",
                                        marginTop: "-50%",
                                      }}
                                    />
                                  </div>
                                  <Input
                                    type="text"
                                    value={currentValue}
                                    onChange={(e) =>
                                      onPropChange(prop.name, e.target.value)
                                    }
                                    className="flex-1 h-9 px-3 text-xs"
                                    placeholder={String(prop.defaultValue)}
                                  />
                                </div>
                              ) : isLongText ? (
                                <Textarea
                                  id={`prop-${prop.name}`}
                                  value={currentValue}
                                  onChange={(e) =>
                                    onPropChange(prop.name, e.target.value)
                                  }
                                  rows={3}
                                  className="w-full px-3 py-2 text-xs resize-none"
                                  placeholder={String(prop.defaultValue)}
                                />
                              ) : (
                                <Input
                                  id={`prop-${prop.name}`}
                                  type="text"
                                  value={currentValue}
                                  onChange={(e) =>
                                    onPropChange(prop.name, e.target.value)
                                  }
                                  className="w-full h-9 px-3 text-xs"
                                  placeholder={String(prop.defaultValue)}
                                />
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </details>

                {/* Component IconInfoCircle */}
                <details className="group">
                  <summary className="cursor-pointer list-none">
                    <div className="flex items-center gap-2 p-2 rounded hover:bg-secondary/50 transition-colors">
                      <IconInfoCircle className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-xs font-medium">
                        Component IconInfoCircle
                      </span>
                      <IconChevronRight className="w-3 h-3 ml-auto group-open:rotate-90 transition-transform text-muted-foreground" />
                    </div>
                  </summary>
                  <div className="mt-1 px-4 py-3 space-y-3 text-xs text-muted-foreground">
                    <div>
                      <div className="font-medium text-foreground mb-1">
                        Dimensions
                      </div>
                      <div>
                        {selectedComponent.width} × {selectedComponent.height}px
                      </div>
                    </div>

                    <div>
                      <div className="font-medium text-foreground mb-1">
                        Duration
                      </div>
                      <div>
                        {selectedComponent.durationInFrames} frames @{" "}
                        {selectedComponent.fps}fps (
                        {(
                          selectedComponent.durationInFrames /
                          selectedComponent.fps
                        ).toFixed(1)}
                        s)
                      </div>
                    </div>

                    <div>
                      <div className="font-medium text-foreground mb-1">
                        Component ID
                      </div>
                      <code className="px-1.5 py-0.5 bg-secondary rounded font-mono">
                        {selectedComponent.id}
                      </code>
                    </div>
                  </div>
                </details>
              </>
            ) : (
              <div className="h-full flex items-center justify-center p-4">
                <p className="text-sm text-muted-foreground text-center">
                  Select a component to view its properties
                </p>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
