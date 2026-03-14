import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { authFetch } from "@/lib/auth-fetch";

interface BuilderAuth {
  privateKey: string;
  apiKey: string;
  orgName: string;
  userId: string;
}

interface BuilderAuthContextValue {
  auth: BuilderAuth | null;
  isConnected: boolean;
  connect: () => void;
  disconnect: () => void;
}

const BuilderAuthContext = createContext<BuilderAuthContextValue>({
  auth: null,
  isConnected: false,
  connect: () => {},
  disconnect: () => {},
});

const STORAGE_KEYS = {
  privateKey: "builder_private_key",
  apiKey: "builder_api_key",
  orgName: "builder_org_name",
  userId: "builder_user_id",
} as const;

function loadAuth(): BuilderAuth | null {
  const privateKey = localStorage.getItem(STORAGE_KEYS.privateKey);
  const apiKey = localStorage.getItem(STORAGE_KEYS.apiKey);
  if (!privateKey || !apiKey) return null;
  return {
    privateKey,
    apiKey,
    orgName: localStorage.getItem(STORAGE_KEYS.orgName) || "",
    userId: localStorage.getItem(STORAGE_KEYS.userId) || "",
  };
}

function saveAuth(auth: BuilderAuth) {
  localStorage.setItem(STORAGE_KEYS.privateKey, auth.privateKey);
  localStorage.setItem(STORAGE_KEYS.apiKey, auth.apiKey);
  localStorage.setItem(STORAGE_KEYS.orgName, auth.orgName);
  localStorage.setItem(STORAGE_KEYS.userId, auth.userId);
  authFetch("/api/builder/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey: auth.apiKey, privateKey: auth.privateKey }),
  }).catch(console.error);
}

function clearAuthData() {
  Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
  authFetch("/api/builder/auth", { method: "DELETE" }).catch(console.error);
}

export function BuilderAuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<BuilderAuth | null>(loadAuth);

  useEffect(() => {
    if (auth) {
      authFetch("/api/builder/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: auth.apiKey,
          privateKey: auth.privateKey,
        }),
      }).catch(console.error);
    }
  }, [auth]);

  const connect = useCallback(() => {
    const redirectUrl = `${window.location.origin}/builder-callback`;
    const url = `https://builder.io/cli-auth?response_type=code&client_id=Content+Workspace&host=content-workspace&redirect_url=${encodeURIComponent(redirectUrl)}`;
    window.location.href = url;
  }, []);

  const disconnect = useCallback(() => {
    clearAuthData();
    setAuth(null);
  }, []);

  return (
    <BuilderAuthContext.Provider
      value={{ auth, isConnected: !!auth, connect, disconnect }}
    >
      {children}
    </BuilderAuthContext.Provider>
  );
}

export function useBuilderAuth() {
  return useContext(BuilderAuthContext);
}
