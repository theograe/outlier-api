"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../lib/api";
import { OutlierCard } from "../../components/outlier-card";

type Video = {
  videoId: string;
  title: string;
  channelName: string;
  channelId: string;
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
};

type ProjectDetail = {
  id: number;
  name: string;
  niche: string | null;
  sourceSets: Array<{ id: number; name: string; role: string; channelCount: number }>;
};

type SimilarItem = { videoId: string; title: string; channelName: string; similarity: number };
type DiscoverResponse = { videos: Video[]; total: number };

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
};

const defaultFilters: FilterState = {
  search: "",
  projectId: "",
  sourceSetId: "",
  contentType: "long",
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
};

const publicationPresets = [
  { label: "7 days", days: "7" },
  { label: "30 days", days: "30" },
  { label: "90 days", days: "90" },
  { label: "6 months", days: "180" },
  { label: "1 year", days: "365" },
  { label: "2 years", days: "730" },
];

function normalizeNumeric(input: string): string {
  return input.replace(/[^\d.]/g, "");
}

export default function DiscoverPage() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [total, setTotal] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectDetail, setProjectDetail] = useState<ProjectDetail | null>(null);
  const [selected, setSelected] = useState<Video | null>(null);
  const [similarTopics, setSimilarTopics] = useState<SimilarItem[]>([]);
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [resultText, setResultText] = useState("");
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
    void apiFetch<Project[]>("/api/projects")
      .then((projectRows) => {
        setProjects(projectRows);
        setFilters((current) => {
          if (current.projectId || projectRows.length === 0) return current;
          return { ...current, projectId: String(projectRows[0].id) };
        });
      })
      .catch((fetchError) => setError(fetchError instanceof Error ? fetchError.message : "Failed to load projects."));
  }, []);

  useEffect(() => {
    if (!filters.projectId) {
      setProjectDetail(null);
      return;
    }

    void apiFetch<ProjectDetail>(`/api/projects/${filters.projectId}`)
      .then((detail) => {
        setProjectDetail(detail);
        setFilters((current) => {
          if (current.projectId !== String(detail.id)) return current;
          if (current.sourceSetId && detail.sourceSets.some((sourceSet) => String(sourceSet.id) === current.sourceSetId)) return current;
          return { ...current, sourceSetId: detail.sourceSets[0] ? String(detail.sourceSets[0].id) : "" };
        });
      })
      .catch((fetchError) => setError(fetchError instanceof Error ? fetchError.message : "Failed to load project detail."));
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
      .catch((fetchError) => setError(fetchError instanceof Error ? fetchError.message : "Failed to load outliers."))
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(() => {
    if (!selected) {
      setSimilarTopics([]);
      return;
    }

    void apiFetch<{ items: SimilarItem[] }>(`/api/discover/similar-topics?videoId=${selected.videoId}&limit=6`)
      .then((topics) => setSimilarTopics(topics.items))
      .catch(() => setSimilarTopics([]));
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

  async function saveSelected() {
    if (!selected || !filters.projectId) return;
    await apiFetch(`/api/projects/${filters.projectId}/references`, {
      method: "POST",
      body: JSON.stringify({
        sourceSetId: filters.sourceSetId ? Number(filters.sourceSetId) : null,
        videoId: selected.videoId,
        kind: "outlier",
        tags: ["saved-from-discover"],
      }),
    });
    setResultText("Saved to this project.");
  }

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <div className="eyebrow">Discover</div>
          <h1 className="headline">Find outlier ideas in your niche</h1>
          <p className="subtle">Filter by project, scan window, score, and channel size. Save anything worth studying as a reference.</p>
        </div>
      </header>

      {error ? <section className="panel" style={{ borderColor: "var(--line-strong)", color: "var(--text)" }}>{error}</section> : null}
      {resultText ? <section className="panel alt">{resultText}</section> : null}

      <section className="panel filter-shell">
        <div className="filter-shell-main">
          <div className="filter-topbar">
            <div>
              <div className="eyebrow">Filters</div>
              <h2 style={{ margin: "8px 0 0" }}>Keep the feed tight</h2>
            </div>
            <div className="metrics">
              <button className="button secondary" onClick={resetFilters}>Reset</button>
            </div>
          </div>

          <div className="filter-grid">
            <label className="field filter-span-2">
              <span>Search</span>
              <input value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} placeholder="editing tutorials, alex hormozi, reels..." />
            </label>
            <label className="field">
              <span>Project</span>
              <select value={filters.projectId} onChange={(event) => updateFilter("projectId", event.target.value)}>
                <option value="">All projects</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Source set</span>
              <select value={filters.sourceSetId} onChange={(event) => updateFilter("sourceSetId", event.target.value)}>
                <option value="">All source sets</option>
                {projectDetail?.sourceSets.map((sourceSet) => (
                  <option key={sourceSet.id} value={sourceSet.id}>{sourceSet.name}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Video type</span>
              <select value={filters.contentType} onChange={(event) => updateFilter("contentType", event.target.value as FilterState["contentType"])}>
                <option value="all">All videos</option>
                <option value="long">Exclude shorts</option>
                <option value="short">Only shorts</option>
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
              <span>Min score</span>
              <input value={filters.minScore} onChange={(event) => updateFilter("minScore", normalizeNumeric(event.target.value))} />
            </label>
            <label className="field">
              <span>Max score</span>
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
              <span>Min subs</span>
              <input value={filters.minSubscribers} onChange={(event) => updateFilter("minSubscribers", normalizeNumeric(event.target.value))} placeholder="0" />
            </label>
            <label className="field">
              <span>Max subs</span>
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
          </div>

          <div className="filter-chip-row">
            {publicationPresets.map((preset) => (
              <button key={preset.days} className={`filter-chip ${filters.days === preset.days ? "active" : ""}`} onClick={() => updateFilter("days", preset.days)}>
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <aside className="filter-shell-side">
          <div className="panel alt">
            <div className="subtle">Matches</div>
            <h3 style={{ margin: "8px 0" }}>{total.toLocaleString()}</h3>
            <div className="subtle">{filters.contentType === "long" ? "Shorts excluded." : filters.contentType === "short" ? "Shorts only." : "All video types."}</div>
          </div>
        </aside>
      </section>

      <div className="grid-2">
        <section className="stack">
          {loading ? <section className="panel">Loading outliers...</section> : null}
          {!loading && videos.length === 0 ? (
            <section className="panel alt">
              <h3 style={{ marginTop: 0 }}>No matches yet</h3>
              <p className="subtle" style={{ marginBottom: 0 }}>
                Try widening the date range, lowering the score threshold, or removing a tighter limit. If you expected results, make sure this project has scanned channels.
              </p>
            </section>
          ) : null}
          <div className="card-grid">
            {videos.map((video) => (
              <OutlierCard key={video.videoId} video={video} onSelect={(item) => setSelected(item as Video)} />
            ))}
          </div>
        </section>

        <aside className="panel alt">
          <div className="eyebrow">Selected video</div>
          {selected ? (
            <div className="stack">
              <div>
                <h2 style={{ marginBottom: 8 }}>{selected.title}</h2>
                <div className="subtle">{selected.channelName}</div>
              </div>
              <div className="metrics">
                <span className={`pill ${selected.scoreBand}`}>{selected.outlierScore.toFixed(1)}x</span>
                <span className="pill">{selected.views.toLocaleString()} views</span>
                <span className="pill">{Math.round(selected.viewVelocity).toLocaleString()}/day</span>
              </div>
              <div className="stack">
                <button className="button" onClick={() => void saveSelected()}>Save as reference</button>
                <a className="button secondary" href={`https://youtube.com/watch?v=${selected.videoId}`} target="_blank" rel="noreferrer">Open on YouTube</a>
              </div>
              <div className="panel">
                <div className="subtle" style={{ marginBottom: 8 }}>Related titles</div>
                <div className="list">
                  {similarTopics.map((item) => (
                    <div className="list-row" key={item.videoId}>
                      <span>{item.title}</span>
                      <span className="pill">{(item.similarity * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="subtle">Pick an outlier to review it and save it into the project.</div>
          )}
        </aside>
      </div>
    </div>
  );
}
