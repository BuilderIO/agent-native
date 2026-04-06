import { Meal } from "../shared/api";

export interface IStorage {
  getMeals(date: string): Promise<Meal[]>;
  addMeal(meal: Meal): Promise<Meal>;
  deleteMeal(id: number): Promise<void>;
}

export class MemStorage implements IStorage {
  private meals: Map<number, Meal>;
  private currentId: number;

  constructor() {
    this.meals = new Map();
    this.currentId = 1;

    // Add some dummy data for today
    const today = new Date().toISOString().split("T")[0];
    this.addMeal({
      name: "Oatmeal with Berries",
      calories: 350,
      protein: 12,
      carbs: 60,
      fat: 6,
      date: today,
      notes: "Morning breakfast",
    });
    this.addMeal({
      name: "Grilled Chicken Salad",
      calories: 450,
      protein: 40,
      carbs: 15,
      fat: 20,
      date: today,
      notes: "Lunch",
    });
  }

  async getMeals(date: string): Promise<Meal[]> {
    // Simple filter by date string match
    return Array.from(this.meals.values()).filter((meal) =>
      meal.date.startsWith(date),
    );
  }

  async addMeal(meal: Meal): Promise<Meal> {
    const id = this.currentId++;
    const newMeal = { ...meal, id };
    this.meals.set(id, newMeal);
    return newMeal;
  }

  async deleteMeal(id: number): Promise<void> {
    this.meals.delete(id);
  }
}

export const storage = new MemStorage();
