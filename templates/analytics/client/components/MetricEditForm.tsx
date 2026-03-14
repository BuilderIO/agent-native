import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getIdToken } from "@/lib/auth";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface MetricEditFormProps {
  entry: {
    id: string;
    Metric: string;
    Definition: string;
    Table: string;
    Department: string;
    Owner: string;
    QueryTemplate: string;
    ExampleOutput: string;
    ColumnsUsed: string;
    JoinPattern: string;
    UpdateFrequency: string;
    DataLag: string;
    Dependencies: string;
    ValidDateRange: string;
    CommonQuestions: string;
    KnownGotchas: string;
    ExampleUseCase: string;
  };
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function MetricEditForm({ entry, isOpen, onClose, onSuccess }: MetricEditFormProps) {
  const [formData, setFormData] = useState({
    Definition: entry.Definition || "",
    Table: entry.Table || "",
    Department: entry.Department || "",
    Owner: entry.Owner || "",
    QueryTemplate: entry.QueryTemplate || "",
    ExampleOutput: entry.ExampleOutput || "",
    ColumnsUsed: entry.ColumnsUsed || "",
    JoinPattern: entry.JoinPattern || "",
    UpdateFrequency: entry.UpdateFrequency || "",
    DataLag: entry.DataLag || "",
    Dependencies: entry.Dependencies || "",
    ValidDateRange: entry.ValidDateRange || "",
    CommonQuestions: entry.CommonQuestions || "",
    KnownGotchas: entry.KnownGotchas || "",
    ExampleUseCase: entry.ExampleUseCase || "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    setIsSubmitting(true);

    try {
      const token = await getIdToken();

      // Only send fields that have changed
      const updates: Record<string, string> = {};
      Object.entries(formData).forEach(([key, value]) => {
        if (value !== (entry as any)[key]) {
          updates[key] = value;
        }
      });

      if (Object.keys(updates).length === 0) {
        toast.info("No changes to save");
        onClose();
        return;
      }

      const response = await fetch("/api/data-dictionary/update-entry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({
          pageId: entry.id,
          updates,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to update metric");
      }

      toast.success("Metric updated successfully!", {
        description: "Changes saved to Notion and synced to local dictionary.",
      });

      onSuccess?.();
      onClose();
    } catch (error) {
      console.error("Error updating metric:", error);
      toast.error("Failed to update metric", {
        description: "Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit: {entry.Metric}</DialogTitle>
          <DialogDescription>
            Update the metric definition, query templates, and guidance.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="basic" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="basic">Basic Info</TabsTrigger>
            <TabsTrigger value="technical">Technical</TabsTrigger>
            <TabsTrigger value="guidance">Guidance</TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="definition">Definition *</Label>
              <Textarea
                id="definition"
                value={formData.Definition}
                onChange={(e) => setFormData({ ...formData, Definition: e.target.value })}
                rows={3}
                className="text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="table">Table Source</Label>
                <Input
                  id="table"
                  value={formData.Table}
                  onChange={(e) => setFormData({ ...formData, Table: e.target.value })}
                  className="text-sm font-mono"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="columns">Columns Used</Label>
                <Input
                  id="columns"
                  value={formData.ColumnsUsed}
                  onChange={(e) => setFormData({ ...formData, ColumnsUsed: e.target.value })}
                  className="text-sm font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="department">Department</Label>
                <Input
                  id="department"
                  value={formData.Department}
                  onChange={(e) => setFormData({ ...formData, Department: e.target.value })}
                  className="text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="owner">Owner</Label>
                <Input
                  id="owner"
                  value={formData.Owner}
                  onChange={(e) => setFormData({ ...formData, Owner: e.target.value })}
                  className="text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="update-freq">Update Frequency</Label>
                <Input
                  id="update-freq"
                  value={formData.UpdateFrequency}
                  onChange={(e) => setFormData({ ...formData, UpdateFrequency: e.target.value })}
                  className="text-sm"
                  placeholder="e.g., Daily, Hourly"
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="technical" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="query-template">Query Template</Label>
              <Textarea
                id="query-template"
                value={formData.QueryTemplate}
                onChange={(e) => setFormData({ ...formData, QueryTemplate: e.target.value })}
                rows={8}
                className="text-sm font-mono"
                placeholder="SELECT ..."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="join-pattern">Join Pattern</Label>
              <Textarea
                id="join-pattern"
                value={formData.JoinPattern}
                onChange={(e) => setFormData({ ...formData, JoinPattern: e.target.value })}
                rows={4}
                className="text-sm font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="data-lag">Data Lag</Label>
                <Input
                  id="data-lag"
                  value={formData.DataLag}
                  onChange={(e) => setFormData({ ...formData, DataLag: e.target.value })}
                  className="text-sm"
                  placeholder="e.g., 1-2 hours"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="valid-range">Valid Date Range</Label>
                <Input
                  id="valid-range"
                  value={formData.ValidDateRange}
                  onChange={(e) => setFormData({ ...formData, ValidDateRange: e.target.value })}
                  className="text-sm"
                  placeholder="e.g., 2020-01-01 onwards"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dependencies">Dependencies</Label>
              <Textarea
                id="dependencies"
                value={formData.Dependencies}
                onChange={(e) => setFormData({ ...formData, Dependencies: e.target.value })}
                rows={2}
                className="text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="example-output">Example Output</Label>
              <Textarea
                id="example-output"
                value={formData.ExampleOutput}
                onChange={(e) => setFormData({ ...formData, ExampleOutput: e.target.value })}
                rows={4}
                className="text-sm font-mono"
              />
            </div>
          </TabsContent>

          <TabsContent value="guidance" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="use-case">Example Use Case</Label>
              <Textarea
                id="use-case"
                value={formData.ExampleUseCase}
                onChange={(e) => setFormData({ ...formData, ExampleUseCase: e.target.value })}
                rows={3}
                className="text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="common-questions">Common Questions</Label>
              <Textarea
                id="common-questions"
                value={formData.CommonQuestions}
                onChange={(e) => setFormData({ ...formData, CommonQuestions: e.target.value })}
                rows={4}
                className="text-sm"
                placeholder="One question per line"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="gotchas">Known Gotchas</Label>
              <Textarea
                id="gotchas"
                value={formData.KnownGotchas}
                onChange={(e) => setFormData({ ...formData, KnownGotchas: e.target.value })}
                rows={4}
                className="text-sm"
                placeholder="One gotcha per line (will show with ⚠️)"
              />
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !formData.Definition.trim()}>
            {isSubmitting ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
