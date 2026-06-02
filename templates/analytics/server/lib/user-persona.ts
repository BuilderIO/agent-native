export type PersonaType = "analytics" | "dept_head" | "regular";

export interface UserPersona {
  userId: string;
  email: string;
  persona: PersonaType;
  department?: string;
  assignedAt: Date;
  changedAt?: Date;
}

const personaStore = new Map<string, UserPersona>();

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

export async function setUserPersona(
  userId: string,
  persona: PersonaType,
  email: string,
  department?: string,
): Promise<void> {
  try {
    const userPersona: UserPersona = {
      userId,
      email,
      persona,
      department: department || "General",
      assignedAt: new Date(),
    };

    personaStore.set(userId, userPersona);
  } catch (error) {
    console.error("Error setting user persona:", error);
    throw error;
  }
}

export function canEditField(
  persona: PersonaType | undefined,
  fieldName: string,
): boolean {
  if (persona === "analytics") return true;

  const BUSINESS_FIELDS = [
    "Definition",
    "CommonQuestions",
    "KnownGotchas",
    "ExampleUseCase",
    "Owner",
    "Department",
    "Cuts",
  ];

  if (persona === "dept_head") return BUSINESS_FIELDS.includes(fieldName);

  return false;
}

export async function getAllUserPersonas(): Promise<UserPersona[]> {
  try {
    return Array.from(personaStore.values());
  } catch (error) {
    console.error("Error getting all user personas:", error);
    return [];
  }
}
