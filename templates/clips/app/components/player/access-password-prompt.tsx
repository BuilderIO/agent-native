import { useState } from "react";
import { IconLock } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface AccessPasswordPromptProps {
  onSubmit: (password: string) => void;
  error?: string | null;
  title?: string;
}

export function AccessPasswordPrompt({
  onSubmit,
  error,
  title,
}: AccessPasswordPromptProps) {
  const [value, setValue] = useState("");

  return (
    <div className="flex items-center justify-center min-h-screen p-6 bg-[#0a0a0a]">
      <div className="max-w-sm w-full rounded-2xl bg-card border border-border p-6 space-y-4 shadow-xl">
        <div className="flex items-center gap-2 text-primary">
          <IconLock className="h-5 w-5" />
          <h1 className="text-lg font-semibold">
            {title ?? "Password required"}
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          This video is protected. Enter the password to watch.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(value);
          }}
          className="space-y-3"
        >
          <Input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Password"
            autoFocus
          />
          {error ? <p className="text-xs text-red-500">{error}</p> : null}
          <Button
            type="submit"
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
            disabled={!value}
          >
            Unlock
          </Button>
        </form>
      </div>
    </div>
  );
}
