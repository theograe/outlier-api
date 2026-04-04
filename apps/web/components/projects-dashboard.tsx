"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";

type ProjectSummary = {
  id: number;
  name: string;
  niche: string | null;
  status: string;
  primaryChannelId: string | null;
  primaryChannelName: string | null;
  sourceSetCount: number;
  referenceCount: number;
};

type ProjectDetail = {
  id: number;
  name: string;
  niche: string | null;
  primaryChannelId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  sourceSets: Array<{
    id: number;
    name: string;
    role: string;
    discoveryMode: string;
    backingListId: number | null;
    channelCount: number;
  }>;
  references: Array<{
    id: number;
    videoId: string;
    title: string;
    channelName: string;
    outlierScore: number;
    viewVelocity: number;
    views: number;
    kind: string;
    notes: string | null;
    tags: string[];
    createdAt: string;
  }>;
};

type SourceSetDetail = {
  id: number;
  projectId: number;
  backingListId: number | null;
  name: string;
  role: string;
  discoveryMode: string;
  channels: Array<{
    id: string;
    name: string;
    handle: string | null;
    subscriberCount: number | null;
  }>;
};

type DiscoveryResult = {
  sourceSetId: number;
  query: string;
  suggestions: Array<{
    channelId: string;
    channelName: string;
    handle: string | null;
    subscriberCount: number;
  }>;
  attachedCount: number;
};

type ScanStatus = {
  running: boolean;
  currentRun: {
    listId: number | null;
    startedAt: string;
    progressCurrent: number;
    progressTotal: number;
    message?: string | null;
  } | null;
  lastRun: {
    status: string;
    listId: number | null;
    startedAt: string;
    completedAt: string | null;
    progressCurrent: number;
    progressTotal: number;
    message?: string | null;
  } | null;
};

export function ProjectsDashboard() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectDetail | null>(null);
  const [selectedSourceSet, setSelectedSourceSet] = useState<SourceSetDetail | null>(null);
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [projectName, setProjectName] = useState("");
  const [projectNiche, setProjectNiche] = useState("");
  const [primaryChannelInput, setPrimaryChannelInput] = useState("");
  const [channelInput, setChannelInput] = useState("");
  const [discoveryQuery, setDiscoveryQuery] = useState("");
  const [sourceSetName, setSourceSetName] = useState("");
  const [seedVideoUrl, setSeedVideoUrl] = useState("");

  async function hydrateProject(projectId: number) {
    const detail = await apiFetch<ProjectDetail>(`/api/projects/${projectId}`);
    setSelectedProject(detail);
    const sourceSetId = detail.sourceSets[0]?.id;
    if (sourceSetId) {
      setSelectedSourceSet(await apiFetch<SourceSetDetail>(`/api/source-sets/${sourceSetId}`));
    } else {
      setSelectedSourceSet(null);
    }
    setDiscovery(null);
  }

  async function loadProjects(preferredProjectId?: number) {
    setLoading(true);
    setError(null);
    try {
      const rows = await apiFetch<ProjectSummary[]>("/api/projects");
      setProjects(rows);
      const targetId = preferredProjectId ?? selectedProject?.id ?? rows[0]?.id;
      if (targetId) {
        await hydrateProject(targetId);
      } else {
        setSelectedProject(null);
        setSelectedSourceSet(null);
      }
      setScanStatus(await apiFetch<ScanStatus>("/api/scan/status"));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load projects.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProjects();
  }, []);

  async function createProject() {
    if (!projectName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const project = await apiFetch<ProjectDetail>("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          name: projectName.trim(),
          niche: projectNiche.trim() || null,
          primaryChannelInput: primaryChannelInput.trim() || null,
        }),
      });
      setProjectName("");
      setProjectNiche("");
      setPrimaryChannelInput("");
      await loadProjects(project.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create project.");
    } finally {
      setLoading(false);
    }
  }

  async function createSourceSet() {
    if (!selectedProject || !sourceSetName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await apiFetch(`/api/projects/${selectedProject.id}/source-sets`, {
        method: "POST",
        body: JSON.stringify({
          name: sourceSetName.trim(),
          role: "competitors",
        }),
      });
      setSourceSetName("");
      await hydrateProject(selectedProject.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create source set.");
    } finally {
      setLoading(false);
    }
  }

  async function addChannelToSourceSet(rawInput: string) {
    if (!selectedSourceSet || !rawInput.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const payload = rawInput.startsWith("@")
        ? { handle: rawInput }
        : rawInput.includes("youtube.com")
          ? { channelUrl: rawInput }
          : { channelId: rawInput };
      await apiFetch(`/api/source-sets/${selectedSourceSet.id}/channels`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setChannelInput("");
      setSelectedSourceSet(await apiFetch<SourceSetDetail>(`/api/source-sets/${selectedSourceSet.id}`));
      await loadProjects(selectedProject?.id);
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Failed to add channel.");
    } finally {
      setLoading(false);
    }
  }

  async function discoverChannels() {
    if (!selectedSourceSet) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<DiscoveryResult>(`/api/source-sets/${selectedSourceSet.id}/discover`, {
        method: "POST",
        body: JSON.stringify({
          query: discoveryQuery.trim() || selectedProject?.niche || undefined,
          limit: 8,
          autoAttach: false,
        }),
      });
      setDiscovery(result);
    } catch (discoverError) {
      setError(discoverError instanceof Error ? discoverError.message : "Failed to discover channels.");
    } finally {
      setLoading(false);
    }
  }

  async function attachSuggestedChannel(channelId: string) {
    await addChannelToSourceSet(channelId);
    if (discovery) {
      setDiscovery({
        ...discovery,
        suggestions: discovery.suggestions.filter((suggestion) => suggestion.channelId !== channelId),
      });
    }
  }

  async function runSourceSetScan() {
    if (!selectedSourceSet?.backingListId) return;
    setLoading(true);
    setError(null);
    try {
      await apiFetch("/api/scan", {
        method: "POST",
        body: JSON.stringify({ listId: selectedSourceSet.backingListId }),
      });
      setScanStatus(await apiFetch<ScanStatus>("/api/scan/status"));
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Failed to start scan.");
    } finally {
      setLoading(false);
    }
  }

  async function importSeedVideo() {
    if (!selectedProject || !seedVideoUrl.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await apiFetch(`/api/projects/${selectedProject.id}/references/import-video`, {
        method: "POST",
        body: JSON.stringify({
          sourceSetId: selectedSourceSet?.id ?? null,
          videoUrl: seedVideoUrl.trim(),
        }),
      });
      setSeedVideoUrl("");
      await hydrateProject(selectedProject.id);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Failed to import video.");
    } finally {
      setLoading(false);
    }
  }

  const selectedSummary = useMemo(
    () => projects.find((project) => project.id === selectedProject?.id) ?? null,
    [projects, selectedProject?.id],
  );

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <div className="eyebrow">Projects</div>
          <h1 className="headline">Set up your niche and track the right channels</h1>
          <p className="subtle">Create a project, add competitor channels, run scans, and keep the best outlier references in one place.</p>
        </div>
      </header>

      {error ? <section className="panel" style={{ borderColor: "var(--line-strong)", color: "var(--text)" }}>{error}</section> : null}

      <section className="panel">
        <div className="form-grid">
          <label className="field">
            <span>Project name</span>
            <input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="Editing education" />
          </label>
          <label className="field">
            <span>Niche</span>
            <input value={projectNiche} onChange={(event) => setProjectNiche(event.target.value)} placeholder="English video editing tutorials" />
          </label>
          <label className="field">
            <span>Your channel</span>
            <input value={primaryChannelInput} onChange={(event) => setPrimaryChannelInput(event.target.value)} placeholder="@yourchannel or youtube.com/@yourchannel" />
          </label>
          <div className="field" style={{ alignSelf: "end" }}>
            <button className="button" disabled={loading} onClick={() => void createProject()}>Create project</button>
          </div>
        </div>
      </section>

      <div className="grid-2" style={{ gridTemplateColumns: "minmax(0, 1.15fr) minmax(320px, 0.85fr)" }}>
        <section className="panel">
          <div className="list">
            {projects.map((project) => (
              <button
                key={project.id}
                className="list-row"
                style={{ background: "transparent", border: 0, color: "inherit", textAlign: "left" }}
                onClick={() => void hydrateProject(project.id)}
              >
                <div>
                  <strong>{project.name}</strong>
                  <div className="subtle">{project.niche ?? "No niche yet"}</div>
                </div>
                <div className="metrics">
                  <span className="pill">{project.sourceSetCount} sets</span>
                  <span className="pill">{project.referenceCount} saved</span>
                </div>
              </button>
            ))}
            {projects.length === 0 && !loading ? <div className="subtle">Create your first project to start tracking channels.</div> : null}
          </div>
        </section>

        <section className="panel alt">
          <div className="eyebrow">Selected project</div>
          <h2 style={{ marginTop: 8 }}>{selectedProject?.name ?? "Choose a project"}</h2>
          {selectedProject ? (
            <div className="stack">
              <div className="metrics">
                <span className="pill">{selectedSummary?.status ?? selectedProject.status}</span>
                {selectedProject.niche ? <span className="pill">{selectedProject.niche}</span> : null}
                {selectedSummary?.primaryChannelName ? <span className="pill">Primary: {selectedSummary.primaryChannelName}</span> : null}
              </div>

              <label className="field">
                <span>New source set</span>
                <div className="toolbar">
                  <input value={sourceSetName} onChange={(event) => setSourceSetName(event.target.value)} placeholder="Short-form editors" />
                  <button className="button secondary" disabled={loading} onClick={() => void createSourceSet()}>Add set</button>
                </div>
              </label>

              <div className="metrics">
                {selectedProject.sourceSets.map((sourceSet) => (
                  <button
                    key={sourceSet.id}
                    className={`filter-chip ${selectedSourceSet?.id === sourceSet.id ? "active" : ""}`}
                    onClick={() => void apiFetch<SourceSetDetail>(`/api/source-sets/${sourceSet.id}`).then(setSelectedSourceSet)}
                  >
                    {sourceSet.name} ({sourceSet.channelCount})
                  </button>
                ))}
              </div>

              {selectedSourceSet ? (
                <div className="stack">
                  <div className="panel">
                    <div className="eyebrow">Source set</div>
                    <h3 style={{ marginTop: 8 }}>{selectedSourceSet.name}</h3>
                    <div className="toolbar">
                      <label className="field">
                        <span>Add channel URL, handle, or ID</span>
                        <input value={channelInput} onChange={(event) => setChannelInput(event.target.value)} placeholder="@creator or https://youtube.com/@creator" />
                      </label>
                      <div className="field" style={{ alignSelf: "end" }}>
                        <button className="button" disabled={loading} onClick={() => void addChannelToSourceSet(channelInput)}>Add channel</button>
                      </div>
                    </div>
                    <div className="toolbar" style={{ marginTop: 10 }}>
                      <label className="field">
                        <span>Find more channels automatically</span>
                        <input value={discoveryQuery} onChange={(event) => setDiscoveryQuery(event.target.value)} placeholder={selectedProject.niche ?? "premiere pro tutorials"} />
                      </label>
                      <div className="field" style={{ alignSelf: "end" }}>
                        <button className="button secondary" disabled={loading} onClick={() => void discoverChannels()}>Find channels</button>
                      </div>
                    </div>
                    <div className="toolbar" style={{ marginTop: 10 }}>
                      <button className="button secondary" disabled={loading || !selectedSourceSet.backingListId} onClick={() => void runSourceSetScan()}>
                        Scan this source set
                      </button>
                      {scanStatus?.currentRun ? (
                        <div className="subtle">
                          Running · {scanStatus.currentRun.progressCurrent}/{scanStatus.currentRun.progressTotal}
                        </div>
                      ) : (
                        <div className="subtle">{scanStatus?.lastRun ? `Last scan: ${scanStatus.lastRun.status}` : "No scan running"}</div>
                      )}
                    </div>
                    <div className="list" style={{ marginTop: 14 }}>
                      {selectedSourceSet.channels.map((channel) => (
                        <div key={channel.id} className="list-row">
                          <div>
                            <strong>{channel.name}</strong>
                            <div className="subtle">{channel.handle ?? channel.id}</div>
                          </div>
                          <span className="pill">{Number(channel.subscriberCount ?? 0).toLocaleString()} subs</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {discovery ? (
                    <div className="panel">
                      <div className="eyebrow">Suggestions</div>
                      <h3 style={{ marginTop: 8 }}>Channels for “{discovery.query}”</h3>
                      <div className="list">
                        {discovery.suggestions.map((channel) => (
                          <div key={channel.channelId} className="list-row">
                            <div>
                              <strong>{channel.channelName}</strong>
                              <div className="subtle">{channel.handle ?? channel.channelId}</div>
                            </div>
                            <div className="metrics">
                              <span className="pill">{channel.subscriberCount.toLocaleString()} subs</span>
                              <button className="button secondary" disabled={loading} onClick={() => void attachSuggestedChannel(channel.channelId)}>Track</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="subtle">This project does not have a source set yet.</div>
              )}
            </div>
          ) : (
            <div className="subtle">Select a project to manage channels and saved references.</div>
          )}
        </section>
      </div>

      {selectedProject ? (
        <div className="grid-2" style={{ gridTemplateColumns: "minmax(0, 1.1fr) minmax(320px, 0.9fr)" }}>
          <section className="panel">
            <div className="eyebrow">Import one video</div>
            <h2 style={{ marginTop: 8 }}>Save a proven reference directly</h2>
            <p className="subtle">If you already know one strong outlier, paste it here and save it into the project without scanning first.</p>
            <div className="toolbar">
              <label className="field" style={{ flex: 1 }}>
                <span>YouTube video URL</span>
                <input value={seedVideoUrl} onChange={(event) => setSeedVideoUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=..." />
              </label>
              <div className="field" style={{ alignSelf: "end" }}>
                <button className="button" disabled={loading} onClick={() => void importSeedVideo()}>Save reference</button>
              </div>
            </div>
          </section>

          <section className="panel alt">
            <div className="eyebrow">Saved references</div>
            <h2 style={{ marginTop: 8 }}>What you’ve kept</h2>
            <div className="list">
              {selectedProject.references.map((reference) => (
                <div key={reference.id} className="list-row">
                  <div>
                    <strong>{reference.title}</strong>
                    <div className="subtle">{reference.channelName}</div>
                  </div>
                  <div className="metrics">
                    <span className="pill">{reference.outlierScore.toFixed(1)}x</span>
                    <a className="button secondary" href={`https://youtube.com/watch?v=${reference.videoId}`} target="_blank" rel="noreferrer">Open</a>
                  </div>
                </div>
              ))}
              {selectedProject.references.length === 0 ? <div className="subtle">No saved references yet. Scan channels or import a video to start building your set.</div> : null}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
