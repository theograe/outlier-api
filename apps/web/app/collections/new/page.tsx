"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "../../../lib/api";

type CreatedCollection = { id: number };

export default function NewCollectionPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [niche, setNiche] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  async function createCollection() {
    if (!name.trim()) return;

    setCreating(true);
    setError("");

    try {
      const collection = await apiFetch<CreatedCollection>("/api/collections", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          niche: niche.trim() || null,
        }),
      });

      router.push(`/collections/${collection.id}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create collection.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <div className="eyebrow">Collections</div>
          <h1 className="headline">Create a collection</h1>
          <div className="subtle">Collections are just saved-video folders. Track channels separately, then save the best outliers here.</div>
        </div>
      </header>

      {error ? <section className="panel panel-error">{error}</section> : null}

      <section className="panel stack">
        <div className="field">
          <span>Collection name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Editing references" />
        </div>

        <div className="field">
          <span>Niche label (optional)</span>
          <input value={niche} onChange={(event) => setNiche(event.target.value)} placeholder="English video editing tutorials" />
        </div>

        <div className="simple-toolbar">
          <button className="button" disabled={creating || !name.trim()} onClick={() => void createCollection()}>
            {creating ? "Creating..." : "Create collection"}
          </button>
        </div>
      </section>

      <section className="panel alt stack">
        <div>
          <strong>Need to shape Browse first?</strong>
          <div className="subtle">Add your own channel or a few relevant channels in Tracked Channels, then come back and save the best videos into collections.</div>
        </div>
        <div className="simple-toolbar">
          <Link className="button secondary" href="/tracked-channels">Open Tracked Channels</Link>
        </div>
      </section>
    </div>
  );
}
