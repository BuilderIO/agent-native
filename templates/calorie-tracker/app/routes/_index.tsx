import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, addDays, subDays, isSameDay } from "date-fns";
import {
  IconChevronLeft,
  IconChevronRight,
  IconPlus,
  IconToolsKitchen2,
  IconBarbell,
  IconAlertTriangle,
} from "@tabler/icons-react";
import { apiFetch } from "@/lib/api";
import { formatLocalDate } from "@/lib/utils";
import { DailyProgress } from "@/components/DailyProgress";
import { MealCard } from "@/components/MealCard";
import { ExerciseCard } from "@/components/ExerciseCard";
import { AddMealDialog } from "@/components/AddMealDialog";
import { AddExerciseDialog } from "@/components/AddExerciseDialog";
import { WeightTracker } from "@/components/WeightTracker";
import { VoiceDictation } from "@/components/VoiceDictation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import type { Meal, Exercise } from "@shared/types";

export default function IndexPage() {
  const [date, setDate] = useState(new Date());
  const [editingMeal, setEditingMeal] = useState<Meal | null>(null);
  const [editMealDialogOpen, setEditMealDialogOpen] = useState(false);
  const [editingExercise, setEditingExercise] = useState<Exercise | null>(null);
  const [editExerciseDialogOpen, setEditExerciseDialogOpen] = useState(false);
  const queryClient = useQueryClient();

  const dateStr = formatLocalDate(date);

  // Sync current date to navigation state so the agent knows what day the user is viewing
  useEffect(() => {
    apiFetch("/_agent-native/application-state/navigation", {
      method: "PUT",
      body: JSON.stringify({ view: "entry", date: dateStr }),
    }).catch(() => {});
  }, [dateStr]);

  const {
    data: meals,
    isLoading: mealsLoading,
    isError: mealsError,
  } = useQuery<Meal[]>({
    queryKey: ["meals", dateStr],
    queryFn: () => apiFetch(`/api/meals?date=${dateStr}`),
  });

  const {
    data: exercises,
    isLoading: exercisesLoading,
    isError: exercisesError,
  } = useQuery<Exercise[]>({
    queryKey: ["exercises", dateStr],
    queryFn: () => apiFetch(`/api/exercises?date=${dateStr}`),
  });

  const deleteMealMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/meals/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meals"] });
      toast.success("Meal deleted");
    },
  });

  const deleteExerciseMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/exercises/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exercises"] });
      toast.success("Exercise deleted");
    },
  });

  const mealTotals = meals?.reduce(
    (acc, meal) => ({
      calories: acc.calories + meal.calories,
      protein: acc.protein + (meal.protein || 0),
      carbs: acc.carbs + (meal.carbs || 0),
      fat: acc.fat + (meal.fat || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  ) || { calories: 0, protein: 0, carbs: 0, fat: 0 };

  const exerciseTotals = exercises?.reduce(
    (acc, exercise) => ({
      burned: acc.burned + exercise.calories_burned,
    }),
    { burned: 0 },
  ) || { burned: 0 };

  const GOAL_CALORIES = 2000;
  const isLoading = mealsLoading || exercisesLoading;
  const hasError = mealsError || exercisesError;

  return (
    <div className="min-h-screen pb-32 relative z-10">
      <VoiceDictation currentDate={date} />

      <div className="max-w-3xl lg:max-w-6xl mx-auto px-4 py-8 space-y-12">
        {/* Date Navigation */}
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-white/5"
            onClick={() => setDate(subDays(date, 1))}
          >
            <IconChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[160px] text-center px-4 py-2 rounded-full bg-white/[0.03] border border-white/[0.06]">
            <span className="text-sm font-medium text-foreground">
              {isSameDay(date, new Date())
                ? "Today"
                : format(date, "EEEE, MMM d")}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-white/5 disabled:opacity-30"
            onClick={() => setDate(addDays(date, 1))}
            disabled={isSameDay(date, new Date())}
          >
            <IconChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Daily Summary Hero */}
        <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          {hasError && (
            <div className="mb-4 flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3">
              <IconAlertTriangle className="h-5 w-5 shrink-0 text-red-400" />
              <div>
                <p className="text-sm font-medium text-red-400">
                  Unable to load data
                </p>
                <p className="text-xs text-red-400/70">
                  Could not connect to the database. Check your DATABASE_URL
                  configuration.
                </p>
              </div>
            </div>
          )}
          {isLoading ? (
            <Skeleton className="h-[280px] w-full rounded-2xl" />
          ) : (
            <DailyProgress
              totalCalories={mealTotals.calories}
              totalBurnedCalories={exerciseTotals.burned}
              goalCalories={GOAL_CALORIES}
              protein={mealTotals.protein}
              carbs={mealTotals.carbs}
              fat={mealTotals.fat}
            />
          )}
        </section>

        {/* Triple Column Layout */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {/* Meals */}
          <section className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Meals
              </h2>
              {editingMeal ? (
                <AddMealDialog
                  editingMeal={editingMeal}
                  isOpen={editMealDialogOpen}
                  onOpenChange={(open) => {
                    setEditMealDialogOpen(open);
                    if (!open) setEditingMeal(null);
                  }}
                  currentDate={date}
                />
              ) : (
                <AddMealDialog currentDate={date} />
              )}
            </div>
            <div className="space-y-2">
              {isLoading ? (
                <>
                  <Skeleton className="h-16 w-full rounded-xl" />
                  <Skeleton className="h-16 w-full rounded-xl" />
                </>
              ) : mealsError ? (
                <div className="flex flex-col items-center justify-center py-12 text-center rounded-2xl bg-red-500/[0.03] border border-dashed border-red-500/20">
                  <div className="p-3 rounded-full bg-red-500/10 mb-3">
                    <IconAlertTriangle className="h-5 w-5 text-red-400/70" />
                  </div>
                  <p className="text-sm text-red-400/80">
                    Failed to load meals
                  </p>
                </div>
              ) : meals?.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center rounded-2xl bg-white/[0.02] border border-dashed border-white/[0.06]">
                  <div className="p-3 rounded-full bg-emerald-500/10 mb-3">
                    <IconToolsKitchen2 className="h-5 w-5 text-emerald-500/50" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    No meals logged
                  </p>
                  <p className="text-xs text-muted-foreground/50 mt-1">
                    Add your first meal
                  </p>
                </div>
              ) : (
                meals?.map((meal) => (
                  <MealCard
                    key={meal.id}
                    meal={meal}
                    onDelete={(id) => deleteMealMutation.mutate(id)}
                    onEdit={(meal) => {
                      setEditingMeal(meal);
                      setEditMealDialogOpen(true);
                    }}
                    isDeleting={
                      deleteMealMutation.isPending &&
                      deleteMealMutation.variables === meal.id
                    }
                  />
                ))
              )}
            </div>
          </section>

          {/* Exercises */}
          <section className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-200">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Exercise
              </h2>
              {editingExercise ? (
                <AddExerciseDialog
                  editingExercise={editingExercise}
                  isOpen={editExerciseDialogOpen}
                  onOpenChange={(open) => {
                    setEditExerciseDialogOpen(open);
                    if (!open) setEditingExercise(null);
                  }}
                  currentDate={date}
                />
              ) : (
                <AddExerciseDialog currentDate={date} />
              )}
            </div>
            <div className="space-y-2">
              {isLoading ? (
                <Skeleton className="h-16 w-full rounded-xl" />
              ) : exercisesError ? (
                <div className="flex flex-col items-center justify-center py-12 text-center rounded-2xl bg-red-500/[0.03] border border-dashed border-red-500/20">
                  <div className="p-3 rounded-full bg-red-500/10 mb-3">
                    <IconAlertTriangle className="h-5 w-5 text-red-400/70" />
                  </div>
                  <p className="text-sm text-red-400/80">
                    Failed to load exercises
                  </p>
                </div>
              ) : exercises?.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center rounded-2xl bg-white/[0.02] border border-dashed border-white/[0.06]">
                  <div className="p-3 rounded-full bg-orange-500/10 mb-3">
                    <IconBarbell className="h-5 w-5 text-orange-500/50" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    No exercises logged
                  </p>
                  <p className="text-xs text-muted-foreground/50 mt-1">
                    Log activity to burn
                  </p>
                </div>
              ) : (
                exercises?.map((exercise) => (
                  <ExerciseCard
                    key={exercise.id}
                    exercise={exercise}
                    onDelete={(id) => deleteExerciseMutation.mutate(id)}
                    onEdit={(exercise) => {
                      setEditingExercise(exercise);
                      setEditExerciseDialogOpen(true);
                    }}
                    isDeleting={
                      deleteExerciseMutation.isPending &&
                      deleteExerciseMutation.variables === exercise.id
                    }
                  />
                ))
              )}
            </div>
          </section>

          {/* Weight */}
          <section className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300">
            <WeightTracker currentDate={date} />
          </section>
        </div>
      </div>
    </div>
  );
}
