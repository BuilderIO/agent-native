import { useParams, useNavigate } from "react-router";
import { useCandidate, useNotes, useDeleteNote } from "@/hooks/use-greenhouse";
import {
  formatRelativeDate,
  formatDateFull,
  getInitials,
  getAvatarColor,
  cn,
} from "@/lib/utils";
import { sendToAgentChat } from "@agent-native/core/client";
import {
  IconArrowLeft,
  IconLoader2,
  IconMail,
  IconPhone,
  IconBuildingSkyscraper,
  IconMapPin,
  IconBrandLinkedin,
  IconSparkles,
  IconTrash,
  IconFileDescription,
  IconUsers,
} from "@tabler/icons-react";

export function CandidateDetailPage() {
  const { candidateId } = useParams();
  const id = Number(candidateId);
  const navigate = useNavigate();
  const { data: candidate, isLoading } = useCandidate(id);
  const { data: notes = [] } = useNotes(id);
  const deleteNote = useDeleteNote();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!candidate) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center">
        <IconUsers className="h-10 w-10 text-muted-foreground/30 mb-3" />
        <p className="text-sm font-medium text-foreground mb-1">
          Candidate not found
        </p>
        <p className="text-xs text-muted-foreground mb-4">
          This candidate may have been removed or the ID is invalid.
        </p>
        <button
          onClick={() => navigate("/candidates")}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
        >
          <IconArrowLeft className="h-3.5 w-3.5" />
          Back to Candidates
        </button>
      </div>
    );
  }

  const name = `${candidate.first_name} ${candidate.last_name}`;
  const initials = getInitials(name);
  const color = getAvatarColor(name);
  const email = (candidate.emails || [])[0]?.value;
  const phone = (candidate.phone_numbers || [])[0]?.value;
  const activeApp = (candidate.applications || []).find(
    (a) => a.status === "active",
  );

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 h-14 flex-shrink-0 sm:px-6">
        <button
          onClick={() => navigate("/candidates")}
          aria-label="Back to candidates"
          className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground flex-shrink-0"
        >
          <IconArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-sm font-semibold text-foreground">{name}</h1>
        {activeApp?.status && (
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
              activeApp.status === "active"
                ? "bg-green-500/10 text-green-600"
                : activeApp.status === "hired"
                  ? "bg-blue-500/10 text-blue-600"
                  : "bg-red-500/10 text-red-600",
            )}
          >
            {activeApp.status}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto px-4 py-6 sm:px-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-8">
            {/* Main content */}
            <div className="md:col-span-2 space-y-6">
              {/* Profile header */}
              <div className="flex items-start gap-4">
                {candidate.photo_url ? (
                  <img
                    src={candidate.photo_url}
                    alt={name}
                    className="h-16 w-16 rounded-full object-cover"
                  />
                ) : (
                  <div
                    className={cn(
                      "flex h-16 w-16 items-center justify-center rounded-full text-lg font-semibold text-white",
                      color,
                    )}
                  >
                    {initials}
                  </div>
                )}
                <div>
                  <h2 className="text-lg font-semibold text-foreground">
                    {name}
                  </h2>
                  {candidate.title && (
                    <p className="text-sm text-muted-foreground">
                      {candidate.title}
                    </p>
                  )}
                  {candidate.company && (
                    <p className="text-sm text-muted-foreground flex items-center gap-1">
                      <IconBuildingSkyscraper className="h-3.5 w-3.5" />
                      {candidate.company}
                    </p>
                  )}
                </div>
              </div>

              {/* Contact info */}
              <div className="flex flex-wrap gap-4 text-sm">
                {email && (
                  <a
                    href={`mailto:${email}`}
                    className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                  >
                    <IconMail className="h-3.5 w-3.5" />
                    {email}
                  </a>
                )}
                {phone && (
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <IconPhone className="h-3.5 w-3.5" />
                    {phone}
                  </span>
                )}
                {(candidate.addresses || [])[0] && (
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <IconMapPin className="h-3.5 w-3.5" />
                    {candidate.addresses[0].value}
                  </span>
                )}
              </div>

              {/* Tags */}
              {(candidate.tags || []).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {(candidate.tags || []).map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Applications */}
              <div>
                <h3 className="text-sm font-medium text-foreground mb-3">
                  Applications
                </h3>
                <div className="space-y-2">
                  {(candidate.applications || []).map((app) => (
                    <div
                      key={app.id}
                      className="rounded-lg border border-border p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-foreground">
                            {app.jobs?.[0]?.name ?? "Unknown Job"}
                          </span>
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                              app.status === "active"
                                ? "bg-green-500/10 text-green-600"
                                : app.status === "hired"
                                  ? "bg-blue-500/10 text-blue-600"
                                  : "bg-red-500/10 text-red-600",
                            )}
                          >
                            {app.status}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          Applied {formatRelativeDate(app.applied_at)}
                        </span>
                      </div>
                      {app.current_stage && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Stage: {app.current_stage.name}
                        </p>
                      )}
                      {app.source && (
                        <p className="text-xs text-muted-foreground">
                          Source: {app.source.public_name}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* AI actions */}
              <div>
                <h3 className="text-sm font-medium text-foreground mb-3">
                  AI Actions
                </h3>
                <div className="space-y-1.5">
                  <button
                    onClick={() =>
                      sendToAgentChat({
                        message: `Analyze the resume and qualifications of candidate ${name} (ID: ${candidate.id})${activeApp?.jobs?.[0] ? ` for the ${activeApp.jobs[0].name} role` : ""}. Provide a detailed assessment of their strengths, weaknesses, and fit.`,
                      })
                    }
                    className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-accent/50"
                  >
                    <IconSparkles className="h-3.5 w-3.5 text-amber-500" />
                    Analyze Resume
                  </button>
                  <button
                    onClick={() =>
                      sendToAgentChat({
                        message: `Generate interview questions for candidate ${name} (ID: ${candidate.id})${activeApp?.jobs?.[0] ? ` for the ${activeApp.jobs[0].name} role` : ""}. Include a mix of behavioral, technical, and culture-fit questions.`,
                      })
                    }
                    className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-accent/50"
                  >
                    <IconFileDescription className="h-3.5 w-3.5 text-blue-500" />
                    Generate Questions
                  </button>
                </div>
              </div>

              {/* Recruiter/Coordinator */}
              {(candidate.recruiter || candidate.coordinator) && (
                <div>
                  <h3 className="text-sm font-medium text-foreground mb-2">
                    Team
                  </h3>
                  <div className="space-y-1.5 text-sm">
                    {candidate.recruiter && (
                      <div className="text-muted-foreground">
                        <span className="text-xs font-medium uppercase tracking-wider">
                          Recruiter
                        </span>
                        <p className="text-foreground">
                          {candidate.recruiter.name}
                        </p>
                      </div>
                    )}
                    {candidate.coordinator && (
                      <div className="text-muted-foreground">
                        <span className="text-xs font-medium uppercase tracking-wider">
                          Coordinator
                        </span>
                        <p className="text-foreground">
                          {candidate.coordinator.name}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Agent notes */}
              <div>
                <h3 className="text-sm font-medium text-foreground mb-2">
                  AI Notes
                </h3>
                {notes.length === 0 ? (
                  <p className="text-xs text-muted-foreground/60 py-2">
                    No AI notes yet. Use the actions above to generate analysis.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {notes.map((note) => (
                      <div
                        key={note.id}
                        className="rounded-md border border-border p-2.5"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                            {note.type.replace("_", " ")}
                          </span>
                          <button
                            onClick={() =>
                              deleteNote.mutate({
                                id: note.id,
                                candidateId: candidate.id,
                              })
                            }
                            aria-label="Delete note"
                            className="text-muted-foreground/50 hover:text-destructive"
                          >
                            <IconTrash className="h-3 w-3" />
                          </button>
                        </div>
                        <p className="text-xs text-foreground whitespace-pre-wrap line-clamp-6">
                          {note.content}
                        </p>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {formatRelativeDate(note.createdAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
