import { createContext, useContext, type ReactNode } from "react";
import { type BuilderAuth } from "@/lib/auth";

interface AuthContextValue {
  auth: BuilderAuth | null;
  isLoading: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // No authentication — always treat the user as logged in.
  const value: AuthContextValue = {
    auth: { email: "local@localhost" },
    isLoading: false,
    logout: () => {},
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
