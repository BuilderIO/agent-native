import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, ExternalLink, Database, Tag, Copy, CheckCheck, Code2, User, Clock, AlertTriangle, HelpCircle, Link2, ShieldCheck, CheckCircle, Inbox, Plus, Pencil, X, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { getIdToken } from "@/lib/auth";
import { PersonaSelectionModal } from "@/components/PersonaSelectionModal";
import { MetricValidationForm } from "@/components/MetricValidationForm";
import { MissingMetricsWidget } from "@/components/MissingMetricsWidget";
import { MetricEditForm } from "@/components/MetricEditForm";
import { AIInstructionsEditor } from "@/components/AIInstructionsEditor";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const NOTION_DATA_DICTIONARY_URL = "https://www.notion.so/31a3d7274be580da9da7cf54909e1b7c";

interface DictionaryEntry {
  id: string;
  Metric: string;
  Definition: string;
  Table: string;
  Cuts: string;
  Department: string;
  url: string;
  // AI/Technical fields
  QueryTemplate: string;
  ExampleOutput: string;
  ColumnsUsed: string;
  JoinPattern: string;
  UpdateFrequency: string;
  DataLag: string;
  Dependencies: string;
  ValidDateRange: string;
  // Business user fields
  CommonQuestions: string;
  KnownGotchas: string;
  ExampleUseCase: string;
  Owner: string;
  // Gamification fields
  ValidationIssues?: number;
  ValidationTrust?: number;
  NeedsTechnicalReview?: boolean;
}

const departmentColors: Record<string, { bg: string; text: string; border: string }> = {
  "Marketing": { bg: "bg-blue-500/10", text: "text-blue-600 dark:text-blue-400", border: "border-blue-500/30" },
  "Sales": { bg: "bg-green-500/10", text: "text-green-600 dark:text-green-400", border: "border-green-500/30" },
  "Product": { bg: "bg-purple-500/10", text: "text-purple-600 dark:text-purple-400", border: "border-purple-500/30" },
  "Finance": { bg: "bg-yellow-500/10", text: "text-yellow-600 dark:text-yellow-400", border: "border-yellow-500/30" },
  "Customer Success": { bg: "bg-orange-500/10", text: "text-orange-600 dark:text-orange-400", border: "border-orange-500/30" },
  "General": { bg: "bg-slate-500/10", text: "text-slate-600 dark:text-slate-400", border: "border-slate-500/30" },
};

const frequencyColors: Record<string, { bg: string; text: string }> = {
  "Real-time": { bg: "bg-blue-500/10", text: "text-blue-600 dark:text-blue-400" },
  "Hourly": { bg: "bg-green-500/10", text: "text-green-600 dark:text-green-400" },
  "Daily": { bg: "bg-yellow-500/10", text: "text-yellow-600 dark:text-yellow-400" },
  "Weekly": { bg: "bg-orange-500/10", text: "text-orange-600 dark:text-orange-400" },
  "Monthly": { bg: "bg-red-500/10", text: "text-red-600 dark:text-red-400" },
};

async function fetchDataDictionary(): Promise<DictionaryEntry[]> {
  const token = await getIdToken();
  const response = await fetch("/api/notion/data-dictionary", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    throw new Error("Failed to fetch data dictionary");
  }

  const data = await response.json();
  return data.entries || [];
}

function CodeBlock({ code, language = "sql" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!code) return null;

  return (
    <div className="relative group">
      <Button
        size="sm"
        variant="ghost"
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={handleCopy}
      >
        {copied ? <CheckCheck className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
      <pre className="bg-muted/50 p-4 rounded-md overflow-x-auto text-xs border border-border">
        <code className="text-foreground/90 font-mono">{code}</code>
      </pre>
    </div>
  );
}

function InfoSection({ icon: Icon, label, children }: { icon: any; label: string; children: React.ReactNode }) {
  if (!children) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
      </div>
      <div className="text-sm text-foreground/90 leading-relaxed pl-5">
        {children}
      </div>
    </div>
  );
}

function MetricDetailDialog({ 
  entry, 
  isOpen, 
  onClose,
  canEdit,
  onEdit,
  onValidate
}: { 
  entry: DictionaryEntry | null;
  isOpen: boolean;
  onClose: () => void;
  canEdit: boolean;
  onEdit: (entry: DictionaryEntry) => void;
  onValidate: (entry: DictionaryEntry) => void;
}) {
  if (!entry) return null;

  const deptColors = entry.Department
    ? (departmentColors[entry.Department] ?? { bg: "bg-slate-500/10", text: "text-slate-500 dark:text-slate-400", border: "border-slate-500/30" })
    : null;

  const freqColors = entry.UpdateFrequency
    ? (frequencyColors[entry.UpdateFrequency] ?? { bg: "bg-slate-500/10", text: "text-slate-500 dark:text-slate-400" })
    : null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl pr-8">{entry.Metric}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 pt-4">
          {/* Badges */}
          <div className="flex items-center gap-2 flex-wrap">
            {entry.ValidationIssues && entry.ValidationIssues > 0 && (
              <Badge variant="destructive" className="animate-pulse">
                <AlertTriangle className="h-3 w-3 mr-1" />
                {entry.ValidationIssues} issue{entry.ValidationIssues > 1 ? "s" : ""}
              </Badge>
            )}
            {entry.ValidationTrust && entry.ValidationTrust > 5 && (
              <Badge variant="outline" className="border-green-500 text-green-600 dark:text-green-400">
                <ShieldCheck className="h-3 w-3 mr-1" />
                {entry.ValidationTrust} validations
              </Badge>
            )}
            {entry.NeedsTechnicalReview && (
              <Badge variant="outline" className="border-purple-500 text-purple-600 dark:text-purple-400">
                <Code2 className="h-3 w-3 mr-1" />
                Needs SQL Template
              </Badge>
            )}
            {entry.Department && deptColors && (
              <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${deptColors.bg} ${deptColors.text} ${deptColors.border}`}>
                <Tag className="h-3 w-3" />
                {entry.Department}
              </div>
            )}
            {entry.UpdateFrequency && freqColors && (
              <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${freqColors.bg} ${freqColors.text}`}>
                <Clock className="h-3 w-3" />
                {entry.UpdateFrequency}
              </div>
            )}
            {entry.Owner && (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-500/10 text-slate-600 dark:text-slate-400">
                <User className="h-3 w-3" />
                {entry.Owner}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onEdit(entry)}
              >
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                Edit
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => onValidate(entry)}
            >
              <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
              Validate
            </Button>
            <a
              href={entry.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-md border border-border hover:bg-muted transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
              View in Notion
            </a>
          </div>

          {/* Definition */}
          {entry.Definition && (
            <div className="bg-muted/50 p-4 rounded-lg border border-border">
              <p className="text-sm text-foreground/90 leading-relaxed">
                {entry.Definition}
              </p>
            </div>
          )}

          {/* Human-Focused Content */}
          <div className="space-y-4 border-l-2 border-blue-500/30 pl-4">
            <div className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">
              For Business Users
            </div>

            {entry.ExampleUseCase && (
              <InfoSection icon={HelpCircle} label="Example Use Case">
                {entry.ExampleUseCase}
              </InfoSection>
            )}

            {entry.CommonQuestions && (
              <InfoSection icon={HelpCircle} label="Common Questions">
                <div className="space-y-2">
                  {entry.CommonQuestions.split('\n').filter(q => q.trim()).map((q, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="text-blue-500 dark:text-blue-400 font-semibold">Q:</span>
                      <span>{q.trim()}</span>
                    </div>
                  ))}
                </div>
              </InfoSection>
            )}

            {entry.KnownGotchas && (
              <InfoSection icon={AlertTriangle} label="Known Gotchas">
                <div className="space-y-1">
                  {entry.KnownGotchas.split('\n').filter(g => g.trim()).map((gotcha, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="text-orange-500 shrink-0">⚠️</span>
                      <span>{gotcha.trim()}</span>
                    </div>
                  ))}
                </div>
              </InfoSection>
            )}
          </div>

          {/* AI/Technical Content */}
          <div className="space-y-4 border-l-2 border-purple-500/30 pl-4">
            <div className="text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wide">
              For AI Agents & Developers
            </div>

            {entry.Table && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Database className="h-3.5 w-3.5" />
                  <span>Table Sources</span>
                </div>
                <code className="text-xs bg-muted/50 px-3 py-1.5 rounded border border-border block break-all">
                  {entry.Table}
                </code>
              </div>
            )}

            {entry.ColumnsUsed && (
              <InfoSection icon={Code2} label="Columns Used">
                <code className="text-xs bg-muted/50 px-3 py-1.5 rounded border border-border block">
                  {entry.ColumnsUsed}
                </code>
              </InfoSection>
            )}

            {entry.QueryTemplate && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Code2 className="h-3.5 w-3.5" />
                  <span>SQL Query Template</span>
                </div>
                <CodeBlock code={entry.QueryTemplate} language="sql" />
              </div>
            )}

            {entry.JoinPattern && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Link2 className="h-3.5 w-3.5" />
                  <span>Join Pattern</span>
                </div>
                <CodeBlock code={entry.JoinPattern} language="sql" />
              </div>
            )}

            {entry.ExampleOutput && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Database className="h-3.5 w-3.5" />
                  <span>Example Output</span>
                </div>
                <CodeBlock code={entry.ExampleOutput} language="text" />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 text-xs">
              {entry.DataLag && (
                <div>
                  <span className="text-muted-foreground font-medium">Data Lag: </span>
                  <span className="text-foreground/90">{entry.DataLag}</span>
                </div>
              )}
              {entry.ValidDateRange && (
                <div>
                  <span className="text-muted-foreground font-medium">Valid Range: </span>
                  <span className="text-foreground/90">{entry.ValidDateRange}</span>
                </div>
              )}
              {entry.Dependencies && (
                <div className="col-span-2">
                  <span className="text-muted-foreground font-medium">Dependencies: </span>
                  <span className="text-foreground/90">{entry.Dependencies}</span>
                </div>
              )}
            </div>
          </div>

          {entry.Cuts && (
            <div className="text-xs pt-2 border-t border-border/50">
              <span className="text-muted-foreground font-medium">Available Cuts: </span>
              <span className="text-foreground/80">{entry.Cuts}</span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function DataDictionary() {
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"all" | "instructions">("all");
  const [selectedDepartment, setSelectedDepartment] = useState<string>("all");
  const [showPersonaModal, setShowPersonaModal] = useState(false);
  const [selectedPersona, setSelectedPersona] = useState<string | null>(null);
  const [validationMetric, setValidationMetric] = useState<{ id: string; name: string } | null>(null);
  const [editingEntry, setEditingEntry] = useState<DictionaryEntry | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<DictionaryEntry | null>(null);
  const [canEdit, setCanEdit] = useState(false);

  const { data: entries = [], isLoading, error, refetch } = useQuery({
    queryKey: ["notion-data-dictionary"],
    queryFn: fetchDataDictionary,
    staleTime: 60 * 1000,
  });

  useEffect(() => {
    async function checkPersona() {
      try {
        const storedPersona = localStorage.getItem("userPersona");
        if (storedPersona) {
          setSelectedPersona(storedPersona);
          return;
        }

        const token = await getIdToken();
        const response = await fetch("/api/gamification/persona", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (response.ok) {
          const data = await response.json();
          if (data.persona) {
            setSelectedPersona(data.persona.persona);
            localStorage.setItem("userPersona", data.persona.persona);
          } else {
            setShowPersonaModal(true);
          }
        } else {
          setShowPersonaModal(true);
        }
      } catch (error) {
        console.error("Error checking persona:", error);
        setShowPersonaModal(true);
      }
    }

    async function checkEditPermission() {
      try {
        const token = await getIdToken();
        const response = await fetch("/api/data-dictionary/can-edit", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (response.ok) {
          const data = await response.json();
          setCanEdit(data.canEdit || false);
        }
      } catch (error) {
        console.error("Error checking edit permission:", error);
      }
    }

    checkPersona();
    checkEditPermission();
  }, []);

  const handlePersonaSelect = (persona: string) => {
    setSelectedPersona(persona);
    setShowPersonaModal(false);
  };

  const handleDefineMetric = (metricName: string) => {
    setValidationMetric({
      id: `new-${Date.now()}`,
      name: metricName,
    });
  };

  const handleSuggestNewMetric = () => {
    setValidationMetric({
      id: `new-${Date.now()}`,
      name: "",
    });
  };

  const filteredEntries = entries.filter((entry) => {
    const searchLower = search.toLowerCase();
    const matchesSearch =
      entry.Metric?.toLowerCase().includes(searchLower) ||
      entry.Definition?.toLowerCase().includes(searchLower) ||
      entry.Table?.toLowerCase().includes(searchLower) ||
      entry.Department?.toLowerCase().includes(searchLower) ||
      entry.QueryTemplate?.toLowerCase().includes(searchLower) ||
      entry.ColumnsUsed?.toLowerCase().includes(searchLower);

    const matchesDepartment =
      selectedDepartment === "all" ||
      entry.Department === selectedDepartment;

    return matchesSearch && matchesDepartment;
  });

  // Group entries by department
  const groupedEntries = filteredEntries.reduce((acc, entry) => {
    const dept = entry.Department || "General";
    if (!acc[dept]) acc[dept] = [];
    acc[dept].push(entry);
    return acc;
  }, {} as Record<string, DictionaryEntry[]>);

  // Get unique departments for filter
  const departments = Array.from(new Set(entries.map(e => e.Department || "General"))).sort();

  return (
    <Layout>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Data Dictionary</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Browse and explore canonical metric definitions
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              className="gap-2"
              onClick={handleSuggestNewMetric}
            >
              <Plus className="h-4 w-4" />
              Suggest New Metric
            </Button>
            <Link to="/data-dictionary/review-queue">
              <Button variant="outline" size="sm" className="gap-2">
                <Inbox className="h-4 w-4" />
                Review Queue
              </Button>
            </Link>
            <a
              href={NOTION_DATA_DICTIONARY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
              Edit in Notion
            </a>
          </div>
        </div>

        {/* Tabs & Search */}
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as any)}>
          <div className="flex items-center justify-between gap-4">
            <TabsList>
              <TabsTrigger value="all">All Metrics</TabsTrigger>
              <TabsTrigger value="instructions" className="flex items-center gap-1.5">
                <Code2 className="h-3.5 w-3.5" />
                AI Instructions
              </TabsTrigger>
            </TabsList>

            {viewMode !== "instructions" && (
              <div className="flex items-center gap-2 flex-1">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="Search metrics..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <select
                  value={selectedDepartment}
                  onChange={(e) => setSelectedDepartment(e.target.value)}
                  className="h-9 px-3 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  <option value="all">All Departments</option>
                  {departments.map((dept) => (
                    <option key={dept} value={dept}>
                      {dept}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* AI Instructions Tab */}
          <TabsContent value="instructions" className="mt-4">
            <div className="mb-4">
              <p className="text-sm text-muted-foreground">
                Edit SKILL.md and rule files that guide the AI assistant. Changes are saved to <code className="bg-muted px-1.5 py-0.5 rounded text-xs">.builder/skills/</code> and <code className="bg-muted px-1.5 py-0.5 rounded text-xs">.builder/rules/</code> directories.
              </p>
            </div>
            <AIInstructionsEditor />
          </TabsContent>


          {/* Metrics Tabs */}
          <TabsContent value="all" className="mt-4 space-y-4">
            <MissingMetricsWidget onDefineMetric={handleDefineMetric} />

            {isLoading && (
              <div className="space-y-1">
                {[...Array(10)].map((_, i) => (
                  <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />
                ))}
              </div>
            )}

            {error && (
              <Card className="border-destructive/50 bg-destructive/10">
                <CardContent className="pt-6">
                  <p className="text-sm text-destructive">
                    Failed to load Data Dictionary. Please try again later.
                  </p>
                </CardContent>
              </Card>
            )}

            {!isLoading && !error && (
              <>
                <div className="flex items-start justify-between gap-4">
                  <p className="text-xs text-muted-foreground">
                    {filteredEntries.length} {filteredEntries.length === 1 ? "metric" : "metrics"} found
                    {selectedDepartment !== "all" && ` in ${selectedDepartment}`}
                  </p>
                  <div className="text-xs text-muted-foreground bg-muted/30 px-3 py-1.5 rounded-lg border border-border/50">
                    <span className="font-medium">Completeness:</span> Based on essential fields (Definition, Table, Department) + at least one context field
                  </div>
                </div>

                {Object.keys(groupedEntries).length > 0 ? (
                  <div className="space-y-6">
                    {Object.entries(groupedEntries)
                      .sort(([deptA], [deptB]) => deptA.localeCompare(deptB))
                      .map(([department, deptEntries]) => {
                        const deptColors = departmentColors[department] ?? {
                          bg: "bg-slate-500/10",
                          text: "text-slate-500 dark:text-slate-400",
                          border: "border-slate-500/30"
                        };

                        return (
                          <div key={department} className="space-y-2">
                            {/* Department Header */}
                            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${deptColors.bg} ${deptColors.border}`}>
                              <Tag className={`h-4 w-4 ${deptColors.text}`} />
                              <h3 className={`font-semibold text-sm ${deptColors.text}`}>
                                {department}
                              </h3>
                              <span className={`text-xs ${deptColors.text} ml-auto`}>
                                {deptEntries.length} {deptEntries.length === 1 ? "metric" : "metrics"}
                              </span>
                            </div>

                            {/* Metrics in this department */}
                            <div className="space-y-1">
                              {deptEntries.map((entry) => {
                                // Calculate completeness based on essential fields only
                                // Core fields every metric should have
                                const essentialFields = [
                                  entry.Definition,
                                  entry.Table,
                                  entry.Department,
                                ];

                                // Important context fields (at least one should be filled)
                                const contextFields = [
                                  entry.CommonQuestions,
                                  entry.KnownGotchas,
                                  entry.ExampleUseCase,
                                ];

                                const hasContext = contextFields.some(f => f && f.trim());
                                const essentialFilled = essentialFields.filter(f => f && f.trim()).length;
                                const essentialTotal = essentialFields.length;

                                // Completeness: 75% from essentials, 25% from having at least one context field
                                const essentialScore = (essentialFilled / essentialTotal) * 75;
                                const contextScore = hasContext ? 25 : 0;
                                const completeness = Math.round(essentialScore + contextScore);

                                return (
                                  <div
                                    key={entry.url}
                                    className="group border border-border rounded-lg hover:border-primary/50 transition-all hover:bg-muted/30 cursor-pointer"
                                    onClick={() => setSelectedEntry(entry)}
                                  >
                                    <div className="flex items-center gap-4 px-4 py-3">
                                      {/* Metric Name */}
                                      <div className="flex-1 min-w-0">
                                        <h3 className="font-semibold text-sm group-hover:text-primary transition-colors truncate">
                                          {entry.Metric}
                                        </h3>
                                      </div>

                                      {/* Badges */}
                                      <div className="flex items-center gap-1.5 flex-shrink-0">
                                        {completeness === 100 && (
                                          <Badge variant="outline" className="border-green-500 bg-green-500/10 text-green-600 dark:text-green-400 text-[10px] px-1.5 py-0 h-5">
                                            <CheckCircle className="h-2.5 w-2.5 mr-0.5" />
                                            Complete
                                          </Badge>
                                        )}
                                        {entry.ValidationIssues && entry.ValidationIssues > 0 && (
                                          <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-5">
                                            <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                                            {entry.ValidationIssues}
                                          </Badge>
                                        )}
                                        {entry.ValidationTrust && entry.ValidationTrust > 5 && (
                                          <Badge variant="outline" className="border-blue-500 text-blue-600 dark:text-blue-400 text-[10px] px-1.5 py-0 h-5">
                                            <ShieldCheck className="h-2.5 w-2.5 mr-0.5" />
                                            {entry.ValidationTrust}
                                          </Badge>
                                        )}
                                      </div>

                                      {/* Completeness */}
                                      <div className="flex items-center gap-3 flex-shrink-0">
                                        <div className="flex items-center gap-2" title="Based on essential fields: Definition, Table, Department + at least one context field (Common Questions, Known Gotchas, or Example Use Case)">
                                          <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                                            <div
                                              className={`h-full transition-all ${
                                                completeness === 100 ? 'bg-green-500' :
                                                completeness >= 75 ? 'bg-green-400' :
                                                completeness >= 50 ? 'bg-yellow-500' :
                                                'bg-orange-500'
                                              }`}
                                              style={{ width: `${completeness}%` }}
                                            />
                                          </div>
                                          <span className="text-xs font-medium text-muted-foreground w-10 text-right">
                                            {completeness}%
                                          </span>
                                        </div>

                                        {/* Actions */}
                                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                          {canEdit && (
                                            <Button
                                              size="sm"
                                              variant="ghost"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setEditingEntry(entry);
                                              }}
                                              className="h-7 w-7 p-0 hover:bg-primary/10"
                                              title="Edit Metric"
                                            >
                                              <Pencil className="h-3.5 w-3.5" />
                                            </Button>
                                          )}
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setValidationMetric({ id: entry.id, name: entry.Metric });
                                            }}
                                            className="h-7 w-7 p-0 hover:bg-primary/10"
                                            title="Validate Metric"
                                          >
                                            <CheckCircle className="h-3.5 w-3.5" />
                                          </Button>
                                          <ChevronRight className="h-4 w-4 text-muted-foreground ml-1" />
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                ) : (
                  <div className="border border-border rounded-lg p-12 text-center">
                    <p className="text-sm text-muted-foreground">
                      No metrics found matching "{search}"
                      {selectedDepartment !== "all" && ` in ${selectedDepartment}`}
                    </p>
                  </div>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>

        {/* Metric Detail Dialog */}
        <MetricDetailDialog
          entry={selectedEntry}
          isOpen={!!selectedEntry}
          onClose={() => setSelectedEntry(null)}
          canEdit={canEdit}
          onEdit={(entry) => {
            setSelectedEntry(null);
            setEditingEntry(entry);
          }}
          onValidate={(entry) => {
            setSelectedEntry(null);
            setValidationMetric({ id: entry.id, name: entry.Metric });
          }}
        />

        {/* Persona Selection Modal */}
        <PersonaSelectionModal open={showPersonaModal} onSelect={handlePersonaSelect} />

        {/* Metric Validation Form */}
        {validationMetric && (
          <MetricValidationForm
            metricName={validationMetric.name}
            metricId={validationMetric.id}
            isOpen={!!validationMetric}
            onClose={() => setValidationMetric(null)}
            onSuccess={() => refetch()}
          />
        )}

        {/* Metric Edit Form */}
        {editingEntry && (
          <MetricEditForm
            entry={editingEntry}
            isOpen={!!editingEntry}
            onClose={() => setEditingEntry(null)}
            onSuccess={() => refetch()}
          />
        )}
      </div>
    </Layout>
  );
}
