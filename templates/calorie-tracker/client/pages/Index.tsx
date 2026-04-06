import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, addDays, subDays, isSameDay } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Utensils,
  Dumbbell,
} from "lucide-react";
import { Meal } from "@shared/api";
import { apiRequest } from "@/lib/queryClient";
import { DailyProgress } from "@/components/DailyProgress";
import { MealCard } from "@/components/MealCard";
import { ExerciseCard } from "@/components/ExerciseCard";
import { AddMealDialog } from "@/components/AddMealDialog";
import { AddExerciseDialog } from "@/components/AddExerciseDialog";
import { WeightTracker } from "@/components/WeightTracker";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { AppHeader } from "@/components/AppHeader";
import { VoiceDictation } from "@/components/VoiceDictation";
import { DebugPanel } from "@/components/DebugPanel";
import { formatLocalDate } from "@/lib/utils";

export default function Index() {
  const [date, setDate] = useState(new Date());
  const [editingMeal, setEditingMeal] = useState<Meal | null>(null);
  const [editMealDialogOpen, setEditMealDialogOpen] = useState(false);
  const [editingExercise, setEditingExercise] = useState<any | null>(null);
  const [editExerciseDialogOpen, setEditExerciseDialogOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const dateStr = formatLocalDate(date);

  const { data: meals, isLoading: mealsLoading } = useQuery<Meal[]>({
    queryKey: ["/api/meals", dateStr],
    queryFn: async () => {
      return await apiRequest("GET", `/api/meals?date=${dateStr}`);
    },
  });

  const { data: exercises, isLoading: exercisesLoading } = useQuery<any[]>({
    queryKey: ["/api/exercises", dateStr],
    queryFn: async () => {
      return await apiRequest("GET", `/api/exercises?date=${dateStr}`);
    },
  });

  const deleteMealMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/meals/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meals"] });
      toast({ title: "Meal deleted" });
    },
  });

  const deleteExerciseMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/exercises/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/exercises"] });
      toast({ title: "Exercise deleted" });
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

  return (
    <div className="min-h-screen pb-32 relative z-10">
      <AppHeader />

      {/* Voice Dictation FAB */}
      <VoiceDictation currentDate={date} />

      {/* Debug Panel (dev mode only) */}
      {import.meta.env.DEV && <DebugPanel />}

      <main className="max-w-3xl lg:max-w-6xl mx-auto px-4 py-8 space-y-12">
        {/* Date Navigation */}
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-white/5"
            onClick={() => setDate(subDays(date, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
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
            className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
            onClick={() => setDate(addDays(date, 1))}
            disabled={isSameDay(date, new Date())}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Daily Summary Hero */}
        <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
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
          {/* Meals List */}
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
                    if (!open) {
                      setEditingMeal(null);
                    }
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
              ) : meals?.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center rounded-2xl bg-white/[0.02] border border-dashed border-white/[0.06]">
                  <div className="p-3 rounded-full bg-emerald-500/10 mb-3">
                    <Utensils className="h-5 w-5 text-emerald-500/50" />
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

          {/* Exercises List */}
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
                    if (!open) {
                      setEditingExercise(null);
                    }
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
              ) : exercises?.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center rounded-2xl bg-white/[0.02] border border-dashed border-white/[0.06]">
                  <div className="p-3 rounded-full bg-orange-500/10 mb-3">
                    <Dumbbell className="h-5 w-5 text-orange-500/50" />
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

          {/* Weight Tracker Section */}
          <section className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300">
            <WeightTracker currentDate={date} />
          </section>
        </div>
      </main>
    </div>
  );
}
