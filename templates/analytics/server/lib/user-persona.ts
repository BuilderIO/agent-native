export type PersonaType = "analytics" | "dept_head" | "regular";

export interface UserPersona {
  userId: string;
  email: string;
  persona: PersonaType;
  department?: string;
  assignedAt: Date;
  changedAt?: Date;
}

// In-memory storage for personas
const personaStore = new Map<string, UserPersona>();

/**
 * Get user persona from in-memory store
 */
export async function getUserPersona(
  userId: string,
): Promise<UserPersona | null> {
  try {
    return personaStore.get(userId) || null;
  } catch (error) {
    console.error("Error getting user persona:", error);
    return null;
  }
}

/**
 * Get user persona by email (for Notion contributor mapping)
 */
export async function getUserPersonaByEmail(
  email: string,
): Promise<UserPersona | null> {
  try {
    for (const persona of personaStore.values()) {
      if (persona.email === email) {
        return persona;
      }
    }
    return null;
  } catch (error) {
    console.error("Error getting user persona by email:", error);
    return null;
  }
}

/**
 * Set user persona in Firestore and log to BigQuery
 */
export async function setUserPersona(
  userId: string,
  persona: PersonaType,
  email: string,
  department?: string,
): Promise<void> {
  try {
    console.log("Setting user persona:", {
      userId,
      persona,
      email,
      department,
    });

    const userPersona: UserPersona = {
      userId,
      email,
      persona,
      department: department || "General",
      assignedAt: new Date(),
    };

    // Store in memory (temporary solution until we have Firestore permissions)
    personaStore.set(userId, userPersona);
    console.log("Saved persona to memory store");

    // Log to BigQuery for analytics (currently just console log)
    await logPersonaAssignment({
      userId,
      email,
      persona,
      previousPersona: undefined,
      department: department || "General",
    });

    console.log("Successfully set persona for user:", userId);
  } catch (error) {
    console.error("Error setting user persona:", error);
    throw error;
  }
}

/**
 * Check if user can edit specific field based on persona
 */
export function canEditField(
  persona: PersonaType | undefined,
  fieldName: string,
): boolean {
  // Analytics team can edit everything
  if (persona === "analytics") return true;

  // Business fields that department heads can edit
  const BUSINESS_FIELDS = [
    "Definition",
    "CommonQuestions",
    "KnownGotchas",
    "ExampleUseCase",
    "Owner",
    "Department",
    "Cuts",
  ];

  // Department heads can edit business fields
  if (persona === "dept_head") return BUSINESS_FIELDS.includes(fieldName);

  // Regular users cannot edit Notion directly (only validate via UI)
  return false;
}

/**
 * Log persona assignment to BigQuery
 */
async function logPersonaAssignment(params: {
  userId: string;
  email: string;
  persona: PersonaType;
  previousPersona?: PersonaType;
  department?: string;
}): Promise<void> {
  try {
    const { userId, email, persona, previousPersona, department } = params;

    // Note: This would typically use BigQuery insertAll API
    // For now, we'll just log it. In production, implement proper BigQuery insert
    console.log("Persona assignment:", {
      id: `${userId}-${Date.now()}`,
      timestamp: new Date().toISOString(),
      user_email: email,
      user_id: userId,
      persona,
      previous_persona: previousPersona || null,
      department: department || null,
    });

    // TODO: Implement actual BigQuery insert
    // const { BigQuery } = require('@google-cloud/bigquery');
    // const bigquery = new BigQuery();
    // await bigquery.dataset('logs').table('persona_assignments').insert([...]);
  } catch (error) {
    console.error("Error logging persona assignment:", error);
  }
}

/**
 * Get all users with personas (for admin/analytics)
 */
export async function getAllUserPersonas(): Promise<UserPersona[]> {
  try {
    return Array.from(personaStore.values());
  } catch (error) {
    console.error("Error getting all user personas:", error);
    return [];
  }
}
