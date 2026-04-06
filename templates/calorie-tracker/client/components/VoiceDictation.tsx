import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, MicOff, Loader2, Undo2 } from "lucide-react";
import { cn, formatLocalDate } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Meal } from "@shared/api";
import { ToastAction } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";

interface VoiceDictationProps {
  currentDate: Date;
}

type VoiceState = "idle" | "listening" | "processing";

interface ParsedCommand {
  items: Array<{
    type: "meal" | "exercise" | "weight";
    action: "add" | "edit" | "delete" | "unknown";
    existingId?: number;
    data: {
      name: string;
      calories?: number;
      protein?: number;
      carbs?: number;
      fat?: number;
      calories_burned?: number;
      duration_minutes?: number;
      weight?: number;
      notes?: string;
    };
  }>;
}

interface ExistingItem {
  id: number;
  type: "meal" | "exercise" | "weight";
  name: string;
  calories?: number;
  calories_burned?: number;
  weight?: number;
}

// Track actions for undo functionality
interface UndoableAction {
  type: "add" | "edit" | "delete";
  itemType: "meal" | "exercise" | "weight";
  id?: number;
  originalData?: any;
  createdId?: number;
}

export function VoiceDictation({ currentDate }: VoiceDictationProps) {
  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const isProcessingRef = useRef(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const dateStr = formatLocalDate(currentDate);

  // Undo state - track last actions and allow reverting
  const [lastActions, setLastActions] = useState<UndoableAction[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);
  const [undoDescription, setUndoDescription] = useState("");
  const undoTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch current items for context
  const { data: meals } = useQuery<Meal[]>({
    queryKey: ["/api/meals", dateStr],
    queryFn: async () => apiRequest("GET", `/api/meals?date=${dateStr}`),
  });

  const { data: exercises } = useQuery<any[]>({
    queryKey: ["/api/exercises", dateStr],
    queryFn: async () => apiRequest("GET", `/api/exercises?date=${dateStr}`),
  });

  const { data: weights } = useQuery<any[]>({
    queryKey: ["/api/weights", dateStr],
    queryFn: async () => apiRequest("GET", `/api/weights?date=${dateStr}`),
  });

  // Check for speech recognition support
  const isSupported =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  // Handle undo - reverses all actions from the last voice command
  const handleUndo = useCallback(async () => {
    if (lastActions.length === 0 || isUndoing) return;

    setIsUndoing(true);

    try {
      // Process actions in reverse order
      for (const action of [...lastActions].reverse()) {
        if (action.type === "add" && action.createdId) {
          // Delete the item that was added
          const endpoint = action.itemType === "meal" ? "meals" :
                          action.itemType === "exercise" ? "exercises" : "weights";
          await apiRequest("DELETE", `/api/${endpoint}/${action.createdId}`);
        } else if (action.type === "edit" && action.id && action.originalData) {
          // Restore the original data
          const endpoint = action.itemType === "meal" ? "meals" :
                          action.itemType === "exercise" ? "exercises" : "weights";
          const { id, ...data } = action.originalData;
          await apiRequest("PUT", `/api/${endpoint}/${action.id}`, data);
        } else if (action.type === "delete" && action.originalData) {
          // Re-create the deleted item
          const endpoint = action.itemType === "meal" ? "meals" :
                          action.itemType === "exercise" ? "exercises" : "weights";
          const { id, ...data } = action.originalData;
          await apiRequest("POST", `/api/${endpoint}`, data);
        }
      }

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ["/api/meals", dateStr] });
      queryClient.invalidateQueries({ queryKey: ["/api/exercises", dateStr] });
      queryClient.invalidateQueries({ queryKey: ["/api/weights", dateStr] });
      queryClient.invalidateQueries({ queryKey: ["/api/weights/history"] });

      toast({
        title: "Undone!",
        description: "Action has been reversed",
      });

      // Clear undo state
      setCanUndo(false);
      setLastActions([]);
      if (undoTimeoutRef.current) {
        clearTimeout(undoTimeoutRef.current);
      }
    } catch (error) {
      console.error("Failed to undo:", error);
      toast({
        title: "Undo failed",
        description: "Could not reverse the action",
        variant: "destructive",
      });
    } finally {
      setIsUndoing(false);
    }
  }, [lastActions, isUndoing, queryClient, dateStr, toast]);

  // Handler for toast action button
  const handleUndoClick = useCallback(() => {
    handleUndo();
  }, [handleUndo]);

  const processCommand = useCallback(
    async (text: string) => {
      setState("processing");

      try {
        // Build existing items context
        const existingItems: ExistingItem[] = [];

        if (meals) {
          meals.forEach((meal) => {
            if (meal.id) {
              existingItems.push({
                id: meal.id,
                type: "meal",
                name: meal.name,
                calories: meal.calories,
              });
            }
          });
        }

        if (exercises) {
          exercises.forEach((exercise) => {
            existingItems.push({
              id: exercise.id,
              type: "exercise",
              name: exercise.name,
              calories_burned: exercise.calories_burned,
            });
          });
        }

        if (weights) {
          weights.forEach((weight) => {
            existingItems.push({
              id: weight.id,
              type: "weight",
              name: "weight",
              weight: weight.weight,
            });
          });
        }

        const response = (await apiRequest("POST", "/api/parse-voice-command", {
          command: text,
          date: formatLocalDate(currentDate),
          existingItems,
        })) as ParsedCommand;

        if (!response.items || response.items.length === 0) {
          toast({
            title: "Could not understand",
            description:
              "Try saying 'add breakfast 400 calories', 'change salad to 700', or 'delete the pizza'",
            variant: "destructive",
          });
          return;
        }

        // Process each item
        let addedMeals = 0;
        let addedExercises = 0;
        let addedWeight = false;
        let editedItems = 0;
        let deletedItems = 0;

        // Track actions for undo
        const actionsPerformed: UndoableAction[] = [];

        for (const item of response.items) {
          // ADD actions
          if (item.action === "add") {
            if (item.type === "meal") {
              const result = await apiRequest("POST", "/api/meals", {
                name: item.data.name,
                calories: item.data.calories || 0,
                protein: item.data.protein,
                carbs: item.data.carbs,
                fat: item.data.fat,
                date: formatLocalDate(currentDate),
              }) as { id: number };
              actionsPerformed.push({
                type: "add",
                itemType: "meal",
                createdId: result.id,
              });
              addedMeals++;
            } else if (item.type === "exercise") {
              const result = await apiRequest("POST", "/api/exercises", {
                name: item.data.name,
                calories_burned:
                  item.data.calories_burned || item.data.calories || 0,
                duration_minutes: item.data.duration_minutes,
                date: formatLocalDate(currentDate),
              }) as { id: number };
              actionsPerformed.push({
                type: "add",
                itemType: "exercise",
                createdId: result.id,
              });
              addedExercises++;
            } else if (item.type === "weight" && item.data.weight) {
              const result = await apiRequest("POST", "/api/weights", {
                weight: item.data.weight,
                date: formatLocalDate(currentDate),
                notes: item.data.notes || undefined,
              }) as { id: number };
              actionsPerformed.push({
                type: "add",
                itemType: "weight",
                createdId: result.id,
              });
              addedWeight = true;
            }
          }

          // EDIT actions
          else if (item.action === "edit" && item.existingId) {
            if (item.type === "meal") {
              // Get existing meal data to preserve fields
              const existingMeal = meals?.find((m) => m.id === item.existingId);
              if (existingMeal) {
                // Store original data for undo
                actionsPerformed.push({
                  type: "edit",
                  itemType: "meal",
                  id: item.existingId,
                  originalData: { ...existingMeal },
                });
                await apiRequest("PUT", `/api/meals/${item.existingId}`, {
                  name: item.data.name || existingMeal.name,
                  calories: item.data.calories ?? existingMeal.calories,
                  protein: item.data.protein ?? existingMeal.protein,
                  carbs: item.data.carbs ?? existingMeal.carbs,
                  fat: item.data.fat ?? existingMeal.fat,
                  date: existingMeal.date,
                });
                editedItems++;
              }
            } else if (item.type === "exercise") {
              const existingExercise = exercises?.find(
                (e) => e.id === item.existingId,
              );
              if (existingExercise) {
                // Store original data for undo
                actionsPerformed.push({
                  type: "edit",
                  itemType: "exercise",
                  id: item.existingId,
                  originalData: { ...existingExercise },
                });
                await apiRequest("PUT", `/api/exercises/${item.existingId}`, {
                  name: item.data.name || existingExercise.name,
                  calories_burned:
                    item.data.calories_burned ??
                    existingExercise.calories_burned,
                  duration_minutes:
                    item.data.duration_minutes ??
                    existingExercise.duration_minutes,
                  date: existingExercise.date,
                });
                editedItems++;
              }
            } else if (item.type === "weight") {
              const existingWeight = weights?.find(
                (w) => w.id === item.existingId,
              );
              if (existingWeight) {
                // Store original data for undo
                actionsPerformed.push({
                  type: "edit",
                  itemType: "weight",
                  id: item.existingId,
                  originalData: { ...existingWeight },
                });
                await apiRequest("PUT", `/api/weights/${item.existingId}`, {
                  weight: item.data.weight ?? existingWeight.weight,
                  date: existingWeight.date,
                  notes: item.data.notes ?? existingWeight.notes,
                });
                editedItems++;
              }
            }
          }

          // DELETE actions
          else if (item.action === "delete" && item.existingId) {
            if (item.type === "meal") {
              const existingMeal = meals?.find((m) => m.id === item.existingId);
              if (existingMeal) {
                actionsPerformed.push({
                  type: "delete",
                  itemType: "meal",
                  id: item.existingId,
                  originalData: { ...existingMeal },
                });
              }
              await apiRequest("DELETE", `/api/meals/${item.existingId}`);
              deletedItems++;
            } else if (item.type === "exercise") {
              const existingExercise = exercises?.find((e) => e.id === item.existingId);
              if (existingExercise) {
                actionsPerformed.push({
                  type: "delete",
                  itemType: "exercise",
                  id: item.existingId,
                  originalData: { ...existingExercise },
                });
              }
              await apiRequest("DELETE", `/api/exercises/${item.existingId}`);
              deletedItems++;
            } else if (item.type === "weight") {
              const existingWeight = weights?.find((w) => w.id === item.existingId);
              if (existingWeight) {
                actionsPerformed.push({
                  type: "delete",
                  itemType: "weight",
                  id: item.existingId,
                  originalData: { ...existingWeight },
                });
              }
              await apiRequest("DELETE", `/api/weights/${item.existingId}`);
              deletedItems++;
            }
          }
        }

        // Store actions for undo
        if (actionsPerformed.length > 0) {
          setLastActions(actionsPerformed);
          setCanUndo(true);

          // Clear any existing undo timeout
          if (undoTimeoutRef.current) {
            clearTimeout(undoTimeoutRef.current);
          }
          // Auto-clear undo availability after 30 seconds
          undoTimeoutRef.current = setTimeout(() => {
            setCanUndo(false);
            setLastActions([]);
          }, 30000);
        }

        // Invalidate queries to refresh data
        queryClient.invalidateQueries({ queryKey: ["/api/meals", dateStr] });
        queryClient.invalidateQueries({
          queryKey: ["/api/exercises", dateStr],
        });
        queryClient.invalidateQueries({ queryKey: ["/api/weights", dateStr] });
        queryClient.invalidateQueries({ queryKey: ["/api/weights/history"] });

        // Show success message with prominent undo button
        const parts = [];
        if (addedMeals > 0)
          parts.push(`added ${addedMeals} meal${addedMeals > 1 ? "s" : ""}`);
        if (addedExercises > 0)
          parts.push(
            `added ${addedExercises} exercise${addedExercises > 1 ? "s" : ""}`,
          );
        if (addedWeight) parts.push("logged weight");
        if (editedItems > 0)
          parts.push(
            `updated ${editedItems} item${editedItems > 1 ? "s" : ""}`,
          );
        if (deletedItems > 0)
          parts.push(
            `deleted ${deletedItems} item${deletedItems > 1 ? "s" : ""}`,
          );

        if (parts.length > 0) {
          const description = parts.join(", ").replace(/^./, (c) => c.toUpperCase());
          setUndoDescription(description);
          toast({
            title: "Done!",
            description,
            duration: 8000,
            action: actionsPerformed.length > 0 ? (
              <ToastAction altText="Undo" onClick={handleUndoClick}>
                Undo
              </ToastAction>
            ) : undefined,
          });
        }
      } catch (error) {
        console.error("Error processing voice command:", error);

        let errorMessage = "Failed to process voice command. Please try again.";

        if (error instanceof Error) {
          errorMessage = error.message;
        } else if (typeof error === "object" && error !== null) {
          // Handle object errors (like API responses)
          if ("error" in error && typeof (error as any).error === "string") {
            errorMessage = (error as any).error;
          } else if ("message" in error && typeof (error as any).message === "string") {
            errorMessage = (error as any).message;
          } else {
            try {
              errorMessage = JSON.stringify(error);
            } catch {
              errorMessage = "Unknown error occurred";
            }
          }
        } else if (typeof error === "string") {
          errorMessage = error;
        }

        // Clean up error message
        try {
          const match = errorMessage.match(/Error: (.+)/);
          if (match) errorMessage = match[1];
        } catch {}

        toast({
          title: "Voice command failed",
          description: errorMessage,
          variant: "destructive",
        });
      } finally {
        setState("idle");
        setTranscript("");
      }
    },
    [currentDate, dateStr, meals, exercises, weights, queryClient, toast, handleUndoClick],
  );

  const startListening = useCallback(() => {
    if (!isSupported) {
      toast({
        title: "Not supported",
        description: "Voice dictation is not supported in your browser",
        variant: "destructive",
      });
      return;
    }

    // Clean up any existing recognition instance first
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch (e) {
        // Ignore cleanup errors
      }
      recognitionRef.current = null;
    }

    // Reset state
    isProcessingRef.current = false;
    setState("listening");
    setTranscript("");

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();

    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    // Increase max alternatives for better accuracy
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      // Already set above, but ensure state is correct
      setState("listening");
    };

    recognition.onresult = (event) => {
      const current = event.resultIndex;
      const result = event.results[current];
      const transcriptText = result[0].transcript;
      setTranscript(transcriptText);

      if (result.isFinal && !isProcessingRef.current) {
        isProcessingRef.current = true;
        try {
          recognition.stop();
        } catch (e) {
          // Ignore if already stopped
        }
        processCommand(transcriptText);
      }
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error:", event.error);

      // Only reset state if we're not already processing
      if (!isProcessingRef.current) {
        setState("idle");
        setTranscript("");
      }

      if (event.error === "not-allowed") {
        toast({
          title: "Microphone access denied",
          description: "Please allow microphone access to use voice dictation",
          variant: "destructive",
        });
      } else if (event.error === "no-speech") {
        toast({
          title: "No speech detected",
          description: "Please try again and speak clearly",
          variant: "destructive",
        });
      } else if (event.error !== "aborted") {
        toast({
          title: "Error",
          description: "Could not capture audio. Please try again.",
          variant: "destructive",
        });
      }
    };

    recognition.onend = () => {
      // Only reset to idle if we're not processing a command
      if (!isProcessingRef.current) {
        setState("idle");
      }
      // Clear the reference since this instance is done
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (e) {
      console.error("Failed to start recognition:", e);
      setState("idle");
      toast({
        title: "Error",
        description: "Could not start voice recognition. Please try again.",
        variant: "destructive",
      });
    }
  }, [isSupported, processCommand, toast]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        // Ignore if already stopped
      }
    }
    setState("idle");
  }, []);

  const handleClick = useCallback(() => {
    if (state === "idle") {
      startListening();
    } else if (state === "listening") {
      stopListening();
    }
  }, [state, startListening, stopListening]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  if (!isSupported) {
    return null;
  }

  return (
    <>
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 md:left-auto md:right-6 md:translate-x-0 z-50 flex flex-col items-center gap-2">
        {(state === "listening" || state === "processing") && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="bg-card/95 backdrop-blur-xl border border-white/10 rounded-2xl px-4 py-3 shadow-2xl max-w-[300px] md:max-w-[250px]">
              {state === "listening" && (
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                    <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse delay-75" />
                    <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse delay-150" />
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {transcript || "Listening..."}
                  </span>
                </div>
              )}
              {state === "processing" && (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground">
                    Processing: "{transcript}"
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="relative flex items-center justify-center">
          {/* Subtle Undo Button - positioned to the left, doesn't shift mic */}
          {canUndo && state === "idle" && (
            <button
              onClick={handleUndo}
              disabled={isUndoing}
              className={cn(
                "absolute right-full mr-3 flex items-center justify-center",
                "w-8 h-8 rounded-full",
                "bg-muted/80 hover:bg-muted",
                "border border-border/50",
                "transition-all duration-200 ease-out",
                "animate-in fade-in slide-in-from-right-2",
                "focus:outline-none focus:ring-1 focus:ring-ring/50",
                isUndoing && "opacity-50 cursor-not-allowed",
              )}
              title="Undo last action"
            >
              {isUndoing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              ) : (
                <Undo2 className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </button>
          )}

          <button
            onClick={handleClick}
            disabled={state === "processing"}
            className={cn(
              "relative flex items-center justify-center",
              "w-16 h-16 md:w-12 md:h-12 rounded-full",
              "shadow-2xl shadow-black/50",
              "transition-all duration-300 ease-out",
              "focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background",
              state === "idle" &&
                "bg-gradient-to-br from-primary to-primary/80 hover:scale-105 active:scale-95",
              state === "listening" &&
                "bg-gradient-to-br from-red-500 to-red-600 scale-110",
              state === "processing" &&
                "bg-gradient-to-br from-muted to-muted/80 cursor-not-allowed",
            )}
          >
            {state === "listening" && (
              <>
                <span className="absolute inset-0 rounded-full bg-red-500/30 animate-ping" />
                <span className="absolute inset-[-4px] rounded-full border-2 border-red-500/50 animate-pulse" />
              </>
            )}

            {state === "idle" && (
              <Mic className="h-7 w-7 md:h-5 md:w-5 text-primary-foreground" />
            )}
            {state === "listening" && (
              <MicOff className="h-7 w-7 md:h-5 md:w-5 text-white" />
            )}
            {state === "processing" && (
              <Loader2 className="h-7 w-7 md:h-5 md:w-5 text-muted-foreground animate-spin" />
            )}
          </button>
        </div>

        {state === "idle" && (
          <p className="text-xs text-muted-foreground/60 text-center animate-in fade-in duration-500 md:hidden">
            Tap to speak
          </p>
        )}
      </div>
    </>
  );
}
