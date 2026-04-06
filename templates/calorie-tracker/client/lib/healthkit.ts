import { registerPlugin } from '@capacitor/core';

// Define the plugin interface
export interface HealthKitPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  requestAuthorization(): Promise<{ authorized: boolean }>;
  saveWeight(options: { weight: number; date?: string }): Promise<{ saved: boolean; weightLbs: number; weightKg: number }>;
  getLatestWeight(): Promise<{ weight: number | null; date?: string; weightKg?: number }>;
  getWorkouts(options?: { daysBack?: number }): Promise<{ workouts: Workout[] }>;
}

export interface Workout {
  name: string;
  caloriesBurned: number;
  durationMinutes: number;
  date: string;
  startDate: number;
  endDate: number;
}

// Register the plugin - only available on iOS native app
const HealthKit = registerPlugin<HealthKitPlugin>('HealthKit');

// Check if we're running in native iOS app
export function isNativeApp(): boolean {
  return typeof (window as any).Capacitor !== 'undefined' && 
         (window as any).Capacitor.isNativePlatform?.() === true &&
         (window as any).Capacitor.getPlatform?.() === 'ios';
}

// HealthKit service with fallbacks for web
export const healthKitService = {
  // Check if HealthKit is available (iOS native app only)
  async isAvailable(): Promise<boolean> {
    if (!isNativeApp()) {
      return false;
    }
    try {
      const result = await HealthKit.isAvailable();
      return result.available;
    } catch (error) {
      console.error('HealthKit availability check failed:', error);
      return false;
    }
  },

  // Request authorization for HealthKit
  async requestAuthorization(): Promise<boolean> {
    if (!isNativeApp()) {
      return false;
    }
    try {
      const result = await HealthKit.requestAuthorization();
      return result.authorized;
    } catch (error) {
      console.error('HealthKit authorization failed:', error);
      return false;
    }
  },

  // Save weight to HealthKit
  async saveWeight(weightLbs: number, date?: string): Promise<boolean> {
    if (!isNativeApp()) {
      return false;
    }
    try {
      const result = await HealthKit.saveWeight({ weight: weightLbs, date });
      return result.saved;
    } catch (error) {
      console.error('Failed to save weight to HealthKit:', error);
      return false;
    }
  },

  // Get latest weight from HealthKit
  async getLatestWeight(): Promise<{ weight: number; date: string } | null> {
    if (!isNativeApp()) {
      return null;
    }
    try {
      const result = await HealthKit.getLatestWeight();
      if (result.weight !== null && result.date) {
        return { weight: result.weight, date: result.date };
      }
      return null;
    } catch (error) {
      console.error('Failed to get weight from HealthKit:', error);
      return null;
    }
  },

  // Get workouts from HealthKit
  async getWorkouts(daysBack: number = 1): Promise<Workout[]> {
    if (!isNativeApp()) {
      return [];
    }
    try {
      const result = await HealthKit.getWorkouts({ daysBack });
      return result.workouts || [];
    } catch (error) {
      console.error('Failed to get workouts from HealthKit:', error);
      return [];
    }
  }
};

export default healthKitService;
