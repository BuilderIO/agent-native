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
}

export function CodeBlock({
  code,
  language = "typescript",
  tabs,
}: CodeBlockProps) {
  const [activeTab, setActiveTab] = useState(0);

  if (tabs && tabs.length > 0) {
    const active = tabs[activeTab];
    return (
      <div
        style={{
          border: "1px solid var(--b-border-default)",
          borderRadius: "var(--b-radius)",
          overflow: "hidden",
          background: "var(--b-bg-raised)",
        }}
      >
        <div
          role="tablist"
          style={{
            display: "flex",
            borderBottom: "1px solid var(--b-border-default)",
          }}
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
        <div style={{ padding: "var(--spacing-2)" }}>
          <SharedCodeBlock code={active.code} lang={active.language} />
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        border: "1px solid var(--b-border-default)",
        borderRadius: "var(--b-radius)",
        overflow: "hidden",
        background: "var(--b-bg-raised)",
        padding: "var(--spacing-2)",
      }}
    >
      <SharedCodeBlock code={code ?? ""} lang={language} />
    </div>
  );
}
