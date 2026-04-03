import cron, { type ScheduledTask } from "node-cron";
import { db, getSetting, upsertSetting } from "../db.js";
import { config } from "../config.js";
import { isoNow, median, subtractDays } from "../utils.js";
import { YoutubeClient } from "./youtube.js";

type ScanStatus = {
  running: boolean;
  currentRun: null | {
    listId: number | null;
    startedAt: string;
    progressCurrent: number;
    progressTotal: number;
    message: string;
  };
  lastRun: null | {
    status: string;
    listId: number | null;
    startedAt: string;
    completedAt: string | null;
    progressCurrent: number;
    progressTotal: number;
    message: string | null;
  };
};

export class ScanService {
  private readonly youtubeClient = new YoutubeClient();
  private currentRunId: number | null = null;
  private scheduler: ScheduledTask | null = null;

  startScheduler(): void {
    const cronExpression = getSetting("scan_schedule") ?? config.scanSchedule;
    this.scheduler?.stop();
    this.scheduler = cron.schedule(cronExpression, () => {
      void this.triggerScan();
    });
  }

  updateSchedule(cronExpression: string): void {
    upsertSetting("scan_schedule", cronExpression);
    this.startScheduler();
  }

  getStatus(): ScanStatus {
    const currentRun =
      this.currentRunId === null
        ? null
        : ((db
            .prepare("SELECT scope_list_id, started_at, progress_current, progress_total, message FROM scan_runs WHERE id = ?")
            .get(this.currentRunId) as {
            scope_list_id: number | null;
            started_at: string;
            progress_current: number;
            progress_total: number;
            message: string;
          } | null) ?? null);

    const lastRun = (db
      .prepare(`
        SELECT status, scope_list_id, started_at, completed_at, progress_current, progress_total, message
        FROM scan_runs
        ORDER BY id DESC
        LIMIT 1
      `)
      .get() as
      | {
          status: string;
          scope_list_id: number | null;
          started_at: string;
          completed_at: string | null;
          progress_current: number;
          progress_total: number;
          message: string | null;
        }
      | undefined) ?? null;

    return {
      running: this.currentRunId !== null,
      currentRun: currentRun
        ? {
            listId: currentRun.scope_list_id,
            startedAt: currentRun.started_at,
            progressCurrent: currentRun.progress_current,
            progressTotal: currentRun.progress_total,
            message: currentRun.message,
          }
        : null,
      lastRun: lastRun
        ? {
            status: lastRun.status,
            listId: lastRun.scope_list_id,
            startedAt: lastRun.started_at,
            completedAt: lastRun.completed_at,
            progressCurrent: lastRun.progress_current,
            progressTotal: lastRun.progress_total,
            message: lastRun.message,
          }
        : null,
    };
  }

  async triggerScan(listId?: number): Promise<{ runId: number }> {
    if (this.currentRunId !== null) {
      throw new Error("A scan is already running.");
    }

    const channels = this.getChannelsForScan(listId);
    const startedAt = isoNow();
    const insert = db
      .prepare(`
        INSERT INTO scan_runs (status, scope_list_id, started_at, progress_current, progress_total, message)
        VALUES (?, ?, ?, 0, ?, ?)
      `)
      .run("running", listId ?? null, startedAt, channels.length, "Starting scan");

    const runId = Number(insert.lastInsertRowid);
    this.currentRunId = runId;

    try {
      for (let index = 0; index < channels.length; index += 1) {
        const channelId = channels[index].id;
        this.updateRun(index, channels.length, `Scanning ${channels[index].name}`);
        await this.scanChannel(channelId);
      }

      this.finishRun("completed", "Scan completed successfully.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected scan error";
      this.finishRun("failed", message);
      throw error;
    }

    return { runId };
  }

  private getChannelsForScan(listId?: number): Array<{ id: string; name: string }> {
    if (listId) {
      return db
        .prepare(`
          SELECT DISTINCT channels.id, channels.name
          FROM channels
          INNER JOIN list_channels ON list_channels.channel_id = channels.id
          WHERE list_channels.list_id = ?
          ORDER BY channels.name
        `)
        .all(listId) as Array<{ id: string; name: string }>;
    }

    return db.prepare("SELECT id, name FROM channels ORDER BY name").all() as Array<{
      id: string;
      name: string;
    }>;
  }

  private async scanChannel(channelId: string): Promise<void> {
    const channel = await this.youtubeClient.fetchChannelById(channelId);

    db.prepare(`
      UPDATE channels
      SET name = ?, handle = ?, subscriber_count = ?, thumbnail_url = ?, uploads_playlist_id = ?
      WHERE id = ?
    `).run(
      channel.channelName,
      channel.handle,
      channel.subscriberCount,
      channel.thumbnailUrl,
      channel.uploadsPlaylistId,
      channel.channelId,
    );

    if (!channel.uploadsPlaylistId) {
      return;
    }

    const publishedAfter = subtractDays(365);
    const videoIds = await this.youtubeClient.listRecentUploadVideoIds(channel.uploadsPlaylistId, publishedAfter);
    const videos = await this.youtubeClient.fetchVideos(videoIds);
    const now = isoNow();

    const insertVideo = db.prepare(`
      INSERT INTO videos (
        id, channel_id, title, published_at, thumbnail_url, views, likes, comments, duration,
        outlier_score, view_velocity, engagement_ratio, scanned_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        channel_id = excluded.channel_id,
        title = excluded.title,
        published_at = excluded.published_at,
        thumbnail_url = excluded.thumbnail_url,
        views = excluded.views,
        likes = excluded.likes,
        comments = excluded.comments,
        duration = excluded.duration,
        outlier_score = excluded.outlier_score,
        view_velocity = excluded.view_velocity,
        engagement_ratio = excluded.engagement_ratio,
        scanned_at = excluded.scanned_at
    `);

    const viewValues = videos.map((video) => video.views).filter((views) => views > 0);
    const medianViews = median(viewValues);
    const safeMedian = medianViews > 0 ? medianViews : 1;

    const transaction = db.transaction(() => {
      for (const video of videos) {
        const daysSincePublished = Math.max(
          (Date.now() - new Date(video.publishedAt ?? now).getTime()) / (1000 * 60 * 60 * 24),
          1,
        );
        const outlierScore = Number((video.views / safeMedian).toFixed(4));
        const viewVelocity = Number((video.views / daysSincePublished).toFixed(4));
        const engagementRatio = video.views > 0 ? Number(((video.likes + video.comments) / video.views).toFixed(4)) : 0;

        insertVideo.run(
          video.id,
          channelId,
          video.title,
          video.publishedAt,
          video.thumbnailUrl,
          video.views,
          video.likes,
          video.comments,
          video.duration,
          outlierScore,
          viewVelocity,
          engagementRatio,
          now,
        );
      }

      db.prepare("UPDATE channels SET median_views = ?, last_scanned_at = ? WHERE id = ?").run(
        medianViews,
        now,
        channelId,
      );
      db.prepare("DELETE FROM videos WHERE channel_id = ? AND published_at < ?").run(channelId, publishedAfter.toISOString());
    });

    transaction();
  }

  private updateRun(progressCurrent: number, progressTotal: number, message: string): void {
    if (this.currentRunId === null) {
      return;
    }

    db.prepare(`
      UPDATE scan_runs
      SET progress_current = ?, progress_total = ?, message = ?
      WHERE id = ?
    `).run(progressCurrent, progressTotal, message, this.currentRunId);
  }

  private finishRun(status: string, message: string): void {
    if (this.currentRunId === null) {
      return;
    }

    db.prepare(`
      UPDATE scan_runs
      SET status = ?, completed_at = ?, progress_current = progress_total, message = ?
      WHERE id = ?
    `).run(status, isoNow(), message, this.currentRunId);

    this.currentRunId = null;
  }
}
