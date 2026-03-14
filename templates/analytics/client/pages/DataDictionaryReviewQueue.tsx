import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getIdToken } from "@/lib/auth";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle,
  XCircle,
  Edit,
  User,
  Calendar,
  TrendingUp,
  Database,
  MessageSquare,
  ExternalLink,
  FileText,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface MetricSuggestion {
  metricName: string;
  metricValue?: string;
  suggestedBy: string;
  suggestedDefinition: string;
  suggestedTable: string;
  validationRating: string;
  comment: string;
  timestamp: string;
}

interface ReviewQueueResponse {
  suggestions: MetricSuggestion[];
}

async function fetchNewMetrics(): Promise<ReviewQueueResponse> {
  const token = await getIdToken();
  const response = await fetch("/api/gamification/new-metrics", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    throw new Error("Failed to fetch new metrics");
  }

  return response.json();
}

export default function DataDictionaryReviewQueue() {
  const [activeTab, setActiveTab] = useState<
    "pending" | "approved" | "rejected"
  >("pending");
  const [editingMetric, setEditingMetric] = useState<string | null>(null);
  const [editedValues, setEditedValues] = useState<
    Record<string, { definition: string; table: string }>
  >({});
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["review-queue"],
    queryFn: fetchNewMetrics,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const approveMutation = useMutation({
    mutationFn: async ({
      metricName,
      definition,
      table,
    }: {
      metricName: string;
      definition: string;
      table: string;
    }) => {
      const token = await getIdToken();
      const response = await fetch("/api/data-dictionary/approve-suggestion", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({ metricName, definition, table }),
      });

      if (!response.ok) {
        const body = await response
          .json()
          .catch(() => ({ error: "Unknown error" }));
        throw new Error(body.error || "Failed to approve metric");
      }

      return response.json();
    },
    onSuccess: (data, variables) => {
      toast({
        title: "Metric Approved!",
        description: `"${variables.metricName}" has been added to the Data Dictionary.`,
      });
      queryClient.invalidateQueries({ queryKey: ["review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["notion-data-dictionary"] });
      setEditingMetric(null);
      setEditedValues({});
    },
    onError: (error: Error) => {
      toast({
        title: "Approval Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleApprove = (suggestion: MetricSuggestion) => {
    const edited = editedValues[suggestion.metricName];
    approveMutation.mutate({
      metricName: suggestion.metricName,
      definition: edited?.definition || suggestion.suggestedDefinition,
      table: edited?.table || suggestion.suggestedTable,
    });
  };

  const handleEdit = (suggestion: MetricSuggestion) => {
    setEditingMetric(suggestion.metricName);
    setEditedValues({
      ...editedValues,
      [suggestion.metricName]: {
        definition: suggestion.suggestedDefinition,
        table: suggestion.suggestedTable,
      },
    });
  };

  const handleCancelEdit = () => {
    setEditingMetric(null);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

    if (diffHours < 1) return "Just now";
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const pendingSuggestions = data?.suggestions || [];

  if (isLoading) {
    return (
      <Layout>
        <div className="space-y-4">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <Card className="border-destructive/50 bg-destructive/10">
          <CardContent className="pt-6">
            <p className="text-sm text-destructive">
              Failed to load review queue. Please try again later.
            </p>
          </CardContent>
        </Card>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Review Queue</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Review and approve metric definitions from the team
            </p>
          </div>
          <Badge variant="secondary" className="text-lg px-4 py-2">
            {pendingSuggestions.length} Pending
          </Badge>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
          <TabsList>
            <TabsTrigger value="pending">
              Pending
              {pendingSuggestions.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {pendingSuggestions.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="approved">Approved</TabsTrigger>
            <TabsTrigger value="rejected">Rejected</TabsTrigger>
          </TabsList>

          {/* Pending Tab */}
          <TabsContent value="pending" className="mt-4 space-y-4">
            {pendingSuggestions.length === 0 ? (
              <Card>
                <CardContent className="pt-6 text-center py-12">
                  <CheckCircle className="h-12 w-12 mx-auto text-green-500 mb-4" />
                  <p className="text-lg font-medium">All caught up!</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    No pending metric suggestions to review.
                  </p>
                </CardContent>
              </Card>
            ) : (
              pendingSuggestions.map((suggestion) => {
                const isEditing = editingMetric === suggestion.metricName;
                const editedData = editedValues[suggestion.metricName];

                return (
                  <Card
                    key={suggestion.metricName}
                    className="border-orange-500/30"
                  >
                    <CardHeader>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <CardTitle className="flex items-center gap-2">
                            <FileText className="h-5 w-5" />
                            {suggestion.metricName}
                          </CardTitle>
                          <CardDescription className="flex items-center gap-4 mt-2 flex-wrap">
                            <span className="flex items-center gap-1">
                              <User className="h-3.5 w-3.5" />
                              {suggestion.suggestedBy}
                            </span>
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3.5 w-3.5" />
                              {formatDate(suggestion.timestamp)}
                            </span>
                            {suggestion.metricValue && (
                              <span className="flex items-center gap-1">
                                <TrendingUp className="h-3.5 w-3.5" />
                                Value: {suggestion.metricValue}
                              </span>
                            )}
                          </CardDescription>
                        </div>
                        <Badge
                          variant="outline"
                          className={
                            suggestion.validationRating === "accurate"
                              ? "border-green-500 text-green-600 dark:text-green-400"
                              : suggestion.validationRating === "needs_review"
                                ? "border-red-500 text-red-600 dark:text-red-400"
                                : "border-yellow-500 text-yellow-600 dark:text-yellow-400"
                          }
                        >
                          {suggestion.validationRating.replace("_", " ")}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Definition */}
                      <div className="space-y-2">
                        <Label className="flex items-center gap-2 text-sm font-medium">
                          <MessageSquare className="h-4 w-4" />
                          Definition
                        </Label>
                        {isEditing ? (
                          <Textarea
                            value={editedData?.definition || ""}
                            onChange={(e) =>
                              setEditedValues({
                                ...editedValues,
                                [suggestion.metricName]: {
                                  ...editedData,
                                  definition: e.target.value,
                                },
                              })
                            }
                            rows={4}
                            className="text-sm"
                          />
                        ) : (
                          <p className="text-sm text-foreground/90 bg-muted/30 p-3 rounded-md border border-border/50">
                            {suggestion.suggestedDefinition}
                          </p>
                        )}
                      </div>

                      {/* Table */}
                      <div className="space-y-2">
                        <Label className="flex items-center gap-2 text-sm font-medium">
                          <Database className="h-4 w-4" />
                          Table Source
                        </Label>
                        {isEditing ? (
                          <Input
                            value={editedData?.table || ""}
                            onChange={(e) =>
                              setEditedValues({
                                ...editedValues,
                                [suggestion.metricName]: {
                                  ...editedData,
                                  table: e.target.value,
                                },
                              })
                            }
                            className="text-sm font-mono"
                          />
                        ) : (
                          <code className="text-xs bg-muted/30 px-3 py-2 rounded border border-border/50 block">
                            {suggestion.suggestedTable}
                          </code>
                        )}
                      </div>

                      {/* Submitter Comment */}
                      {suggestion.comment && (
                        <div className="space-y-2">
                          <Label className="text-sm font-medium text-muted-foreground">
                            Submitter's Note
                          </Label>
                          <p className="text-sm text-foreground/80 italic bg-muted/20 p-3 rounded-md border-l-2 border-blue-500/30">
                            "{suggestion.comment}"
                          </p>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex items-center gap-2 pt-2 border-t border-border/50">
                        {isEditing ? (
                          <>
                            <Button
                              size="sm"
                              onClick={() => handleApprove(suggestion)}
                              disabled={approveMutation.isPending}
                              className="bg-green-600 hover:bg-green-700"
                            >
                              <CheckCircle className="h-4 w-4 mr-1.5" />
                              Save & Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={handleCancelEdit}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              onClick={() => handleApprove(suggestion)}
                              disabled={approveMutation.isPending}
                              className="bg-green-600 hover:bg-green-700"
                            >
                              <CheckCircle className="h-4 w-4 mr-1.5" />
                              Approve & Add to Notion
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleEdit(suggestion)}
                            >
                              <Edit className="h-4 w-4 mr-1.5" />
                              Edit Definition
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-destructive hover:text-destructive"
                            >
                              <XCircle className="h-4 w-4 mr-1.5" />
                              Reject
                            </Button>
                          </>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </TabsContent>

          {/* Approved Tab */}
          <TabsContent value="approved" className="mt-4">
            <Card>
              <CardContent className="pt-6 text-center py-12">
                <p className="text-sm text-muted-foreground">
                  Approved metrics will be shown here (coming soon)
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Rejected Tab */}
          <TabsContent value="rejected" className="mt-4">
            <Card>
              <CardContent className="pt-6 text-center py-12">
                <p className="text-sm text-muted-foreground">
                  Rejected metrics will be shown here (coming soon)
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
