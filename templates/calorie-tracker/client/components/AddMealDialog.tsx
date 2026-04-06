import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  mealSchema,
  Meal,
  AIAnalysisResponse,
  DualAIAnalysisResponse,
} from "@shared/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus, Sparkles, Upload, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";
import { formatLocalDate } from "@/lib/utils";

// Schema for the form, slightly different from API schema to handle strings
const formSchema = mealSchema.extend({
  calories: z.string().transform((val) => parseInt(val, 10)),
  protein: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 0)),
  carbs: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 0)),
  fat: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 0)),
});

type FormData = z.input<typeof formSchema>;

interface AddMealDialogProps {
  editingMeal?: Meal | null;
  onOpenChange?: (open: boolean) => void;
  isOpen?: boolean;
  currentDate?: Date;
}

export function AddMealDialog({
  editingMeal,
  onOpenChange,
  isOpen: controlledOpen,
  currentDate = new Date(),
}: AddMealDialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : uncontrolledOpen;
  const setOpen =
    controlledOpen !== undefined
      ? (value: boolean) => onOpenChange?.(value)
      : setUncontrolledOpen;
  const [activeTab, setActiveTab] = useState("manual");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showMacros, setShowMacros] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [aiResponses, setAiResponses] = useState<DualAIAnalysisResponse | null>(
    null,
  );
  const [selectedModel, setSelectedModel] = useState<"haiku" | "opus" | null>(
    null,
  );
  const [analysisError, setAnalysisError] = useState<{
    message: string;
    details?: string;
  } | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEditing = !!editingMeal;

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: editingMeal?.name || "",
      calories: editingMeal?.calories.toString() || "",
      protein: editingMeal?.protein?.toString() || "",
      carbs: editingMeal?.carbs?.toString() || "",
      fat: editingMeal?.fat?.toString() || "",
      date: editingMeal?.date || formatLocalDate(currentDate),
      notes: editingMeal?.notes || "",
    },
  });

  const createMealMutation = useMutation({
    mutationFn: async (data: Meal) => {
      return await apiRequest("POST", "/api/meals", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meals"] });
      toast({ title: "Meal added successfully" });
      setOpen(false);
      form.reset();
      setShowMacros(false);
      onOpenChange?.(false);
    },
    onError: () => {
      toast({ title: "Failed to add meal", variant: "destructive" });
    },
  });

  const updateMealMutation = useMutation({
    mutationFn: async (data: Meal) => {
      return await apiRequest("PUT", `/api/meals/${editingMeal?.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meals"] });
      toast({ title: "Meal updated successfully" });
      setOpen(false);
      form.reset();
      setShowMacros(false);
      onOpenChange?.(false);
    },
    onError: () => {
      toast({ title: "Failed to update meal", variant: "destructive" });
    },
  });

  const analyzeMealMutation = useMutation({
    mutationFn: async (data: {
      description?: string;
      imageBase64?: string;
      imageMediaType?: string;
    }) => {
      return (await apiRequest(
        "POST",
        "/api/analyze-meal",
        data,
      )) as DualAIAnalysisResponse;
    },
    onSuccess: (data) => {
      setAiResponses(data);
      setSelectedModel(null);
      toast({
        title: "Meal analyzed!",
        description: "Choose which AI estimate to use.",
      });
    },
    onError: (error: any) => {
      const errorDetails = error?.details
        ? typeof error.details === "string"
          ? error.details
          : JSON.stringify(error.details, null, 2)
        : null;
      setAnalysisError({
        message: error?.message || "Unknown error",
        details: errorDetails || undefined,
      });
      toast({
        title: "Analysis failed",
        description: "See error details below",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: FormData) => {
    const mealData = {
      ...data,
      date: isEditing ? editingMeal.date : formatLocalDate(currentDate),
      id: editingMeal?.id,
    } as unknown as Meal;

    if (isEditing) {
      updateMealMutation.mutate(mealData);
    } else {
      createMealMutation.mutate(mealData);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    onOpenChange?.(newOpen);
    if (!newOpen) {
      form.reset();
      setShowMacros(false);
      setSelectedFile(null);
      setFilePreview(null);
      setAiResponses(null);
      setSelectedModel(null);
      setAnalysisError(null);
    }
  };

  const handleSelectAIResponse = (model: "haiku" | "opus") => {
    if (!aiResponses) return;
    const data = model === "haiku" ? aiResponses.haiku : aiResponses.opus;
    form.setValue("name", data.name);
    form.setValue("calories", data.calories.toString());
    form.setValue("protein", data.protein.toString());
    form.setValue("carbs", data.carbs.toString());
    form.setValue("fat", data.fat.toString());
    setActiveTab("manual");
    setShowMacros(true);
    setSelectedFile(null);
    setFilePreview(null);
    setAiResponses(null);
    setSelectedModel(null);
  };

  useEffect(() => {
    if (editingMeal) {
      form.reset({
        name: editingMeal.name,
        calories: editingMeal.calories.toString(),
        protein: editingMeal.protein?.toString() || "",
        carbs: editingMeal.carbs?.toString() || "",
        fat: editingMeal.fat?.toString() || "",
        date: editingMeal.date,
        notes: editingMeal.notes || "",
      });
      setShowMacros(
        (editingMeal.protein ?? 0) > 0 ||
          (editingMeal.carbs ?? 0) > 0 ||
          (editingMeal.fat ?? 0) > 0,
      );
    }
  }, [editingMeal, form]);

  const handleAnalyze = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const description = formData.get("description") as string;

    if (!description && !selectedFile) {
      toast({
        title: "Please provide a description or upload an image",
        variant: "destructive",
      });
      return;
    }

    setIsAnalyzing(true);
    setAnalysisError(null);
    try {
      if (selectedFile) {
        const reader = new FileReader();
        reader.onload = async (event) => {
          const base64 = (event.target?.result as string).split(",")[1];
          const mediaType = selectedFile.type || "image/jpeg";
          await analyzeMealMutation.mutateAsync({
            description: description || "",
            imageBase64: base64,
            imageMediaType: mediaType,
          });
        };
        reader.readAsDataURL(selectedFile);
      } else {
        await analyzeMealMutation.mutateAsync({
          description: description || "",
        });
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!isEditing && (
        <DialogTrigger asChild>
          <Button size="sm" className="gap-1.5 h-8 rounded-md shadow-sm">
            <Plus className="h-3.5 w-3.5" /> Add Meal
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[425px] gap-6">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Meal" : "Add New Meal"}</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="manual">Manual Entry</TabsTrigger>
            <TabsTrigger value="ai">AI Estimate</TabsTrigger>
          </TabsList>

          <TabsContent value="manual">
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-4 mt-4"
            >
              <div className="space-y-2">
                <Label htmlFor="name">Meal Name</Label>
                <Input
                  id="name"
                  {...form.register("name")}
                  placeholder="e.g., Oatmeal"
                  autoFocus
                  enterKeyHint="next"
                  autoComplete="off"
                />
                {form.formState.errors.name && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.name.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="calories">Calories</Label>
                <Input
                  id="calories"
                  type="number"
                  inputMode="numeric"
                  {...form.register("calories")}
                  placeholder="kcal"
                  enterKeyHint="done"
                />
                {form.formState.errors.calories && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.calories.message}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowMacros(!showMacros)}
                className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${
                    showMacros ? "rotate-180" : ""
                  }`}
                />
                Add Nutrition Details
              </button>

              {showMacros && (
                <div className="pt-2 border-t space-y-4 bg-secondary/30 -mx-6 px-6 py-4 rounded">
                  <p className="text-xs font-medium text-muted-foreground">
                    Optional
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="protein">Protein (g)</Label>
                      <Input
                        id="protein"
                        type="number"
                        inputMode="numeric"
                        {...form.register("protein")}
                        placeholder="0"
                        enterKeyHint="next"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="carbs">Carbs (g)</Label>
                      <Input
                        id="carbs"
                        type="number"
                        inputMode="numeric"
                        {...form.register("carbs")}
                        placeholder="0"
                        enterKeyHint="next"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="fat">Fat (g)</Label>
                      <Input
                        id="fat"
                        type="number"
                        inputMode="numeric"
                        {...form.register("fat")}
                        placeholder="0"
                        enterKeyHint="done"
                      />
                    </div>
                  </div>
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={
                  createMealMutation.isPending || updateMealMutation.isPending
                }
              >
                {createMealMutation.isPending || updateMealMutation.isPending
                  ? "Saving..."
                  : isEditing
                    ? "Save Changes"
                    : "Save Meal"}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="ai">
            <div className="space-y-4 mt-4">
              {analysisError && (
                <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-destructive">
                      Analysis failed: {analysisError.message}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setAnalysisError(null)}
                      className="h-6 px-2 text-xs"
                    >
                      Dismiss
                    </Button>
                  </div>
                  {analysisError.details && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        View full error details
                      </summary>
                      <pre className="mt-2 p-2 bg-secondary/50 rounded text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                        {analysisError.details}
                      </pre>
                    </details>
                  )}
                </div>
              )}
              {aiResponses ? (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Choose which AI estimate to use:
                  </p>

                  <div className="space-y-3">
                    <div
                      className="border rounded-lg p-4 bg-secondary/20 hover:bg-secondary/40 cursor-pointer transition-colors"
                      onClick={() => handleSelectAIResponse("haiku")}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-semibold text-sm">
                          Claude 4.5 Haiku
                        </h4>
                        <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">
                          Fast
                        </span>
                      </div>
                      <div className="text-sm space-y-1">
                        <p className="font-medium">{aiResponses.haiku.name}</p>
                        <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                          <span>{aiResponses.haiku.calories} cal</span>
                          <span>{aiResponses.haiku.protein}g protein</span>
                          <span>{aiResponses.haiku.carbs}g carbs</span>
                          <span>{aiResponses.haiku.fat}g fat</span>
                        </div>
                        {aiResponses.haiku.reasoning && (
                          <details className="mt-2">
                            <summary className="text-xs cursor-pointer text-muted-foreground hover:text-foreground">
                              View reasoning
                            </summary>
                            <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">
                              {aiResponses.haiku.reasoning}
                            </p>
                          </details>
                        )}
                      </div>
                    </div>

                    <div
                      className="border rounded-lg p-4 bg-secondary/20 hover:bg-secondary/40 cursor-pointer transition-colors"
                      onClick={() => handleSelectAIResponse("opus")}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-semibold text-sm">
                          Claude 4.5 Opus
                        </h4>
                        <span className="text-xs bg-accent/50 text-accent-foreground px-2 py-1 rounded">
                          Detailed
                        </span>
                      </div>
                      <div className="text-sm space-y-1">
                        <p className="font-medium">{aiResponses.opus.name}</p>
                        <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                          <span>{aiResponses.opus.calories} cal</span>
                          <span>{aiResponses.opus.protein}g protein</span>
                          <span>{aiResponses.opus.carbs}g carbs</span>
                          <span>{aiResponses.opus.fat}g fat</span>
                        </div>
                        {aiResponses.opus.reasoning && (
                          <details className="mt-2">
                            <summary className="text-xs cursor-pointer text-muted-foreground hover:text-foreground">
                              View reasoning
                            </summary>
                            <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">
                              {aiResponses.opus.reasoning}
                            </p>
                          </details>
                        )}
                      </div>
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    onClick={() => setAiResponses(null)}
                    className="w-full"
                  >
                    Analyze Again
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleAnalyze} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="description">Meal Description</Label>
                    <Textarea
                      id="description"
                      name="description"
                      placeholder="e.g., A large bowl of caesar salad with grilled chicken and croutons..."
                      className="min-h-[100px]"
                    />
                  </div>

                  <div className="flex items-center justify-center w-full">
                    <label
                      htmlFor="dropzone-file"
                      className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer bg-secondary/20 hover:bg-secondary/40 border-border transition-colors"
                    >
                      <div className="flex flex-col items-center justify-center pt-5 pb-6">
                        {filePreview ? (
                          <>
                            <img
                              src={filePreview}
                              alt="Preview"
                              className="w-20 h-20 object-cover rounded mb-2"
                            />
                            <p className="text-sm text-muted-foreground">
                              {selectedFile?.name}
                            </p>
                          </>
                        ) : (
                          <>
                            <Upload className="w-8 h-8 mb-2 text-muted-foreground" />
                            <p className="text-sm text-muted-foreground">
                              <span className="font-semibold">
                                Click to upload
                              </span>{" "}
                              or drag and drop
                            </p>
                          </>
                        )}
                      </div>
                      <input
                        id="dropzone-file"
                        type="file"
                        className="hidden"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.currentTarget.files?.[0];
                          if (file) {
                            setSelectedFile(file);
                            const reader = new FileReader();
                            reader.onload = (event) => {
                              setFilePreview(event.target?.result as string);
                            };
                            reader.readAsDataURL(file);
                          }
                        }}
                      />
                    </label>
                  </div>

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={isAnalyzing}
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />{" "}
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2 h-4 w-4" /> Analyze Meal
                      </>
                    )}
                  </Button>
                </form>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
