"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";

type Project = { id: number; name: string };
type Board = { id: number; name: string; description: string | null; itemCount: number; project_id: number | null };
type BoardDetail = Board & { items: Array<{ id: number; title: string; thumbnailUrl: string | null; channelName: string }> };

export default function BoardsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [boards, setBoards] = useState<Board[]>([]);
  const [selected, setSelected] = useState<BoardDetail | null>(null);
  const [name, setName] = useState("");

  async function load(nextProjectId?: string) {
    const activeProjectId = nextProjectId ?? projectId;
    const [projectRows, boardRows] = await Promise.all([
      apiFetch<Project[]>("/api/projects"),
      activeProjectId ? apiFetch<Board[]>(`/api/boards?projectId=${activeProjectId}`) : apiFetch<Board[]>("/api/boards"),
    ]);
    setProjects(projectRows);
    if (!activeProjectId && projectRows[0]) {
      setProjectId(String(projectRows[0].id));
      return load(String(projectRows[0].id));
    }
    setBoards(boardRows);
    if (boardRows[0]) {
      const detail = await apiFetch<BoardDetail>(`/api/boards/${boardRows[0].id}`);
      setSelected(detail);
    } else {
      setSelected(null);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createBoard() {
    if (!name.trim()) return;
    await apiFetch("/api/boards", {
      method: "POST",
      body: JSON.stringify({ name, projectId: projectId ? Number(projectId) : null }),
    });
    setName("");
    await load(projectId);
  }

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <div className="eyebrow">Boards</div>
          <h1 className="headline">Build visual swipe files inside each project</h1>
        </div>
      </header>

      <section className="panel">
        <div className="toolbar">
          <label className="field">
            <span>Project</span>
            <select value={projectId} onChange={(event) => {
              setProjectId(event.target.value);
              void load(event.target.value);
            }}>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>New board</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="High drama thumbnails" />
          </label>
          <div className="field" style={{ alignSelf: "end" }}>
            <button className="button" onClick={() => void createBoard()}>Create board</button>
          </div>
        </div>
      </section>

      <div className="grid-2">
        <section className="panel">
          <div className="list">
            {boards.map((board) => (
              <button key={board.id} className="list-row" style={{ background: "transparent", border: 0, color: "inherit" }} onClick={() => void apiFetch<BoardDetail>(`/api/boards/${board.id}`).then(setSelected)}>
                <span>{board.name}</span>
                <span className="pill">{board.itemCount} items</span>
              </button>
            ))}
            {boards.length === 0 ? <div className="subtle">No boards yet for this project.</div> : null}
          </div>
        </section>
        <section className="panel alt">
          <div className="eyebrow">Vision board</div>
          <h2>{selected?.name ?? "No board selected"}</h2>
          <div className="vision-board">
            {selected?.items.map((item) => (
              <div key={item.id} className="vision-item">
                {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt={item.title} /> : <div className="thumb" style={{ aspectRatio: "16 / 9" }} />}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
