import { Link, useLocation } from "react-router";
import { useEffect } from "react";
import { IconArrowLeft } from "@tabler/icons-react";

export default function NotFound() {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-foreground/10 mb-2">404</h1>
        <p className="text-sm text-muted-foreground mb-6">
          This page doesn't exist yet.
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent/80 text-sm text-accent-foreground transition-colors"
        >
          <IconArrowLeft className="w-4 h-4" />
          Back to Calendar
        </Link>
      </div>
    </div>
  );
}
