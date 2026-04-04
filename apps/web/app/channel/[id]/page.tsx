"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../../lib/api";

type ChannelResponse = {
  id: string;
  name: string;
  handle: string | null;
  subscriber_count: number | null;
  thumbnail_url: string | null;
  video_count: number;
  top_outlier_score: number | null;
  average_views: number | null;
  projects: Array<{ id: number; name: string; relationship: string }>;
  sourceSets: Array<{ id: number; name: string; role: string; relationship: string }>;
  patternSummary: unknown;
  relatedChannels: unknown;
};

export default function ChannelPage({ params }: { params: Promise<{ id: string }> }) {
  const [channel, setChannel] = useState<ChannelResponse | null>(null);

  useEffect(() => {
    void params.then(({ id }) => apiFetch<ChannelResponse>(`/api/channels/${id}`).then(setChannel));
  }, [params]);

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <div className="eyebrow">Channel</div>
          <h1 className="headline">{channel?.name ?? "Loading channel..."}</h1>
          <div className="subtle">{channel?.handle ?? ""}</div>
        </div>
      </header>
      {channel ? (
        <>
          <section className="panel">
            <div className="metrics">
              <span className="pill">{Number(channel.subscriber_count ?? 0).toLocaleString()} subs</span>
              <span className="pill">{channel.video_count} videos</span>
              <span className="pill">{Number(channel.average_views ?? 0).toLocaleString()} avg views</span>
              <span className="pill">{Number(channel.top_outlier_score ?? 0).toFixed(1)}x top score</span>
            </div>
          </section>

          <section className="grid-2">
            <div className="panel">
              <div className="eyebrow">Projects</div>
              <div className="list" style={{ marginTop: 12 }}>
                {channel.projects.map((project) => (
                  <div key={project.id} className="list-row">
                    <span>{project.name}</span>
                    <span className="pill">{project.relationship}</span>
                  </div>
                ))}
                {channel.projects.length === 0 ? <div className="subtle">Not attached to any projects.</div> : null}
              </div>
            </div>
            <div className="panel alt">
              <div className="eyebrow">Source sets</div>
              <div className="list" style={{ marginTop: 12 }}>
                {channel.sourceSets.map((sourceSet) => (
                  <div key={sourceSet.id} className="list-row">
                    <span>{sourceSet.name}</span>
                    <span className="pill">{sourceSet.relationship}</span>
                  </div>
                ))}
                {channel.sourceSets.length === 0 ? <div className="subtle">Not attached to any source sets.</div> : null}
              </div>
            </div>
          </section>

          <pre className="panel" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify({
            patternSummary: channel.patternSummary,
            relatedChannels: channel.relatedChannels,
          }, null, 2)}</pre>
        </>
      ) : null}
    </div>
  );
}
