import {
  useActionQuery,
  useActionMutation,
  useT,
} from "@agent-native/core/client";
import type { Meal, Exercise } from "@shared/types";
import {
  IconChevronLeft,
  IconChevronRight,
  IconToolsKitchen2,
  IconBarbell,
} from "@tabler/icons-react";
import { format, addDays, subDays, isSameDay } from "date-fns";
import { useState, useEffect } from "react";
import { toast } from "sonner";

import { AddExerciseDialog } from "@/components/AddExerciseDialog";
import { AddMealDialog } from "@/components/AddMealDialog";
import { DailyProgress } from "@/components/DailyProgress";
import { ExerciseCard } from "@/components/ExerciseCard";
import { MealCard } from "@/components/MealCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { VoiceDictation } from "@/components/VoiceDictation";
import { WeightTracker } from "@/components/WeightTracker";
import {
  getLogRowKey,
  isOptimisticLogRow,
  useOptimisticLogRows,
} from "@/hooks/use-optimistic-log-rows";
import messages from "@/i18n/en-US";
import { apiFetch } from "@/lib/api";
import { formatLocalDate } from "@/lib/utils";

const SEO_TITLE = messages.seo.homeTitle;
const SEO_DESCRIPTION = messages.seo.homeDescription;

export function meta() {
  return [
    { title: SEO_TITLE },
    {
      name: "description",
      content: SEO_DESCRIPTION,
    },
    { property: "og:title", content: SEO_TITLE },
    { property: "og:description", content: SEO_DESCRIPTION },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: SEO_TITLE },
    { name: "twitter:description", content: SEO_DESCRIPTION },
  ];
}

export default function IndexPage() {
  const t = useT();
  const [date, setDate] = useState(new Date());
  const [editingMeal, setEditingMeal] = useState<Meal | null>(null);
  const [editMealDialogOpen, setEditMealDialogOpen] = useState(false);
  const [editingExercise, setEditingExercise] = useState<Exercise | null>(null);
  const [editExerciseDialogOpen, setEditExerciseDialogOpen] = useState(false);

  const dateStr = formatLocalDate(date);

  // Sync current date to navigation state so the agent knows what day the user is viewing
  useEffect(() => {
    apiFetch("/_agent-native/application-state/navigation", {
      method: "PUT",
      body: JSON.stringify({ view: "entry", date: dateStr }),
    }).catch(() => {});
  }, [dateStr]);

  const { data: rawMeals, isLoading: mealsLoading } = useActionQuery(
    "list-meals",
    { date: dateStr },
  );
  const serverMeals = Array.isArray(rawMeals) ? rawMeals : [];
  const { rows: meals, hasOptimisticRows: hasOptimisticMeals } =
    useOptimisticLogRows("meal", serverMeals, dateStr);

  const { data: rawExercises, isLoading: exercisesLoading } = useActionQuery(
    "list-exercises",
    { date: dateStr },
  );
  const serverExercises = Array.isArray(rawExercises) ? rawExercises : [];
  const { rows: exercises, hasOptimisticRows: hasOptimisticExercises } =
    useOptimisticLogRows("exercise", serverExercises, dateStr);

  const deleteMealMutation = useActionMutation("delete-meal", {
    onSuccess: () => {
      toast.success(t("meals.deleted"));
    },
    onError: () => toast.error(t("meals.deleteFailed")),
  });

  const deleteExerciseMutation = useActionMutation("delete-exercise", {
    onSuccess: () => {
      toast.success(t("exercise.deleted"));
    },
    onError: () => toast.error(t("exercise.deleteFailed")),
  });

  const mealTotals = meals.reduce(
    (acc, meal) => ({
      calories: acc.calories + meal.calories,
      protein: acc.protein + (meal.protein || 0),
      carbs: acc.carbs + (meal.carbs || 0),
      fat: acc.fat + (meal.fat || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );

  const exerciseTotals = exercises.reduce(
    (acc, exercise) => ({
      burned: acc.burned + exercise.calories_burned,
    }),
    { burned: 0 },
  );

  const GOAL_CALORIES = 2000;
  const hasOptimisticLogs = hasOptimisticMeals || hasOptimisticExercises;
  const isLoading = (mealsLoading || exercisesLoading) && !hasOptimisticLogs;

  return (
    <div className="min-h-screen pb-32 relative z-10">
      <VoiceDictation currentDate={date} />

      <div className="macros-entry-container max-w-3xl lg:max-w-6xl mx-auto px-3 sm:px-4 py-6 sm:py-8 space-y-8 sm:space-y-12">
        {/* Date Navigation */}
        <div className="flex items-center justify-center gap-1 sm:gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 sm:h-8 sm:w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent"
            onClick={() => setDate(subDays(date, 1))}
          >
            <IconChevronLeft className="h-5 w-5 sm:h-4 sm:w-4 rtl:-scale-x-100" />
          </Button>
          <div className="min-w-[140px] sm:min-w-[160px] text-center px-3 sm:px-4 py-2 rounded-full bg-card border border-border">
            <span className="text-sm font-medium text-foreground">
              {isSameDay(date, new Date())
                ? t("entry.today")
                : format(date, "EEE, MMM d")}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 sm:h-8 sm:w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30"
            onClick={() => setDate(addDays(date, 1))}
            disabled={isSameDay(date, new Date())}
          >
            <IconChevronRight className="h-5 w-5 sm:h-4 sm:w-4 rtl:-scale-x-100" />
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
        <div className="macros-entry-grid">
          {/* Meals */}
          <section className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t("meals.title")}
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
              {mealsLoading && !hasOptimisticMeals ? (
                <>
                  <Skeleton className="h-16 w-full rounded-xl" />
                  <Skeleton className="h-16 w-full rounded-xl" />
                </>
              ) : meals.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center rounded-2xl bg-card border border-dashed border-border">
                  <div className="p-3 rounded-full bg-emerald-500/10 mb-3">
                    <IconToolsKitchen2 className="h-5 w-5 text-emerald-500/50" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t("meals.noneLogged")}
                  </p>
                  <p className="text-xs text-muted-foreground/50 mt-1">
                    {t("meals.emptyDescription")}
                  </p>
                </div>
              ) : (
                meals.map((meal) => (
                  <MealCard
                    key={getLogRowKey(meal)}
                    meal={meal}
                    onDelete={(id) =>
                      deleteMealMutation.mutate({ id: String(id) })
                    }
                    onEdit={(meal) => {
                      setEditingMeal(meal);
                      setEditMealDialogOpen(true);
                    }}
                    isDeleting={
                      deleteMealMutation.isPending &&
                      deleteMealMutation.variables?.id === String(meal.id)
                    }
                    isPending={isOptimisticLogRow(meal)}
                  />
                ))
              )}
            </div>
          </section>

          {/* Exercises */}
          <section className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-200">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t("exercise.title")}
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
              {exercisesLoading && !hasOptimisticExercises ? (
                <Skeleton className="h-16 w-full rounded-xl" />
              ) : exercises.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center rounded-2xl bg-card border border-dashed border-border">
                  <div className="p-3 rounded-full bg-orange-500/10 mb-3">
                    <IconBarbell className="h-5 w-5 text-orange-500/50" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t("exercise.noneLogged")}
                  </p>
                  <p className="text-xs text-muted-foreground/50 mt-1">
                    {t("exercise.emptyDescription")}
                  </p>
                </div>
              ) : (
                exercises.map((exercise) => (
                  <ExerciseCard
                    key={getLogRowKey(exercise)}
                    exercise={exercise}
                    onDelete={(id) =>
                      deleteExerciseMutation.mutate({ id: String(id) })
                    }
                    onEdit={(exercise) => {
                      setEditingExercise(exercise);
                      setEditExerciseDialogOpen(true);
                    }}
                    isDeleting={
                      deleteExerciseMutation.isPending &&
                      deleteExerciseMutation.variables?.id ===
                        String(exercise.id)
                    }
                    isPending={isOptimisticLogRow(exercise)}
                  />
                ))
              )}
            </div>
          </section>

          {/* Weight */}
          <section className="macros-weight-section animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300">
            <WeightTracker currentDate={date} />
          </section>
        </div>
      </div>
    </div>
  );
}
