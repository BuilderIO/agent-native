import { useLocation, Link } from "react-router";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname,
    );
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950">
      <div className="text-center">
        <h1 className="text-5xl font-bold text-white/20 mb-3">404</h1>
        <p className="text-base text-white/50 mb-6">
          This page doesn't exist yet. Continue prompting to build it out.
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
        >
          Back to Studio
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
