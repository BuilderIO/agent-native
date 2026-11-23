import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { IconEye, IconFileAnalytics, IconLock } from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router";

import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import type { HomeProjectCard } from "./types";

export function HomeProjectCardView({ project }: { project: HomeProjectCard }) {
  const t = useT();
  const { formatDate } = useFormatters();
  const info = project.information;
  const [informationOpen, setInformationOpen] = useState(false);
  const [informationPinned, setInformationPinned] = useState(false);
  const fallback = info?.namesUnavailable
    ? t("analytics.home.nameUnavailable")
    : t("analytics.home.unknownName");
  return (
    <article className="ws-home-card">
      {info ? (
        <Popover
          open={informationOpen}
          onOpenChange={(open) => {
            setInformationOpen(open);
            if (!open) setInformationPinned(false);
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={t("analytics.home.projectInformationLabel")}
              onPointerEnter={() => setInformationOpen(true)}
              onPointerLeave={() => {
                if (!informationPinned) setInformationOpen(false);
              }}
              onClick={(event) => {
                event.preventDefault();
                setInformationPinned(true);
                setInformationOpen(true);
              }}
            >
              <IconFileAnalytics size={16} aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            aria-label={t("analytics.home.projectInformation")}
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            <strong>{t("analytics.home.projectInformation")}</strong>
            <Badge variant="secondary" size="sm">
              {t("analytics.lists.published")}
            </Badge>
            <div>
              <span>{t("analytics.lists.creator")}</span>{" "}
              <span>{info.creatorName ?? fallback}</span>
            </div>
            <div>
              <span>{t("analytics.lists.owner")}</span>{" "}
              <span>{info.ownerName ?? fallback}</span>
            </div>
            <div>
              <span>{t("analytics.home.createdOn")}</span>{" "}
              <span>
                {formatDate(new Date(info.createdAt), {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </div>
            <div>
              <span>{t("analytics.lists.updatedAt")}</span>{" "}
              <span>
                {formatDate(new Date(info.lastEditedAt), {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
      <Link className="ws-home-card-title" to={project.href}>
        {project.title}
      </Link>
      {project.description ? (
        <p className="ws-home-card-description">{project.description}</p>
      ) : null}
      {project.allowEmbedding ? (
        <div
          data-signed-embedding-card="true"
          className="mt-1.5 flex items-start gap-1.5 rounded border border-border/70 bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground"
        >
          <IconLock size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <div className="font-medium text-foreground">
              {t("appEmbedding.signedEmbeddingEnabled")}
            </div>
            <div>{t("appEmbedding.signedEmbeddingCardDescription")}</div>
          </div>
        </div>
      ) : null}
      <div className="ws-home-card-meta">
        {project.viewCountLabel ? (
          <span className="ws-home-card-views" title={project.viewCountTooltip}>
            <IconEye size={14} aria-hidden="true" />
            {project.viewCountLabel}
          </span>
        ) : null}
        {project.ownerLabel ? (
          <span className="ws-home-card-owner">{project.ownerLabel}</span>
        ) : null}
        {project.editHref ? (
          <Link className="ws-home-card-edit" to={project.editHref}>
            Edit
          </Link>
        ) : null}
      </div>
    </article>
  );
}
