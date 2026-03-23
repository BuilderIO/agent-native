import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GraduationCap, Briefcase, User, CheckCircle } from "lucide-react";
import { getIdToken } from "@/lib/auth";

interface PersonaSelectionModalProps {
  open: boolean;
  onSelect: (persona: string) => void;
}

const personas = [
  {
    id: "analytics",
    icon: GraduationCap,
    title: "Analytics Team",
    badge: "Full Access",
    badgeColor: "bg-purple-500",
    description:
      "Create SQL templates, business definitions, and technical documentation",
    capabilities: [
      "Add SQL query templates",
      "Create join patterns",
      "Write technical documentation",
      "Define all metric fields",
    ],
    gradient: "from-purple-500/10 to-blue-500/10",
    borderColor: "border-purple-500/30",
  },
  {
    id: "dept_head",
    icon: Briefcase,
    title: "Department Head",
    badge: "Business Focus",
    badgeColor: "bg-blue-500",
    description:
      "Define business meaning and route technical work to analytics",
    capabilities: [
      "Write business definitions",
      "Add common questions",
      "Assign metric owners",
      "Flag metrics needing SQL",
    ],
    gradient: "from-blue-500/10 to-cyan-500/10",
    borderColor: "border-blue-500/30",
  },
  {
    id: "regular",
    icon: User,
    title: "Regular User",
    badge: "Validate Data",
    badgeColor: "bg-green-500",
    description: "Help ensure metrics are accurate by validating data quality",
    capabilities: [
      "Rate metric accuracy",
      "Flag incorrect data",
      "Suggest improvements",
      "Quick 2-minute contributions",
    ],
    gradient: "from-green-500/10 to-emerald-500/10",
    borderColor: "border-green-500/30",
  },
];

export function PersonaSelectionModal({
  open,
  onSelect,
}: PersonaSelectionModalProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSelect = async () => {
    if (!selected || isSubmitting) return;

    setIsSubmitting(true);

    try {
      const token = await getIdToken();
      console.log("Setting persona:", selected);
      console.log("Token exists:", !!token);

      const response = await fetch("/api/gamification/persona", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ persona: selected }),
      });

      console.log("Response status:", response.status);

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Error response:", errorData);
        throw new Error(errorData.error || "Failed to set persona");
      }

      const data = await response.json();
      console.log("Success response:", data);

      // Store in localStorage as backup
      localStorage.setItem("userPersona", selected);

      onSelect(selected);
    } catch (error) {
      console.error("Error setting persona:", error);
      alert(
        `Failed to set persona: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            How would you like to contribute?
          </DialogTitle>
          <DialogDescription className="text-base">
            Choose your role to unlock the right contribution types for you. You
            can change this later in settings.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 py-4">
          {personas.map((persona) => {
            const Icon = persona.icon;
            const isSelected = selected === persona.id;

            return (
              <Card
                key={persona.id}
                className={`cursor-pointer transition-all hover:shadow-lg ${
                  isSelected
                    ? `ring-2 ring-primary ${persona.borderColor}`
                    : "border-border"
                } bg-gradient-to-br ${persona.gradient}`}
                onClick={() => setSelected(persona.id)}
              >
                <CardContent className="pt-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <Icon className="h-8 w-8 text-primary" />
                    {isSelected && (
                      <CheckCircle className="h-5 w-5 text-primary" />
                    )}
                  </div>

                  <div className="space-y-2">
                    <h3 className="font-semibold text-lg">{persona.title}</h3>
                    <Badge className={`${persona.badgeColor} text-white`}>
                      {persona.badge}
                    </Badge>
                  </div>

                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {persona.description}
                  </p>

                  <div className="space-y-2 pt-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      What you can do:
                    </p>
                    <ul className="space-y-1.5 text-xs">
                      {persona.capabilities.map((cap, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-primary mt-0.5">•</span>
                          <span>{cap}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="flex items-center justify-between pt-4 border-t">
          <p className="text-xs text-muted-foreground">
            💡 Tip: Start with what feels comfortable. You can always change
            your role later.
          </p>
          <Button
            onClick={handleSelect}
            disabled={!selected || isSubmitting}
            size="lg"
          >
            {isSubmitting ? "Setting up..." : "Continue"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
