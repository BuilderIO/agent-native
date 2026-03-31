import { useNavigate } from "react-router";
import { IconArrowLeft } from "@tabler/icons-react";

export function meta() {
  return [{ title: "Not Found — Recruiting" }];
}

export default function CatchAll() {
  const navigate = useNavigate();

  return (
    <div className="h-full flex flex-col items-center justify-center text-center">
      <p className="text-4xl font-bold text-muted-foreground/20 mb-2">404</p>
      <p className="text-sm font-medium text-foreground mb-1">Page not found</p>
      <p className="text-xs text-muted-foreground mb-4">
        The page you're looking for doesn't exist.
      </p>
      <button
        onClick={() => navigate("/dashboard")}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
      >
        <IconArrowLeft className="h-3.5 w-3.5" />
        Go to Dashboard
      </button>
    </div>
  );
}
