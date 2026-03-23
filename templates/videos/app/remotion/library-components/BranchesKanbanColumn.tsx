/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BRANCHES KANBAN COLUMN MOLECULE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A single Kanban column with header and branch cards.
 *
 * Features:
 * - Column header with title and action icons
 * - List of branch cards
 * - Automatic spacing
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from "react";
import { BranchCard, type BranchCardProps } from "./BranchCard";

export type KanbanColumnProps = {
  title: string;
  cards: BranchCardProps[];
};

export const BranchesKanbanColumn: React.FC<KanbanColumnProps> = ({
  title,
  cards,
}) => {
  return (
    <div
      style={{
        borderRadius: 14,
        backgroundColor: "#292929",
        borderColor: "#343434",
        borderStyle: "solid",
        borderWidth: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        flex: 1,
        minWidth: 218,
      }}
    >
      {/* Header */}
      <div
        style={{
          borderColor: "#343434",
          borderStyle: "solid",
          borderBottomWidth: 1,
          padding: "11px 11px 11px 19px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div
          style={{
            fontSize: 14,
            color: "#ffffff",
            fontFamily: "Inter, sans-serif",
            fontWeight: 600,
            lineHeight: 1.46,
          }}
        >
          {title}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/08ee212b36315b031541d413773799e8202cdd4e?placeholderIfAbsent=true"
            alt=""
            style={{
              width: 14,
              aspectRatio: 0.86,
              objectFit: "contain",
              cursor: "pointer",
            }}
          />
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/4d00e8d32d11e3c4a68800fa78b708aabe5f35ba?placeholderIfAbsent=true"
            alt=""
            style={{
              width: 16,
              aspectRatio: 0.93,
              objectFit: "contain",
              cursor: "pointer",
            }}
          />
        </div>
      </div>

      {/* Cards */}
      <div
        style={{
          padding: "12px 11px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {cards.map((card, index) => (
          <BranchCard key={index} {...card} />
        ))}
      </div>
    </div>
  );
};
