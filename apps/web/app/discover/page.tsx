"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../lib/api";
import { OutlierCard } from "../../components/outlier-card";

type Video = {
  videoId: string;
  title: string;
  channelName: string;
  channelId: string;
  thumbnailUrl: string | null;
  views: number;
  outlierScore: number;
  viewVelocity: number;
  scoreBand: string;
  contentType: string;
  channelSubscribers?: number;
  durationSeconds?: number;
  publishedAt?: string | null;
};

type Project = {
  id: number;
  name: string;
  niche: string | null;
  sourceSetCount: number;
  referenceCount: number;
};

type ProjectDetail = {
  id: number;
  name: string;
  niche: string | null;
  sourceSets: Array<{ id: number; name: string; role: string; channelCount: number }>;
};

type Board = { id: number; name: string; project_id?: number | null };
type Provider = { id: number; name: string; provider: string };
type SimilarItem = { videoId: string; title: string; channelName: string; similarity: number; thumbnailUrl?: string | null; mode?: string };
type ThumbnailGeneration = { id: number; status: string; resultUrls: string[]; downloadUrls: string[] };
type CharacterProfile = { id: number; name: string; faceSheetUrl: string | null; isDefault: boolean };
type DiscoverResponse = { videos: Video[]; total: number };
type ConceptRunResponse = { id: number; model: string | null; concept: Record<string, unknown> };

type FilterState = {
  search: string;
  projectId: string;
  sourceSetId: string;
  contentType: "all" | "long" | "short";
  minScore: string;
  maxScore: string;
  minViews: string;
  maxViews: string;
  minSubscribers: string;
  maxSubscribers: string;
  minVelocity: string;
  maxVelocity: string;
  minDurationSeconds: string;
  maxDurationSeconds: string;
  days: string;
  sort: "score" | "views" | "date" | "velocity" | "momentum";
  order: "asc" | "desc";
  limit: string;
  viewMode: "details" | "thumbnails";
  columns: number;
};

type SavedPreset = {
  id: string;
  name: string;
  filters: FilterState;
};

const STORAGE_KEY = "openoutlier.discover-presets";

const defaultFilters: FilterState = {
  search: "",
  projectId: "",
  sourceSetId: "",
  contentType: "all",
  minScore: "3",
  maxScore: "",
  minViews: "",
  maxViews: "",
  minSubscribers: "",
  maxSubscribers: "",
  minVelocity: "",
  maxVelocity: "",
  minDurationSeconds: "",
  maxDurationSeconds: "",
  days: "365",
  sort: "momentum",
  order: "desc",
  limit: "24",
  viewMode: "details",
  columns: 3,
};

const publicationPresets = [
  { label: "Last 7 days", days: "7" },
  { label: "Last 30 days", days: "30" },
  { label: "Last 90 days", days: "90" },
  { label: "Last 6 months", days: "180" },
  { label: "Last year", days: "365" },
  { label: "Last 2 years", days: "730" },
];

function normalizeNumeric(input: string): string {
  return input.replace(/[^\d.]/g, "");
}

function readPresets(): SavedPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as SavedPreset[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePresets(presets: SavedPreset[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

function activeFilterSummary(filters: FilterState, projects: Project[], projectDetail: ProjectDetail | null): string[] {
  const summary: string[] = [];
  const selectedProject = projects.find((project) => String(project.id) === filters.projectId);
  const selectedSourceSet = projectDetail?.sourceSets.find((sourceSet) => String(sourceSet.id) === filters.sourceSetId);
  if (selectedProject) summary.push(selectedProject.name);
  if (selectedSourceSet) summary.push(selectedSourceSet.name);
  if (filters.search) summary.push(`Search: ${filters.search}`);
  if (filters.contentType !== "all") summary.push(filters.contentType === "short" ? "Shorts" : "Long-form");
  if (filters.minScore) summary.push(`Min score ${filters.minScore}x`);
  if (filters.maxScore) summary.push(`Max score ${filters.maxScore}x`);
  if (filters.minViews || filters.maxViews) summary.push(`Views ${filters.minViews || "0"}-${filters.maxViews || "any"}`);
  if (filters.minSubscribers || filters.maxSubscribers) summary.push(`Subs ${filters.minSubscribers || "0"}-${filters.maxSubscribers || "any"}`);
  if (filters.minVelocity || filters.maxVelocity) summary.push(`Velocity ${filters.minVelocity || "0"}-${filters.maxVelocity || "any"}/day`);
  if (filters.minDurationSeconds || filters.maxDurationSeconds) summary.push(`Duration ${filters.minDurationSeconds || "0"}-${filters.maxDurationSeconds || "any"}s`);
  if (filters.days !== "365") summary.push(`Published in ${filters.days}d`);
  summary.push(`Sorted by ${filters.sort} ${filters.order}`);
  return summary;
}

export default function DiscoverPage() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [total, setTotal] = useState(0);
  const [boards, setBoards] = useState<Board[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [profiles, setProfiles] = useState<CharacterProfile[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectDetail, setProjectDetail] = useState<ProjectDetail | null>(null);
  const [savedPresets, setSavedPresets] = useState<SavedPreset[]>([]);
  const [selected, setSelected] = useState<Video | null>(null);
  const [similarTopics, setSimilarTopics] = useState<SimilarItem[]>([]);
  const [similarThumbs, setSimilarThumbs] = useState<SimilarItem[]>([]);
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [resultText, setResultText] = useState("");
  const [thumbnailPrompt, setThumbnailPrompt] = useState("");
  const [generatedThumbs, setGeneratedThumbs] = useState<ThumbnailGeneration | null>(null);
  const [characterProfileId, setCharacterProfileId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams({
      contentType: filters.contentType,
      minScore: filters.minScore || "0",
      sort: filters.sort,
      order: filters.order,
      limit: filters.limit,
      days: filters.days,
    });

    if (filters.search) params.set("search", filters.search);
    if (filters.projectId) params.set("projectId", filters.projectId);
    if (filters.sourceSetId) params.set("sourceSetId", filters.sourceSetId);
    if (filters.maxScore) params.set("maxScore", filters.maxScore);
    if (filters.minViews) params.set("minViews", filters.minViews);
    if (filters.maxViews) params.set("maxViews", filters.maxViews);
    if (filters.minSubscribers) params.set("minSubscribers", filters.minSubscribers);
    if (filters.maxSubscribers) params.set("maxSubscribers", filters.maxSubscribers);
    if (filters.minVelocity) params.set("minVelocity", filters.minVelocity);
    if (filters.maxVelocity) params.set("maxVelocity", filters.maxVelocity);
    if (filters.minDurationSeconds) params.set("minDurationSeconds", filters.minDurationSeconds);
    if (filters.maxDurationSeconds) params.set("maxDurationSeconds", filters.maxDurationSeconds);

    return params.toString();
  }, [filters]);

  useEffect(() => {
    setSavedPresets(readPresets());
  }, []);

  useEffect(() => {
    void Promise.all([
      apiFetch<Project[]>("/api/projects"),
      apiFetch<Provider[]>("/api/settings/llm-providers"),
      apiFetch<CharacterProfile[]>("/api/character-profiles"),
    ]).then(([projectRows, providerRows, profileRows]) => {
      setProjects(projectRows);
      setProviders(providerRows);
      setProfiles(profileRows);
      setCharacterProfileId(profileRows.find((profile) => profile.isDefault)?.id?.toString() ?? "");
      setFilters((current) => {
        if (current.projectId || projectRows.length === 0) return current;
        const editors = projectRows.find((project) => project.name.toLowerCase().includes("edit"));
        return editors ? { ...current, projectId: String(editors.id) } : { ...current, projectId: String(projectRows[0].id) };
      });
    }).catch((fetchError) => setError(fetchError instanceof Error ? fetchError.message : "Failed to load projects."));
  }, []);

  useEffect(() => {
    if (!filters.projectId) {
      setProjectDetail(null);
      setBoards([]);
      return;
    }

    void Promise.all([
      apiFetch<ProjectDetail>(`/api/projects/${filters.projectId}`),
      apiFetch<Board[]>(`/api/boards?projectId=${filters.projectId}`),
    ]).then(([detail, boardRows]) => {
      setProjectDetail(detail);
      setBoards(boardRows);
      setFilters((current) => {
        if (current.projectId !== String(detail.id)) return current;
        if (current.sourceSetId && detail.sourceSets.some((sourceSet) => String(sourceSet.id) === current.sourceSetId)) return current;
        return {
          ...current,
          sourceSetId: detail.sourceSets[0] ? String(detail.sourceSets[0].id) : "",
        };
      });
    }).catch((fetchError) => setError(fetchError instanceof Error ? fetchError.message : "Failed to load project detail."));
  }, [filters.projectId]);

  useEffect(() => {
    setLoading(true);
    setError("");
    void apiFetch<DiscoverResponse>(`/api/discover/outliers?${query}`)
      .then((discover) => {
        setVideos(discover.videos);
        setTotal(discover.total);
        setSelected((current) => discover.videos.find((video) => video.videoId === current?.videoId) ?? discover.videos[0] ?? null);
      })
      .catch((fetchError) => setError(fetchError instanceof Error ? fetchError.message : "Failed to load discover feed."))
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(() => {
    if (!selected) {
      setSimilarTopics([]);
      setSimilarThumbs([]);
      setGeneratedThumbs(null);
      setThumbnailPrompt("");
      return;
    }

    setThumbnailPrompt(`High-contrast YouTube thumbnail for "${selected.title}" with one focal object, bold readable text, creator-economy style, premium lighting.`);
    void Promise.all([
      apiFetch<{ items: SimilarItem[] }>(`/api/discover/similar-topics?videoId=${selected.videoId}&limit=6`),
      apiFetch<{ items: SimilarItem[] }>(`/api/discover/similar-thumbnails?videoId=${selected.videoId}&limit=6`),
    ])
      .then(([topics, thumbs]) => {
        setSimilarTopics(topics.items);
        setSimilarThumbs(thumbs.items);
      })
      .catch(() => {
        setSimilarTopics([]);
        setSimilarThumbs([]);
      });
  }, [selected]);

  function updateFilter<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    setFilters((current) => {
      if (key === "projectId") {
        return { ...current, projectId: value as string, sourceSetId: "" };
      }
      return { ...current, [key]: value };
    });
  }

  function resetFilters() {
    setFilters((current) => ({
      ...defaultFilters,
      projectId: current.projectId || defaultFilters.projectId,
      sourceSetId: current.sourceSetId || defaultFilters.sourceSetId,
    }));
  }

  function saveCurrentPreset() {
    const name = window.prompt("Name this filter preset");
    if (!name?.trim()) return;
    const preset: SavedPreset = {
      id: `${Date.now()}`,
      name: name.trim(),
      filters,
    };
    const next = [preset, ...savedPresets];
    setSavedPresets(next);
    writePresets(next);
  }

  function applyPreset(preset: SavedPreset) {
    setFilters(preset.filters);
  }

  function deletePreset(id: string) {
    const next = savedPresets.filter((preset) => preset.id !== id);
    setSavedPresets(next);
    writePresets(next);
  }

  async function saveSelected() {
    if (!selected || !filters.projectId) return;
    await apiFetch(`/api/projects/${filters.projectId}/references`, {
      method: "POST",
      body: JSON.stringify({
        sourceSetId: filters.sourceSetId ? Number(filters.sourceSetId) : null,
        videoId: selected.videoId,
        kind: "outlier",
        tags: ["discover", "manual-save"],
      }),
    });
    setResultText("Saved as a project reference.");
  }

  async function addToBoard(boardId: number) {
    if (!selected) return;
    await apiFetch(`/api/boards/${boardId}/items`, {
      method: "POST",
      body: JSON.stringify({ videoId: selected.videoId }),
    });
    setResultText("Added to board.");
  }

  async function generateConcept() {
    if (!selected || !filters.projectId) return;
    const result = await apiFetch<ConceptRunResponse>(`/api/projects/${filters.projectId}/concepts/generate`, {
      method: "POST",
      body: JSON.stringify({
        context: projectDetail?.niche
          ? `Adapt this outlier for ${projectDetail.niche}. Keep the packaging native to ${selected.channelName} level YouTube performance.`
          : `Adapt this outlier for the current niche. Keep the packaging native to ${selected.channelName} level YouTube performance.`,
      }),
    });
    setResultText(JSON.stringify(result.concept, null, 2));
  }

  async function generateThumbnail() {
    if (!selected || !filters.projectId) return;
    setError("");
    try {
      const result = await apiFetch<ThumbnailGeneration>(`/api/projects/${filters.projectId}/thumbnails/generate`, {
        method: "POST",
        body: JSON.stringify({
          prompt: thumbnailPrompt,
          context: `Use ${selected.channelName} as the reference creator and keep the packaging native to YouTube.`,
          characterProfileId: characterProfileId ? Number(characterProfileId) : null,
          size: "3:2",
        }),
      });
      setGeneratedThumbs(result);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "Thumbnail generation failed.");
    }
  }

  const summary = activeFilterSummary(filters, projects, projectDetail);
  const gridStyle =
    filters.viewMode === "thumbnails"
      ? { gridTemplateColumns: `repeat(${Math.max(1, filters.columns)}, minmax(0, 1fr))` }
      : undefined;

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <div className="eyebrow">Discover</div>
          <h1 className="headline">Track breakout packaging before it goes stale</h1>
          <p className="subtle">Search inside a project, narrow to a source set, then save references and generate concepts straight into the workflow system.</p>
        </div>
      </header>

      {error ? <section className="panel" style={{ borderColor: "rgba(255,127,102,0.4)", color: "#ffd1c7" }}>{error}</section> : null}

      <section className="panel filter-shell">
        <div className="filter-shell-main">
          <div className="filter-topbar">
            <div>
              <div className="eyebrow">Search Settings</div>
              <h2 style={{ margin: "8px 0 0" }}>Robust filters for real outlier hunting</h2>
            </div>
            <div className="metrics">
              <button className="button secondary" onClick={resetFilters}>Reset filters</button>
              <button className="button" onClick={saveCurrentPreset}>Save preset</button>
            </div>
          </div>

          <div className="filter-grid">
            <label className="field filter-span-2">
              <span>Search title, channel, or handle</span>
              <input value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} placeholder="premiere reels, @the_nicks_edit, motion..." />
            </label>
            <label className="field">
              <span>Project</span>
              <select value={filters.projectId} onChange={(event) => updateFilter("projectId", event.target.value)}>
                <option value="">All projects</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Source set</span>
              <select value={filters.sourceSetId} onChange={(event) => updateFilter("sourceSetId", event.target.value)}>
                <option value="">All source sets</option>
                {projectDetail?.sourceSets.map((sourceSet) => (
                  <option key={sourceSet.id} value={sourceSet.id}>
                    {sourceSet.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Content type</span>
              <select value={filters.contentType} onChange={(event) => updateFilter("contentType", event.target.value as FilterState["contentType"])}>
                <option value="all">All</option>
                <option value="long">Long</option>
                <option value="short">Shorts</option>
              </select>
            </label>
            <label className="field">
              <span>Sort</span>
              <select value={filters.sort} onChange={(event) => updateFilter("sort", event.target.value as FilterState["sort"])}>
                <option value="momentum">Momentum</option>
                <option value="score">Outlier score</option>
                <option value="views">Views</option>
                <option value="velocity">Velocity</option>
                <option value="date">Publish date</option>
              </select>
            </label>
            <label className="field">
              <span>Order</span>
              <select value={filters.order} onChange={(event) => updateFilter("order", event.target.value as FilterState["order"])}>
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </select>
            </label>
            <label className="field">
              <span>Results</span>
              <select value={filters.limit} onChange={(event) => updateFilter("limit", event.target.value)}>
                <option value="12">12</option>
                <option value="24">24</option>
                <option value="48">48</option>
                <option value="96">96</option>
              </select>
            </label>
            <label className="field">
              <span>Min outlier score</span>
              <input value={filters.minScore} onChange={(event) => updateFilter("minScore", normalizeNumeric(event.target.value))} />
            </label>
            <label className="field">
              <span>Max outlier score</span>
              <input value={filters.maxScore} onChange={(event) => updateFilter("maxScore", normalizeNumeric(event.target.value))} placeholder="Optional" />
            </label>
            <label className="field">
              <span>Min views</span>
              <input value={filters.minViews} onChange={(event) => updateFilter("minViews", normalizeNumeric(event.target.value))} placeholder="0" />
            </label>
            <label className="field">
              <span>Max views</span>
              <input value={filters.maxViews} onChange={(event) => updateFilter("maxViews", normalizeNumeric(event.target.value))} placeholder="Optional" />
            </label>
            <label className="field">
              <span>Min subscribers</span>
              <input value={filters.minSubscribers} onChange={(event) => updateFilter("minSubscribers", normalizeNumeric(event.target.value))} placeholder="0" />
            </label>
            <label className="field">
              <span>Max subscribers</span>
              <input value={filters.maxSubscribers} onChange={(event) => updateFilter("maxSubscribers", normalizeNumeric(event.target.value))} placeholder="Optional" />
            </label>
            <label className="field">
              <span>Min views/day</span>
              <input value={filters.minVelocity} onChange={(event) => updateFilter("minVelocity", normalizeNumeric(event.target.value))} placeholder="0" />
            </label>
            <label className="field">
              <span>Max views/day</span>
              <input value={filters.maxVelocity} onChange={(event) => updateFilter("maxVelocity", normalizeNumeric(event.target.value))} placeholder="Optional" />
            </label>
            <label className="field">
              <span>Min duration (sec)</span>
              <input value={filters.minDurationSeconds} onChange={(event) => updateFilter("minDurationSeconds", normalizeNumeric(event.target.value))} placeholder="0" />
            </label>
            <label className="field">
              <span>Max duration (sec)</span>
              <input value={filters.maxDurationSeconds} onChange={(event) => updateFilter("maxDurationSeconds", normalizeNumeric(event.target.value))} placeholder="Optional" />
            </label>
          </div>

          <div className="filter-chip-row">
            {publicationPresets.map((preset) => (
              <button key={preset.days} className={`filter-chip ${filters.days === preset.days ? "active" : ""}`} onClick={() => updateFilter("days", preset.days)}>
                {preset.label}
              </button>
            ))}
          </div>

          {savedPresets.length > 0 ? (
            <div className="stack">
              <div className="subtle">Saved presets</div>
              <div className="filter-chip-row">
                {savedPresets.map((preset) => (
                  <div className="preset-pill" key={preset.id}>
                    <button className="filter-chip active" onClick={() => applyPreset(preset)}>{preset.name}</button>
                    <button className="icon-button" onClick={() => deletePreset(preset.id)}>x</button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <aside className="filter-shell-side">
          <div className="stack">
            <div>
              <div className="subtle">View mode</div>
              <div className="segmented">
                <button className={`segment ${filters.viewMode === "details" ? "active" : ""}`} onClick={() => updateFilter("viewMode", "details")}>Details</button>
                <button className={`segment ${filters.viewMode === "thumbnails" ? "active" : ""}`} onClick={() => updateFilter("viewMode", "thumbnails")}>Thumbnails</button>
              </div>
            </div>
            <div>
              <div className="subtle">Columns</div>
              <div className="segmented">
                {[2, 3, 4, 5].map((column) => (
                  <button key={column} className={`segment ${filters.columns === column ? "active" : ""}`} onClick={() => updateFilter("columns", column)}>
                    {column}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="subtle">Active filters</div>
              <div className="active-filters">
                {summary.map((item) => (
                  <span className="pill" key={item}>{item}</span>
                ))}
              </div>
            </div>
            <div className="panel alt">
              <div className="subtle">Results snapshot</div>
              <h3 style={{ margin: "8px 0" }}>{total.toLocaleString()} matches</h3>
              <div className="subtle">Current selection is optimized for {filters.sort} with {filters.order} ordering.</div>
            </div>
          </div>
        </aside>
      </section>

      <div className="grid-2">
        <section className="stack">
          {loading ? <section className="panel">Loading outliers...</section> : null}
          {!loading && videos.length === 0 ? (
            <section className="panel alt">
              <h3 style={{ marginTop: 0 }}>No matches for this search</h3>
              <p className="subtle" style={{ marginBottom: 0 }}>
                Try widening the publication window, lowering min score, or clearing one of the numeric filters. If you expected results, confirm the selected project source set has scanned channels.
              </p>
            </section>
          ) : null}
          <div className={`card-grid ${filters.viewMode === "thumbnails" ? "card-grid-thumbnails" : ""}`} style={gridStyle}>
            {videos.map((video) => (
              <OutlierCard key={video.videoId} video={video} mode={filters.viewMode} onSelect={(item) => setSelected(item as Video)} />
            ))}
          </div>
        </section>

        <aside className="panel alt">
          <div className="eyebrow">Action drawer</div>
          {selected ? (
            <div className="stack">
              <div>
                <h2 style={{ marginBottom: 8 }}>{selected.title}</h2>
                <div className="subtle">{selected.channelName}</div>
              </div>
              <div className="metrics">
                <span className={`pill ${selected.scoreBand}`}>{selected.outlierScore.toFixed(1)}x</span>
                <span className="pill">{selected.views.toLocaleString()} views</span>
              </div>
              <div className="stack">
                <button className="button" onClick={() => void saveSelected()}>Save as reference</button>
                {boards[0] ? <button className="button secondary" onClick={() => void addToBoard(boards[0].id)}>Add to {boards[0].name}</button> : null}
                <button className="button secondary" onClick={() => void generateConcept()}>Generate concept</button>
                <a className="button secondary" href={`https://youtube.com/watch?v=${selected.videoId}`} target="_blank" rel="noreferrer">Open on YouTube</a>
              </div>
              <div className="panel">
                <div className="subtle" style={{ marginBottom: 8 }}>Similar topics</div>
                <div className="list">
                  {similarTopics.map((item) => (
                    <div className="list-row" key={item.videoId}>
                      <span>{item.title}</span>
                      <span className="pill">{(item.similarity * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="panel">
                <div className="subtle" style={{ marginBottom: 8 }}>Similar thumbnails</div>
                <div className="vision-board">
                  {similarThumbs.map((item) => (
                    <div className="vision-item" key={item.videoId}>
                      {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt={item.title} /> : <div className="thumb" style={{ aspectRatio: "16 / 9" }} />}
                    </div>
                  ))}
                </div>
              </div>
              <div className="panel">
                <div className="subtle" style={{ marginBottom: 8 }}>Configured providers</div>
                <div className="list">
                  {providers.length === 0 ? <div className="subtle">No provider configured. Heuristic mode will be used.</div> : providers.map((provider) => (
                    <div key={provider.id} className="list-row">
                      <span>{provider.name}</span>
                      <span className="subtle">{provider.provider}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="panel">
                <div className="subtle" style={{ marginBottom: 8 }}>Generate thumbnail with Kie Nano Banana 2</div>
                <label className="field">
                  <span>Character profile</span>
                  <select value={characterProfileId} onChange={(event) => setCharacterProfileId(event.target.value)}>
                    <option value="">None</option>
                    {profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>{profile.name}{profile.isDefault ? " (default)" : ""}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Prompt</span>
                  <textarea rows={5} value={thumbnailPrompt} onChange={(event) => setThumbnailPrompt(event.target.value)} />
                </label>
                <button className="button" style={{ marginTop: 12 }} onClick={() => void generateThumbnail()}>Generate actual thumbnail</button>
                {characterProfileId ? (
                  <div className="vision-board" style={{ marginTop: 12 }}>
                    {profiles.filter((profile) => String(profile.id) === characterProfileId && profile.faceSheetUrl).map((profile) => (
                      <div className="vision-item" key={profile.id}>
                        <img src={profile.faceSheetUrl ?? ""} alt={`${profile.name} face sheet`} />
                      </div>
                    ))}
                  </div>
                ) : null}
                {generatedThumbs?.downloadUrls?.length ? (
                  <div className="vision-board" style={{ marginTop: 14 }}>
                    {generatedThumbs.downloadUrls.map((url) => (
                      <div className="vision-item" key={url}>
                        <img src={url} alt="Generated thumbnail" />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              {resultText ? <pre className="panel" style={{ whiteSpace: "pre-wrap" }}>{resultText}</pre> : null}
            </div>
          ) : (
            <div className="subtle">Select an outlier to save, compare, or generate grounded ideas.</div>
          )}
        </aside>
      </div>
    </div>
  );
}
