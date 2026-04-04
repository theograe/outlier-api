"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";

type Project = { id: number; name: string };
type ConceptRun = {
  id: number;
  title: string | null;
  model: string | null;
  createdAt?: string;
  result: unknown;
};
type ThumbnailGeneration = {
  id: number;
  status: string;
  prompt: string;
  downloadUrls: string[];
  resultUrls: string[];
  provider?: string;
};
type WorkflowRun = {
  id: number;
  mode: string;
  status: string;
  currentStage: string;
  updatedAt: string;
  output: Record<string, unknown>;
};

export default function IdeasPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [concepts, setConcepts] = useState<ConceptRun[]>([]);
  const [thumbnailGenerations, setThumbnailGenerations] = useState<ThumbnailGeneration[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRun[]>([]);

  async function load(nextProjectId?: string) {
    const activeProjectId = nextProjectId ?? projectId;
    const projectRows = await apiFetch<Project[]>("/api/projects");
    setProjects(projectRows);
    const resolvedProjectId = activeProjectId || (projectRows[0] ? String(projectRows[0].id) : "");
    if (!resolvedProjectId) return;
    setProjectId(resolvedProjectId);

    const [conceptRuns, thumbnailRuns, workflows] = await Promise.all([
      apiFetch<ConceptRun[]>(`/api/projects/${resolvedProjectId}/concepts`),
      apiFetch<ThumbnailGeneration[]>(`/api/projects/${resolvedProjectId}/thumbnail-generations`),
      apiFetch<WorkflowRun[]>(`/api/projects/${resolvedProjectId}/workflow-runs`),
    ]);
    setConcepts(conceptRuns);
    setThumbnailGenerations(thumbnailRuns);
    setWorkflowRuns(workflows);
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <div className="eyebrow">Outputs</div>
          <h1 className="headline">Concepts, workflows, and thumbnails by project</h1>
        </div>
      </header>

      <section className="panel">
        <label className="field" style={{ maxWidth: 420 }}>
          <span>Project</span>
          <select value={projectId} onChange={(event) => void load(event.target.value)}>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="panel">
        <h2 style={{ marginTop: 0 }}>Concept runs</h2>
        <div className="list">
          {concepts.map((concept) => (
            <div key={concept.id} className="panel alt">
              <div className="metrics" style={{ marginBottom: 10 }}>
                <span className="pill">concept</span>
                <span className="pill">{concept.model ?? "heuristic"}</span>
              </div>
              <strong>{concept.title ?? "Untitled concept run"}</strong>
              <pre style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{JSON.stringify(concept.result, null, 2)}</pre>
            </div>
          ))}
          {concepts.length === 0 ? <div className="subtle">No concept runs yet for this project.</div> : null}
        </div>
      </section>

      <section className="panel">
        <h2 style={{ marginTop: 0 }}>Workflow runs</h2>
        <div className="list">
          {workflowRuns.map((run) => (
            <div key={run.id} className="panel alt">
              <div className="metrics" style={{ marginBottom: 10 }}>
                <span className="pill">{run.mode}</span>
                <span className="pill">{run.status}</span>
                <span className="pill">{run.currentStage}</span>
              </div>
              <pre style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{JSON.stringify(run.output, null, 2)}</pre>
            </div>
          ))}
          {workflowRuns.length === 0 ? <div className="subtle">No workflow runs yet for this project.</div> : null}
        </div>
      </section>

      <section className="panel">
        <h2 style={{ marginTop: 0 }}>Thumbnail generations</h2>
        <div className="list">
          {thumbnailGenerations.map((generation) => (
            <div key={generation.id} className="panel alt">
              <div className="metrics" style={{ marginBottom: 10 }}>
                <span className="pill">{generation.status}</span>
                <span className="pill">{generation.provider ?? "kie-nano-banana-2"}</span>
              </div>
              <div style={{ marginBottom: 12 }}>{generation.prompt}</div>
              <div className="vision-board">
                {generation.downloadUrls.map((url) => (
                  <div className="vision-item" key={url}>
                    <img src={url} alt="Generated thumbnail" />
                  </div>
                ))}
              </div>
            </div>
          ))}
          {thumbnailGenerations.length === 0 ? <div className="subtle">No thumbnail generations yet for this project.</div> : null}
        </div>
      </section>
    </div>
  );
}
