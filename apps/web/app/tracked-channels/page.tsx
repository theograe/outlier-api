"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { ChannelAvatar } from "../../components/channel-avatar";

type TrackedChannel = {
  id: string;
  name: string;
  handle: string | null;
  subscriberCount: number;
  thumbnailUrl: string | null;
  relationship: string;
};

function formatCompactNumber(value?: number): string {
  if (!value) return "0";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export default function TrackedChannelsPage() {
  const [channels, setChannels] = useState<TrackedChannel[]>([]);
  const [channelInput, setChannelInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [error, setError] = useState("");

  async function loadChannels() {
    const rows = await apiFetch<TrackedChannel[]>("/api/tracked-channels");
    setChannels(rows);
  }

  useEffect(() => {
    void loadChannels().catch((fetchError) => setError(fetchError instanceof Error ? fetchError.message : "Failed to load tracked channels."));
  }, []);

  async function addTrackedChannel() {
    if (!channelInput.trim()) return;
    setLoading(true);
    setError("");
    try {
      await apiFetch("/api/tracked-channels", {
        method: "POST",
        body: JSON.stringify({
          channelUrl: channelInput.trim(),
          relationship: "competitor",
        }),
      });
      setChannelInput("");
      await loadChannels();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to add tracked channel.");
    } finally {
      setLoading(false);
    }
  }

  async function removeTrackedChannel(channelId: string) {
    setPendingIds((current) => [...current, channelId]);
    setError("");
    try {
      await apiFetch(`/api/tracked-channels/${channelId}`, { method: "DELETE" });
      setChannels((current) => current.filter((item) => item.id !== channelId));
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Failed to remove tracked channel.");
    } finally {
      setPendingIds((current) => current.filter((id) => id !== channelId));
    }
  }

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <div className="eyebrow">Tracked Channels</div>
          <h1 className="headline">Track channels once, browse the niche everywhere</h1>
          <div className="subtle">Add your own channel or a few relevant channels here. Browse uses them to understand the niche and surface stronger outliers.</div>
        </div>
      </header>

      {error ? <section className="panel">{error}</section> : null}

      <section className="panel stack">
        <div className="simple-toolbar">
          <input
            className="search-input grow"
            value={channelInput}
            onChange={(event) => setChannelInput(event.target.value)}
            placeholder="@channel, youtube.com/@channel, or channel URL"
          />
          <button className="button" disabled={loading || !channelInput.trim()} onClick={() => void addTrackedChannel()}>
            {loading ? "Adding..." : "Track channel"}
          </button>
        </div>
      </section>

      <section className="onboarding-channel-grid">
        {channels.map((item) => (
          <article key={item.id} className="onboarding-channel-card">
            <ChannelAvatar src={item.thumbnailUrl} alt={item.name} name={item.name} className="onboarding-channel-avatar" />
            <div className="onboarding-channel-body">
              <strong>{item.name}</strong>
              <div className="subtle">{item.handle ?? ""}</div>
              <div className="pill">{formatCompactNumber(item.subscriberCount)} subs</div>
            </div>
            <button
              type="button"
              className="button secondary"
              disabled={pendingIds.includes(item.id)}
              onClick={() => void removeTrackedChannel(item.id)}
            >
              {pendingIds.includes(item.id) ? "Removing..." : "Remove"}
            </button>
          </article>
        ))}
      </section>

      {channels.length === 0 ? <section className="panel alt">No tracked channels yet. Add your own channel or a few channels in your niche to shape Browse.</section> : null}
    </div>
  );
}
