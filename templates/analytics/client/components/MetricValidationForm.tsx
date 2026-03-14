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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, AlertCircle, XCircle, AlertTriangle } from "lucide-react";
import { getIdToken } from "@/lib/auth";
import { toast } from "sonner";

interface MetricValidationFormProps {
  metricName: string;
  metricId?: string; // Optional - if not in data dictionary
  metricValue?: number | string | null; // Actual value shown
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const issueTagsOptions = [
  { value: "data_stale", label: "Data looks stale" },
  { value: "wrong_values", label: "Wrong values" },
  { value: "missing_data", label: "Missing data" },
  { value: "confusing_definition", label: "Confusing definition" },
];

export function MetricValidationForm({
  metricName,
  metricId,
  metricValue,
  isOpen,
  onClose,
  onSuccess,
}: MetricValidationFormProps) {
  const [rating, setRating] = useState<"accurate" | "mostly_accurate" | "needs_review" | "">("");
  const [comment, setComment] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // For new metrics not in dictionary
  const [inputMetricName, setInputMetricName] = useState(metricName);
  const [metricDefinition, setMetricDefinition] = useState("");
  const [metricTable, setMetricTable] = useState("");
  const [shouldAddToDictionary, setShouldAddToDictionary] = useState(!metricName); // Auto-check if empty

  const isNewMetric = !metricId;
  const needsMetricName = !metricName; // User needs to type metric name
  const isSuggestingNewMetric = needsMetricName; // Simplified mode for new metric suggestions

  const toggleTag = (tag: string) => {
    setTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleSubmit = async () => {
    // For new metric suggestions, we don't require a rating
    if (!isSuggestingNewMetric && !rating) return;

    setIsSubmitting(true);

    try {
      const token = await getIdToken();

      // Submit validation
      const finalMetricName = inputMetricName || metricName;

      const response = await fetch("/api/gamification/validate-metric", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          metricId: metricId || `new_${finalMetricName.toLowerCase().replace(/\s+/g, '_')}`,
          metricName: finalMetricName,
          rating: isSuggestingNewMetric ? "accurate" : rating, // Default to accurate for suggestions
          comment,
          tags,
          metricValue,
          isNewMetric,
          ...(isSuggestingNewMetric || (isNewMetric && shouldAddToDictionary) ? {
            suggestedDefinition: metricDefinition,
            suggestedTable: metricTable,
          } : {}),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to submit validation");
      }

      const data = await response.json();
      const points = data.points || 2;

      if (isSuggestingNewMetric || (isNewMetric && shouldAddToDictionary)) {
        toast.success(`+${points} points! Metric suggestion captured!`, {
          description: `The analytics team will review and add "${finalMetricName}" to the dictionary.`,
          duration: 5000,
        });
      } else {
        toast.success(`+${points} points! Thanks for validating!`, {
          description: `Your feedback helps keep our metrics accurate.`,
        });
      }

      // Reset form
      setRating("");
      setComment("");
      setTags([]);
      setMetricDefinition("");
      setMetricTable("");
      setShouldAddToDictionary(false);

      onSuccess?.();
      onClose();
    } catch (error) {
      console.error("Error submitting validation:", error);
      toast.error("Failed to submit validation", {
        description: "Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const expectedPoints = rating === "needs_review" ? 5 : rating === "mostly_accurate" ? 3 : 2;
  const bonusPoints = comment.trim() ? 2 : 0;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {needsMetricName ? "Suggest New Metric" : `Validate: ${metricName}`}
          </DialogTitle>
          <DialogDescription>
            {needsMetricName
              ? "Help improve the Data Dictionary by adding a new metric definition."
              : "Review the data and let us know if it looks accurate. Your feedback helps improve data quality."
            }
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {isSuggestingNewMetric ? (
            /* Simplified form for suggesting new metrics */
            <>
              {/* Metric Name */}
              <div className="space-y-2">
                <Label htmlFor="new-metric-name" className="text-sm font-medium">
                  Metric Name *
                </Label>
                <Input
                  id="new-metric-name"
                  value={inputMetricName}
                  onChange={(e) => setInputMetricName(e.target.value)}
                  placeholder="e.g., First Prompt Negative Rate"
                  className="text-sm"
                />
              </div>

              {/* Definition */}
              <div className="space-y-2">
                <Label htmlFor="metric-definition" className="text-sm font-medium">
                  Definition *
                </Label>
                <Textarea
                  id="metric-definition"
                  value={metricDefinition}
                  onChange={(e) => setMetricDefinition(e.target.value)}
                  placeholder="What does this metric measure? e.g., Number of active user sessions in the last 7 days"
                  rows={3}
                  className="text-sm"
                />
              </div>

              {/* Additional Details (optional) */}
              <div className="space-y-2">
                <Label htmlFor="comment" className="text-sm font-medium">
                  Additional Details (optional)
                </Label>
                <Textarea
                  id="comment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Any additional context, calculation details, or data sources..."
                  rows={3}
                  className="resize-none text-sm"
                />
              </div>
            </>
          ) : (
            /* Existing validation form for known metrics */
            <>
              {/* Metric Name Input (for new suggestions without pre-filled name) */}
              {needsMetricName && (
                <div className="space-y-2">
                  <Label htmlFor="new-metric-name" className="text-sm font-medium">
                    Metric Name *
                  </Label>
                  <Input
                    id="new-metric-name"
                    value={inputMetricName}
                    onChange={(e) => setInputMetricName(e.target.value)}
                    placeholder="e.g., First Prompt Negative Rate"
                    className="text-sm"
                  />
                </div>
              )}

              {/* New Metric Alert */}
              {isNewMetric && (
                <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg space-y-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-5 w-5 text-blue-500 mt-0.5" />
                    <div className="space-y-1 flex-1">
                      <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
                        New Metric - Not in Data Dictionary
                      </p>
                      <p className="text-xs text-muted-foreground">
                        This metric isn't documented yet. You can still validate it and optionally help add it to the dictionary!
                      </p>
                      {metricValue !== null && metricValue !== undefined && (
                        <div className="mt-2 p-2 bg-background/50 rounded border border-border">
                          <span className="text-xs text-muted-foreground">Current value: </span>
                          <span className="text-sm font-mono font-bold">
                            {typeof metricValue === 'number' ? metricValue.toLocaleString() : metricValue}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="add-to-dictionary"
                      checked={shouldAddToDictionary}
                      onChange={(e) => setShouldAddToDictionary(e.target.checked)}
                      className="rounded border-border"
                    />
                    <Label htmlFor="add-to-dictionary" className="text-sm cursor-pointer">
                      Help add this metric to the Data Dictionary (+5 bonus points)
                    </Label>
                  </div>

                  {shouldAddToDictionary && (
                    <div className="space-y-3 pt-2 border-t border-blue-500/20">
                      <div className="space-y-1.5">
                        <Label htmlFor="metric-definition" className="text-xs">
                          What does this metric measure? *
                        </Label>
                        <Textarea
                          id="metric-definition"
                          value={metricDefinition}
                          onChange={(e) => setMetricDefinition(e.target.value)}
                          placeholder="e.g., Number of active user sessions in the last 7 days"
                          rows={2}
                          className="text-sm"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="metric-table" className="text-xs">
                          Where does this data come from? (optional)
                        </Label>
                        <input
                          id="metric-table"
                          type="text"
                          value={metricTable}
                          onChange={(e) => setMetricTable(e.target.value)}
                          placeholder="e.g., dbt_mart.user_sessions"
                          className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
              {/* Rating Selection */}
              <div className="space-y-3">
                <Label className="text-base">How accurate is this data?</Label>
                <RadioGroup value={rating} onValueChange={(v) => setRating(v as any)}>
                  <div className="flex items-center space-x-3 p-3 rounded-lg border border-border hover:bg-muted/50 cursor-pointer">
                    <RadioGroupItem value="accurate" id="accurate" />
                    <Label htmlFor="accurate" className="flex items-center gap-2 cursor-pointer flex-1">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      <div>
                        <p className="font-medium">Accurate</p>
                        <p className="text-xs text-muted-foreground">Data looks correct</p>
                      </div>
                    </Label>
                    <Badge variant="secondary" className="text-xs">+{2 + bonusPoints} pts</Badge>
                  </div>

                  <div className="flex items-center space-x-3 p-3 rounded-lg border border-border hover:bg-muted/50 cursor-pointer">
                    <RadioGroupItem value="mostly_accurate" id="mostly_accurate" />
                    <Label
                      htmlFor="mostly_accurate"
                      className="flex items-center gap-2 cursor-pointer flex-1"
                    >
                      <AlertCircle className="h-4 w-4 text-yellow-500" />
                      <div>
                        <p className="font-medium">Mostly Accurate</p>
                        <p className="text-xs text-muted-foreground">Minor issues</p>
                      </div>
                    </Label>
                    <Badge variant="secondary" className="text-xs">+{3 + bonusPoints} pts</Badge>
                  </div>

                  <div className="flex items-center space-x-3 p-3 rounded-lg border border-border hover:bg-muted/50 cursor-pointer">
                    <RadioGroupItem value="needs_review" id="needs_review" />
                    <Label htmlFor="needs_review" className="flex items-center gap-2 cursor-pointer flex-1">
                      <XCircle className="h-4 w-4 text-red-500" />
                      <div>
                        <p className="font-medium">Needs Review</p>
                        <p className="text-xs text-muted-foreground">Data is incorrect</p>
                      </div>
                    </Label>
                    <Badge variant="secondary" className="text-xs">+{5 + bonusPoints} pts</Badge>
                  </div>
                </RadioGroup>
              </div>

              {/* Issue Tags (if needs review) */}
              {rating === "needs_review" && (
                <div className="space-y-2 p-4 bg-red-500/5 border border-red-500/20 rounded-lg">
                  <div className="flex items-center gap-2 text-sm font-medium text-red-600 dark:text-red-400">
                    <AlertTriangle className="h-4 w-4" />
                    <span>What's wrong? (select all that apply)</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {issueTagsOptions.map((tag) => (
                      <Badge
                        key={tag.value}
                        variant={tags.includes(tag.value) ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => toggleTag(tag.value)}
                      >
                        {tag.label}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Optional Comment */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="comment">Additional details (optional)</Label>
                  {comment.trim() && (
                    <Badge variant="secondary" className="text-xs">+2 pts for comment</Badge>
                  )}
                </div>
                <Textarea
                  id="comment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Describe what you noticed..."
                  rows={3}
                  className="resize-none"
                />
              </div>

              {/* Points Preview */}
              {rating && (
                <div className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg">
                  <span className="text-sm font-medium">You'll earn:</span>
                  <span className="text-lg font-bold text-primary">
                    +{expectedPoints + bonusPoints} points
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              isSubmitting ||
              (isSuggestingNewMetric
                ? !inputMetricName.trim() || !metricDefinition.trim()
                : !rating || (needsMetricName && !inputMetricName.trim()) || (shouldAddToDictionary && !metricDefinition.trim())
              )
            }
          >
            {isSubmitting ? "Submitting..." : isSuggestingNewMetric ? "Submit Suggestion" : "Submit Validation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
