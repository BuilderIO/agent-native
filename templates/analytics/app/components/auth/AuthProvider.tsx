import { createContext, useContext, type ReactNode } from "react";
import { useSession, type AuthSession } from "@agent-native/core";

interface AuthContextValue {
  auth: AuthSession | null;
  isLoading: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { session, isLoading } = useSession();

  const value: AuthContextValue = {
    auth: session,
    isLoading,
    logout: () =>
      fetch("/_agent-native/auth/logout", { method: "POST" }).then(() =>
        location.reload(),
      ),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
