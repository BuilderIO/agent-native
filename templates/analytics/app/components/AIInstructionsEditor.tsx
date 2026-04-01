import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  IconDeviceFloppy,
  IconX,
  IconCircleCheck,
  IconAlertCircle,
  IconPlus,
  IconTrash,
  IconCode,
  IconFileText,
  IconChevronDown,
  IconChevronRight,
} from "@tabler/icons-react";
import { getIdToken } from "@/lib/auth";
import { toast } from "sonner";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface InstructionContent {
  content: string;
  path: string;
}

interface TableMapping {
  useCase: string;
  table: string;
  keyColumns: string;
  notes: string;
}

async function fetchInstructionContent(
  path: string,
): Promise<InstructionContent> {
  const response = await fetch(
    `/api/ai-instructions/get?path=${encodeURIComponent(path)}`,
  );

  if (!response.ok) {
    throw new Error("Failed to fetch instruction content");
  }

  return response.json();
}

async function saveInstructionContent(
  path: string,
  content: string,
): Promise<void> {
  const token = await getIdToken();
  const response = await fetch("/api/ai-instructions/save", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ path, content }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to save instruction");
  }
}

async function checkCanEdit(): Promise<{ canEdit: boolean; email: string }> {
  const token = await getIdToken();
  const response = await fetch("/api/ai-instructions/can-edit", {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!response.ok) {
    return { canEdit: false, email: "" };
  }

  return response.json();
}

function parseTableMappings(content: string): TableMapping[] {
  const mappings: TableMapping[] = [];

  // Find the General Table Usage Guidelines section
  const guidelineMatch = content.match(
    /## General Table Usage Guidelines\n\n\*\*Always use these canonical tables.*?\n\n([\s\S]*?)(?=\n\*\*Schema preferences|\n##|$)/,
  );

  if (!guidelineMatch) return mappings;

  const tableSection = guidelineMatch[1];
  const rows = tableSection
    .split("\n")
    .filter(
      (row) =>
        row.trim() && !row.includes("|---|") && !row.includes("Use Case |"),
    );

  for (const row of rows) {
    const parts = row
      .split("|")
      .map((p) => p.trim())
      .filter((p) => p);
    if (parts.length === 4) {
      mappings.push({
        useCase: parts[0],
        table: parts[1],
        keyColumns: parts[2],
        notes: parts[3],
      });
    }
  }

  return mappings;
}

function generateTableMappingsMarkdown(mappings: TableMapping[]): string {
  if (mappings.length === 0) return "";

  let markdown =
    "## General Table Usage Guidelines\n\n**Always use these canonical tables for specific use cases:**\n\n";
  markdown += "| Use Case | Table to Use | Key Columns | Notes |\n";
  markdown += "|---|---|---|---|\n";

  for (const mapping of mappings) {
    markdown += `| ${mapping.useCase} | \`${mapping.table}\` | ${mapping.keyColumns} | ${mapping.notes} |\n`;
  }

  markdown += "\n**Schema preferences:**\n";
  markdown +=
    "- Use `dbt_mart.*` for business-level queries (deals, contracts, subscriptions, customers)\n";
  markdown +=
    "- Use `dbt_staging_bigquery.*` for raw event data (pageviews, signups)\n";
  markdown += "- Use `dbt_analytics.*` for reporting views\n";
  markdown +=
    "- **Avoid `dbt_dev.*`** - development schema excluded globally\n\n";

  return markdown;
}

export function AIInstructionsEditor() {
  const [editedContent, setEditedContent] = useState<string>("");
  const [hasChanges, setHasChanges] = useState(false);
  const [viewMode, setViewMode] = useState<"structured" | "raw">("structured");
  const [tableMappings, setTableMappings] = useState<TableMapping[]>([]);
  const [isGuidelinesOpen, setIsGuidelinesOpen] = useState(true);
  const [isTableMapOpen, setIsTableMapOpen] = useState(false);
  const queryClient = useQueryClient();

  const bigqueryPath = ".builder/skills/bigquery/SKILL.md";

  // Check if user can edit
  const { data: permissionData } = useQuery({
    queryKey: ["ai-instructions-can-edit"],
    queryFn: checkCanEdit,
  });

  const canEdit = permissionData?.canEdit ?? false;

  const { data: contentData, isLoading: isLoadingContent } =
    useQuery<InstructionContent>({
      queryKey: ["ai-instruction-content", bigqueryPath],
      queryFn: () => fetchInstructionContent(bigqueryPath),
    });

  useEffect(() => {
    if (contentData) {
      setEditedContent(contentData.content);
      setTableMappings(parseTableMappings(contentData.content));
      setHasChanges(false);
    }
  }, [contentData]);

  const saveMutation = useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      saveInstructionContent(path, content),
    onSuccess: () => {
      toast.success("BigQuery instructions saved successfully");
      setHasChanges(false);
      queryClient.invalidateQueries({
        queryKey: ["ai-instruction-content", bigqueryPath],
      });
    },
    onError: (error: Error) => {
      toast.error(`Failed to save: ${error.message}`);
    },
  });

  const handleContentChange = (value: string) => {
    setEditedContent(value);
    setHasChanges(value !== contentData?.content);
  };

  const handleSave = () => {
    if (viewMode === "structured") {
      // Rebuild content with updated table mappings
      const newGuidelines = generateTableMappingsMarkdown(tableMappings);

      // Replace the guidelines section in the content
      const contentWithoutGuidelines = editedContent.replace(
        /## General Table Usage Guidelines[\s\S]*?(?=\n## Table Map|$)/,
        newGuidelines,
      );

      saveMutation.mutate({
        path: bigqueryPath,
        content: contentWithoutGuidelines,
      });
    } else {
      saveMutation.mutate({ path: bigqueryPath, content: editedContent });
    }
  };

  const handleCancel = () => {
    if (contentData) {
      setEditedContent(contentData.content);
      setTableMappings(parseTableMappings(contentData.content));
      setHasChanges(false);
    }
  };

  const handleAddMapping = () => {
    setTableMappings([
      ...tableMappings,
      { useCase: "", table: "", keyColumns: "", notes: "" },
    ]);
    setHasChanges(true);
  };

  const handleUpdateMapping = (
    index: number,
    field: keyof TableMapping,
    value: string,
  ) => {
    const updated = [...tableMappings];
    updated[index][field] = value;
    setTableMappings(updated);
    setHasChanges(true);
  };

  const handleRemoveMapping = (index: number) => {
    setTableMappings(tableMappings.filter((_, i) => i !== index));
    setHasChanges(true);
  };

  if (isLoadingContent) {
    return <div className="h-[700px] bg-muted animate-pulse rounded-lg" />;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">BigQuery Instructions</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Guidelines for table usage, SQL patterns, and data structure
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!canEdit && (
            <Badge variant="secondary" className="gap-1">
              <IconAlertCircle className="h-3 w-3" />
              Read-only
            </Badge>
          )}
          {canEdit && hasChanges && (
            <Badge variant="outline" className="gap-1">
              <IconAlertCircle className="h-3 w-3" />
              Unsaved changes
            </Badge>
          )}
          <div className="flex rounded-md border border-border">
            <Button
              variant={viewMode === "structured" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("structured")}
              className="rounded-r-none h-8"
            >
              <IconFileText className="h-3.5 w-3.5 mr-1.5" />
              Structured
            </Button>
            <Button
              variant={viewMode === "raw" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("raw")}
              className="rounded-l-none h-8"
            >
              <IconCode className="h-3.5 w-3.5 mr-1.5" />
              Raw Markdown
            </Button>
          </div>
        </div>
      </div>

      {/* Structured View */}
      {viewMode === "structured" ? (
        <div className="space-y-4">
          {/* Table Usage Guidelines Section */}
          <Collapsible
            open={isGuidelinesOpen}
            onOpenChange={setIsGuidelinesOpen}
          >
            <Card>
              <CollapsibleTrigger className="w-full">
                <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">
                      Table Usage Guidelines
                    </CardTitle>
                    {isGuidelinesOpen ? (
                      <IconChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <IconChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                      Define which tables to use for specific use cases
                    </p>
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleAddMapping}
                      >
                        <IconPlus className="h-3.5 w-3.5 mr-1.5" />
                        Add Mapping
                      </Button>
                    )}
                  </div>

                  <div className="space-y-3">
                    {tableMappings.map((mapping, index) => (
                      <Card key={index} className="border-muted">
                        <CardContent className="pt-4 space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                                Use Case
                              </label>
                              <Input
                                value={mapping.useCase}
                                onChange={(e) =>
                                  handleUpdateMapping(
                                    index,
                                    "useCase",
                                    e.target.value,
                                  )
                                }
                                placeholder="e.g., Customer contracts"
                                className="h-9 text-sm"
                                disabled={!canEdit}
                              />
                            </div>
                            <div>
                              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                                Table Name
                              </label>
                              <Input
                                value={mapping.table}
                                onChange={(e) =>
                                  handleUpdateMapping(
                                    index,
                                    "table",
                                    e.target.value,
                                  )
                                }
                                placeholder="e.g., dbt_mart.dim_contracts"
                                className="h-9 text-sm font-mono"
                                disabled={!canEdit}
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                                Key Columns
                              </label>
                              <Input
                                value={mapping.keyColumns}
                                onChange={(e) =>
                                  handleUpdateMapping(
                                    index,
                                    "keyColumns",
                                    e.target.value,
                                  )
                                }
                                placeholder="e.g., contract_id, company_id, start_date"
                                className="h-9 text-sm"
                                disabled={!canEdit}
                              />
                            </div>
                            <div className="flex gap-2">
                              <div className="flex-1">
                                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                                  Notes
                                </label>
                                <Input
                                  value={mapping.notes}
                                  onChange={(e) =>
                                    handleUpdateMapping(
                                      index,
                                      "notes",
                                      e.target.value,
                                    )
                                  }
                                  placeholder="e.g., Canonical source for all contract data"
                                  className="h-9 text-sm"
                                  disabled={!canEdit}
                                />
                              </div>
                              {canEdit && (
                                <div className="flex items-end">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleRemoveMapping(index)}
                                    className="h-9 w-9 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                                  >
                                    <IconTrash className="h-4 w-4" />
                                  </Button>
                                </div>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}

                    {tableMappings.length === 0 && (
                      <div className="text-center py-8 text-muted-foreground text-sm">
                        No table mappings defined yet. Click "Add Mapping" to
                        create one.
                      </div>
                    )}
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* Complete Documentation Section */}
          <Collapsible open={isTableMapOpen} onOpenChange={setIsTableMapOpen}>
            <Card>
              <CollapsibleTrigger className="w-full">
                <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base">
                        Complete Documentation
                      </CardTitle>
                      <p className="text-xs text-muted-foreground mt-1">
                        Full SKILL.md content including table map, SQL patterns,
                        and gotchas
                      </p>
                    </div>
                    {isTableMapOpen ? (
                      <IconChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <IconChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="p-0">
                  <Textarea
                    value={editedContent}
                    onChange={(e) => handleContentChange(e.target.value)}
                    className="min-h-[500px] font-mono text-sm border-0 rounded-none resize-none focus-visible:ring-0 p-6"
                    placeholder="# Full markdown content..."
                    disabled={!canEdit}
                  />
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </div>
      ) : (
        /* Raw Markdown View */
        <Card>
          <CardContent className="p-0">
            <Textarea
              value={editedContent}
              onChange={(e) => handleContentChange(e.target.value)}
              className="min-h-[700px] font-mono text-sm border-0 rounded-t-lg resize-none focus-visible:ring-0 p-6"
              placeholder="# BigQuery Instructions..."
              disabled={!canEdit}
            />
          </CardContent>
        </Card>
      )}

      {/* IconDeviceFloppy Bar */}
      {canEdit && (
        <div className="border-t pt-4 flex items-center justify-between gap-3 sticky bottom-0 bg-background pb-4">
          <p className="text-xs text-muted-foreground">
            Changes are saved to{" "}
            <code className="bg-muted px-1.5 py-0.5 rounded">
              {bigqueryPath}
            </code>
          </p>
          <div className="flex items-center gap-2">
            {hasChanges && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancel}
                disabled={saveMutation.isPending}
              >
                <IconX className="h-3.5 w-3.5 mr-1.5" />
                Cancel
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!hasChanges || saveMutation.isPending}
            >
              {saveMutation.isPending ? (
                <>Saving...</>
              ) : (
                <>
                  {hasChanges ? (
                    <IconDeviceFloppy className="h-3.5 w-3.5 mr-1.5" />
                  ) : (
                    <IconCircleCheck className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  {hasChanges ? "IconDeviceFloppy Changes" : "Saved"}
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {!canEdit && (
        <div className="border-t pt-4 bg-background pb-4">
          <p className="text-xs text-muted-foreground text-center">
            You don't have permission to edit AI instructions. Contact an admin
            or analytics team member for access.
          </p>
        </div>
      )}
    </div>
  );
}
