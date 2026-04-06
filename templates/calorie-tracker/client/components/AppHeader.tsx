import { Link, useLocation, useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { useAuth } from "@/lib/authContext";
import { useToast } from "@/hooks/use-toast";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function AppHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { toast } = useToast();

  const handleLogout = async () => {
    try {
      await signOut();
      navigate("/login");
    } catch (error) {
      toast({
        title: "Logout failed",
        variant: "destructive",
      });
    }
  };

  const isEntry = location.pathname === "/";
  const isAnalytics = location.pathname === "/analytics";

  return (
    <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-md border-b border-white/[0.08] px-4 py-3">
      <div className="max-w-3xl lg:max-w-6xl mx-auto flex items-center justify-between">
        <Logo className="text-xl" />

        {/* Tab Navigation - Centered */}
        <nav className="absolute left-1/2 -translate-x-1/2 flex items-center p-1 rounded-lg bg-white/[0.02] border border-white/[0.06]">
          <Link to="/">
            <button
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${
                isEntry
                  ? "text-foreground bg-white/[0.08] shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/[0.02]"
              }`}
            >
              Entry
            </button>
          </Link>
          <Link to="/analytics">
            <button
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${
                isAnalytics
                  ? "text-foreground bg-white/[0.08] shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/[0.02]"
              }`}
            >
              Analytics
            </button>
          </Link>
        </nav>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5"
              onClick={handleLogout}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Logout</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
