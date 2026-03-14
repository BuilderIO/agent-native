/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GIT PROVIDERS DROPDOWN DEMO PAGE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Demo page showing the Git Providers Dropdown component integrated with the
 * CreateProjectPrompt component.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from "react";
import { CreateProjectPrompt } from "@/remotion/library-components/CreateProjectPrompt";

export default function GitProviderDemo() {
  const [value, setValue] = React.useState("");
  const [selectedProvider, setSelectedProvider] = React.useState<string | null>(null);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-8">
      <div className="w-full max-w-4xl">
        {/* Demo Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-white mb-2">
            Git Providers Dropdown Demo
          </h1>
          <p className="text-muted-foreground">
            Click the "Connect Repo" button to see the dropdown menu
          </p>
        </div>

        {/* Interactive Component */}
        <CreateProjectPrompt
          value={value}
          onChange={setValue}
          onSend={() => console.log("Send:", value)}
          onSelectProvider={(provider) => {
            setSelectedProvider(provider);
            console.log("Selected provider:", provider);
          }}
          interactive
        />

        {/* Status Display */}
        {selectedProvider && (
          <div className="mt-8 p-4 bg-card border border-border rounded-lg">
            <p className="text-sm text-muted-foreground">Selected Provider:</p>
            <p className="text-lg font-semibold text-primary capitalize">
              {selectedProvider}
            </p>
          </div>
        )}

        {/* Instructions */}
        <div className="mt-8 p-6 bg-card border border-border rounded-lg space-y-3">
          <h2 className="text-lg font-semibold text-white">Instructions:</h2>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="text-primary">1.</span>
              <span>Type a message in the "Ask Builder" textarea</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary">2.</span>
              <span>Click the "Connect Repo" button to open the Git Providers dropdown</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary">3.</span>
              <span>Select a Git provider from the dropdown menu</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary">4.</span>
              <span>The dropdown will animate in below the button with smooth transitions</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
