"use client";

type Video = {
  videoId: string;
  title: string;
  channelName: string;
  views: number;
  outlierScore: number;
  viewVelocity: number;
  scoreBand: string;
  contentType: string;
  channelSubscribers?: number;
  durationSeconds?: number;
  publishedAt?: string | null;
};

function formatCompactDuration(durationSeconds?: number): string {
  if (!durationSeconds) return "";
  const hours = Math.floor(durationSeconds / 3600);
  const minutes = Math.floor((durationSeconds % 3600) / 60);
  const seconds = durationSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatVideoType(contentType: string): string {
  return contentType === "short" ? "Short" : "Video";
}

export function OutlierCard({
  video,
  onSelect,
}: {
  video: Video;
  onSelect?: (video: Video) => void;
}) {
  return (
    <article className="card card-simple" onClick={() => onSelect?.(video)} style={{ cursor: onSelect ? "pointer" : "default" }}>
      <div className="card-body card-body-simple">
        <div className="metrics" style={{ marginBottom: 10 }}>
          <span className={`pill ${video.scoreBand}`}>{video.outlierScore.toFixed(1)}x</span>
          <span className="pill">{formatVideoType(video.contentType)}</span>
          <span className="pill">{Math.round(video.viewVelocity).toLocaleString()}/day</span>
        </div>
        <h3 style={{ margin: "0 0 8px", fontSize: 20 }}>{video.title}</h3>
        <div className="subtle" style={{ marginBottom: 14 }}>{video.channelName}</div>
        <div className="metrics">
          <span className="pill">{video.views.toLocaleString()} views</span>
          {video.channelSubscribers ? <span className="pill">{video.channelSubscribers.toLocaleString()} subs</span> : null}
          {video.durationSeconds ? <span className="pill">{formatCompactDuration(video.durationSeconds)}</span> : null}
          {video.publishedAt ? <span className="pill">{new Date(video.publishedAt).toLocaleDateString()}</span> : null}
        </div>
      </div>
    </article>
  );
}
