"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, FolderKanban, Plus } from "lucide-react";
import { describeError } from "@/components/chat/use-model-catalog";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/states";
import { apiRequest } from "@/lib/client/api";
import { formatDateKey, localDateKey } from "@/lib/dates";
import type { ProjectDto } from "@/lib/projects/types";
import { ProjectDialog } from "./project-dialog";
import { ProgressBar, ProjectStatusBadge } from "./project-parts";

export function ProjectsWorkspace() {
  const router = useRouter();
  const today = useMemo(() => localDateKey(), []);
  const [showArchived, setShowArchived] = useState(false);
  const [projects, setProjects] = useState<{ archived: boolean; items: ProjectDto[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ projects: ProjectDto[] }>(`/api/projects?today=${today}${showArchived ? "&archived=1" : ""}`, { signal: controller.signal })
      .then((result) => {
        setProjects({ archived: showArchived, items: result.projects });
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(describeError(caught));
      });
    return () => controller.abort();
  }, [showArchived, today, reloadToken]);

  const items = projects?.items ?? null;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={FolderKanban}
        title="Projects"
        description="Milestones, progress tracking, and AI-assisted planning."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            New project
          </Button>
        }
      />

      <label className="flex w-fit items-center gap-2 text-sm text-muted-foreground">
        <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} className="size-4 accent-[var(--primary)]" />
        Show archived projects
      </label>

      {error ? <ErrorBanner message={error} onRetry={reload} /> : null}

      {items === null ? (
        error ? null : <SkeletonRows count={3} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={showArchived ? "No projects yet" : "No active projects"}
          description="A project groups related tasks and milestones, and tracks how far along they are."
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              New project
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Projects">
          {items.map((project) => (
            <li key={project.id}>
              <Link href={`/projects/${project.id}`} className="block h-full rounded-2xl focus-visible:outline-2">
                <Card className="flex h-full flex-col gap-3 transition-colors hover:bg-accent/40">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="min-w-0 break-words font-semibold">{project.name}</h2>
                    <ProjectStatusBadge status={project.status} />
                  </div>
                  {project.description ? <p className="line-clamp-2 text-sm text-muted-foreground">{project.description}</p> : null}
                  <div className="mt-auto space-y-2">
                    <ProgressBar percent={project.stats.progress} label={`${project.name} progress`} />
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {project.stats.done}/{project.stats.total} tasks · {project.stats.progress}%
                      </span>
                      {project.stats.overdue > 0 ? <span className="font-medium text-danger">{project.stats.overdue} overdue</span> : null}
                      {project.dueDate ? (
                        <span className="inline-flex items-center gap-1">
                          <CalendarDays className="size-3" aria-hidden />
                          {formatDateKey(project.dueDate)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {creating ? <ProjectDialog project={null} onClose={() => setCreating(false)} onSaved={(project) => router.push(`/projects/${project.id}`)} /> : null}
    </div>
  );
}
