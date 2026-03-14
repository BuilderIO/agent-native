import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(240,6%,4%)]">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-white/10 mb-2">404</h1>
        <p className="text-sm text-white/40 mb-6">
          This page doesn't exist yet.
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-sm text-white/70 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Decks
        </Link>
      </div>
    </div>
  );
}
