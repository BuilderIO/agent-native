import { useEffect, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";

export default function BuilderCallback() {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const privateKey = params.get("p-key");
    const apiKey = params.get("api-key");
    const orgName = params.get("org-name");
    const userId = params.get("user-id");

    if (!privateKey || !apiKey) {
      setStatus("error");
      setErrorMsg("Missing authentication keys from Builder.io. Please try again.");
      return;
    }

    localStorage.setItem("builder_private_key", privateKey);
    localStorage.setItem("builder_api_key", apiKey);
    if (orgName) localStorage.setItem("builder_org_name", orgName);
    if (userId) localStorage.setItem("builder_user_id", userId);

    authFetch("/api/builder/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, privateKey }),
    }).catch(console.error);

    setStatus("success");

    // Redirect back to the app
    setTimeout(() => {
      window.location.href = "/";
    }, 1000);
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="text-center p-8 max-w-md">
        {status === "loading" && (
          <p className="text-muted-foreground">Connecting to Builder.io...</p>
        )}
        {status === "success" && (
          <>
            <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-2">Connected to Builder.io</h2>
            <p className="text-sm text-muted-foreground">This window will close automatically.</p>
          </>
        )}
        {status === "error" && (
          <>
            <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-2">Connection Failed</h2>
            <p className="text-sm text-muted-foreground">{errorMsg}</p>
          </>
        )}
      </div>
    </div>
  );
}
