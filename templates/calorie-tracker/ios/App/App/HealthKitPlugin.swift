import Foundation
import Capacitor
import HealthKit

@objc(HealthKitPlugin)
public class HealthKitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthKitPlugin"
    public let jsName = "HealthKit"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveWeight", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getWorkouts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getLatestWeight", returnType: CAPPluginReturnPromise)
    ]
    
    private let healthStore = HKHealthStore()
    
    // Check if HealthKit is available
    @objc func isAvailable(_ call: CAPPluginCall) {
        let available = HKHealthStore.isHealthDataAvailable()
        call.resolve(["available": available])
    }
    
    // Request authorization for weight and workouts
    @objc func requestAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("HealthKit is not available on this device")
            return
        }
        
        // Types to read
        let typesToRead: Set<HKObjectType> = [
            HKObjectType.workoutType(),
            HKObjectType.quantityType(forIdentifier: .activeEnergyBurned)!,
            HKObjectType.quantityType(forIdentifier: .bodyMass)!
        ]
        
        // Types to write
        let typesToWrite: Set<HKSampleType> = [
            HKSampleType.quantityType(forIdentifier: .bodyMass)!
        ]
        
        healthStore.requestAuthorization(toShare: typesToWrite, read: typesToRead) { success, error in
            DispatchQueue.main.async {
                if let error = error {
                    call.reject("Authorization failed: \(error.localizedDescription)")
                } else {
                    call.resolve(["authorized": success])
                }
            }
        }
    }
    
    // Save weight to HealthKit
    @objc func saveWeight(_ call: CAPPluginCall) {
        guard let weightLbs = call.getDouble("weight") else {
            call.reject("Weight value is required")
            return
        }
        
        let dateString = call.getString("date")
        let date: Date
        if let dateString = dateString {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withFullDate]
            date = formatter.date(from: dateString) ?? Date()
        } else {
            date = Date()
        }
        
        guard let weightType = HKQuantityType.quantityType(forIdentifier: .bodyMass) else {
            call.reject("Weight type not available")
            return
        }
        
        // Convert pounds to kilograms for HealthKit
        let weightKg = weightLbs * 0.453592
        let weightQuantity = HKQuantity(unit: HKUnit.gramUnit(with: .kilo), doubleValue: weightKg)
        let weightSample = HKQuantitySample(type: weightType, quantity: weightQuantity, start: date, end: date)
        
        healthStore.save(weightSample) { success, error in
            DispatchQueue.main.async {
                if let error = error {
                    call.reject("Failed to save weight: \(error.localizedDescription)")
                } else {
                    call.resolve(["saved": success, "weightLbs": weightLbs, "weightKg": weightKg])
                }
            }
        }
    }
    
    // Get latest weight from HealthKit
    @objc func getLatestWeight(_ call: CAPPluginCall) {
        guard let weightType = HKQuantityType.quantityType(forIdentifier: .bodyMass) else {
            call.reject("Weight type not available")
            return
        }
        
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
        let query = HKSampleQuery(sampleType: weightType, predicate: nil, limit: 1, sortDescriptors: [sortDescriptor]) { _, samples, error in
            DispatchQueue.main.async {
                if let error = error {
                    call.reject("Failed to get weight: \(error.localizedDescription)")
                    return
                }
                
                guard let sample = samples?.first as? HKQuantitySample else {
                    call.resolve(["weight": nil])
                    return
                }
                
                let weightKg = sample.quantity.doubleValue(for: HKUnit.gramUnit(with: .kilo))
                let weightLbs = weightKg / 0.453592
                
                let formatter = ISO8601DateFormatter()
                formatter.formatOptions = [.withFullDate]
                let dateString = formatter.string(from: sample.endDate)
                
                call.resolve([
                    "weight": weightLbs,
                    "date": dateString,
                    "weightKg": weightKg
                ])
            }
        }
        
        healthStore.execute(query)
    }
    
    // Get workouts from HealthKit
    @objc func getWorkouts(_ call: CAPPluginCall) {
        let daysBack = call.getInt("daysBack") ?? 1
        
        let calendar = Calendar.current
        let endDate = Date()
        guard let startDate = calendar.date(byAdding: .day, value: -daysBack, to: endDate) else {
            call.reject("Invalid date range")
            return
        }
        
        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate, options: .strictStartDate)
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
        
        let query = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: [sortDescriptor]) { _, samples, error in
            DispatchQueue.main.async {
                if let error = error {
                    call.reject("Failed to get workouts: \(error.localizedDescription)")
                    return
                }
                
                guard let workouts = samples as? [HKWorkout] else {
                    call.resolve(["workouts": []])
                    return
                }
                
                let workoutData = workouts.map { workout -> [String: Any] in
                    let formatter = ISO8601DateFormatter()
                    formatter.formatOptions = [.withFullDate]
                    
                    var caloriesBurned: Double = 0
                    if let energyBurned = workout.totalEnergyBurned {
                        caloriesBurned = energyBurned.doubleValue(for: HKUnit.kilocalorie())
                    }
                    
                    let durationMinutes = workout.duration / 60
                    
                    return [
                        "name": workout.workoutActivityType.name,
                        "caloriesBurned": caloriesBurned,
                        "durationMinutes": durationMinutes,
                        "date": formatter.string(from: workout.startDate),
                        "startDate": workout.startDate.timeIntervalSince1970 * 1000,
                        "endDate": workout.endDate.timeIntervalSince1970 * 1000
                    ]
                }
                
                call.resolve(["workouts": workoutData])
            }
        }
        
        healthStore.execute(query)
    }
}

// Extension to get workout activity type name
extension HKWorkoutActivityType {
    var name: String {
        switch self {
        case .running: return "Running"
        case .walking: return "Walking"
        case .cycling: return "Cycling"
        case .swimming: return "Swimming"
        case .hiking: return "Hiking"
        case .yoga: return "Yoga"
        case .functionalStrengthTraining: return "Strength Training"
        case .traditionalStrengthTraining: return "Weight Training"
        case .crossTraining: return "Cross Training"
        case .elliptical: return "Elliptical"
        case .rowing: return "Rowing"
        case .stairClimbing: return "Stair Climbing"
        case .highIntensityIntervalTraining: return "HIIT"
        case .dance: return "Dance"
        case .coreTraining: return "Core Training"
        case .pilates: return "Pilates"
        case .mixedCardio: return "Cardio"
        case .cooldown: return "Cooldown"
        case .other: return "Workout"
        default: return "Exercise"
        }
    }
}
