import { useState } from "react";

import SharedCodeBlock from "../../CodeBlock";
import { TabItem } from "./tab-item";

interface CodeBlockTab {
  label: string;
  language: string;
  code: string;
}

interface CodeBlockProps {
  code?: string;
  language?: string;
  tabs?: CodeBlockTab[];
  activeTab?: number;
  onTabChange?: (index: number) => void;
}

export function CodeBlock({
  code,
  language = "typescript",
  tabs,
  activeTab: controlledActiveTab,
  onTabChange,
}: CodeBlockProps) {
  const [uncontrolledActiveTab, setUncontrolledActiveTab] = useState(0);
  const activeTab = controlledActiveTab ?? uncontrolledActiveTab;
  const setActiveTab = onTabChange ?? setUncontrolledActiveTab;

  if (tabs && tabs.length > 0) {
    const active = tabs[activeTab];
    return (
      <div className="overflow-hidden rounded-[var(--b-radius)] border border-solid border-[var(--b-border-default)] bg-[var(--b-bg-raised)]">
        <div
          role="tablist"
          className="flex border-b border-solid border-[var(--b-border-default)]"
        >
          {tabs.map((tab, i) => (
            <TabItem
              key={tab.label}
              active={i === activeTab}
              onClick={() => setActiveTab(i)}
            >
              {tab.label}
            </TabItem>
          ))}
        </div>
        <div className="p-[var(--spacing-2)]">
          <SharedCodeBlock code={active.code} lang={active.language} />
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[var(--b-radius)] border border-solid border-[var(--b-border-default)] bg-[var(--b-bg-raised)] p-[var(--spacing-2)]">
      <SharedCodeBlock code={code ?? ""} lang={language} />
    </div>
  );
}
