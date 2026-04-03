import { config } from "../config.js";
import { chunk, sleep } from "../utils.js";

type YoutubeChannel = {
  id: string;
  snippet?: {
    title?: string;
    customUrl?: string;
    thumbnails?: {
      high?: { url?: string };
      medium?: { url?: string };
      default?: { url?: string };
    };
  };
  statistics?: {
    subscriberCount?: string;
  };
  contentDetails?: {
    relatedPlaylists?: {
      uploads?: string;
    };
  };
};

type PlaylistItem = {
  snippet?: {
    publishedAt?: string;
    resourceId?: { videoId?: string };
  };
};

type YoutubeVideo = {
  id: string;
  snippet?: {
    title?: string;
    publishedAt?: string;
    thumbnails?: {
      maxres?: { url?: string };
      high?: { url?: string };
      medium?: { url?: string };
      default?: { url?: string };
    };
  };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
  contentDetails?: {
    duration?: string;
  };
};

export type ResolvedChannel = {
  channelId: string;
  channelName: string;
  handle: string | null;
  subscriberCount: number;
  thumbnailUrl: string | null;
  uploadsPlaylistId: string | null;
};

export type YoutubeVideoRecord = {
  id: string;
  title: string;
  publishedAt: string | null;
  thumbnailUrl: string | null;
  views: number;
  likes: number;
  comments: number;
  duration: string | null;
};

export class YoutubeClient {
  private readonly minDelayMs: number;
  private lastRequestAt = 0;

  constructor() {
    this.minDelayMs = Math.ceil(1000 / Math.max(config.requestsPerSecond, 1));
  }

  async resolveChannel(input: string): Promise<ResolvedChannel> {
    const trimmed = input.trim();
    const directId = this.extractChannelId(trimmed);
    const handle = this.extractHandle(trimmed);

    if (directId) {
      const channel = await this.fetchChannel({ id: directId });
      return this.mapChannel(channel);
    }

    if (handle) {
      const channel = await this.fetchChannel({ forHandle: handle });
      return this.mapChannel(channel);
    }

    throw new Error("Unsupported channel format. Use a channel URL, handle, or raw channel ID.");
  }

  async fetchChannelById(channelId: string): Promise<ResolvedChannel> {
    const channel = await this.fetchChannel({ id: channelId });
    return this.mapChannel(channel);
  }

  async listRecentUploadVideoIds(uploadsPlaylistId: string, publishedAfter: Date): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;

    while (true) {
      const response = await this.request<{
        items?: PlaylistItem[];
        nextPageToken?: string;
      }>("playlistItems", {
        part: "snippet",
        playlistId: uploadsPlaylistId,
        maxResults: "50",
        pageToken,
      });

      const items = response.items ?? [];
      let sawOldVideo = false;

      for (const item of items) {
        const publishedAt = item.snippet?.publishedAt;
        const videoId = item.snippet?.resourceId?.videoId;
        if (!publishedAt || !videoId) {
          continue;
        }

        if (new Date(publishedAt) < publishedAfter) {
          sawOldVideo = true;
          continue;
        }

        ids.push(videoId);
      }

      if (!response.nextPageToken || sawOldVideo) {
        break;
      }

      pageToken = response.nextPageToken;
    }

    return ids;
  }

  async fetchVideos(videoIds: string[]): Promise<YoutubeVideoRecord[]> {
    const records: YoutubeVideoRecord[] = [];

    for (const group of chunk(videoIds, 50)) {
      const response = await this.request<{ items?: YoutubeVideo[] }>("videos", {
        part: "snippet,statistics,contentDetails",
        id: group.join(","),
        maxResults: "50",
      });

      for (const item of response.items ?? []) {
        records.push({
          id: item.id,
          title: item.snippet?.title ?? "Untitled",
          publishedAt: item.snippet?.publishedAt ?? null,
          thumbnailUrl:
            item.snippet?.thumbnails?.maxres?.url ??
            item.snippet?.thumbnails?.high?.url ??
            item.snippet?.thumbnails?.medium?.url ??
            item.snippet?.thumbnails?.default?.url ??
            null,
          views: Number(item.statistics?.viewCount ?? 0),
          likes: Number(item.statistics?.likeCount ?? 0),
          comments: Number(item.statistics?.commentCount ?? 0),
          duration: item.contentDetails?.duration ?? null,
        });
      }
    }

    return records;
  }

  private async fetchChannel(params: Record<string, string>): Promise<YoutubeChannel> {
    const response = await this.request<{ items?: YoutubeChannel[] }>("channels", {
      part: "snippet,statistics,contentDetails",
      ...params,
    });

    const channel = response.items?.[0];
    if (!channel) {
      throw new Error("Channel not found on YouTube.");
    }

    return channel;
  }

  private mapChannel(channel: YoutubeChannel): ResolvedChannel {
    return {
      channelId: channel.id,
      channelName: channel.snippet?.title ?? "Unknown channel",
      handle: channel.snippet?.customUrl ? `@${channel.snippet.customUrl.replace(/^@/, "")}` : null,
      subscriberCount: Number(channel.statistics?.subscriberCount ?? 0),
      thumbnailUrl:
        channel.snippet?.thumbnails?.high?.url ??
        channel.snippet?.thumbnails?.medium?.url ??
        channel.snippet?.thumbnails?.default?.url ??
        null,
      uploadsPlaylistId: channel.contentDetails?.relatedPlaylists?.uploads ?? null,
    };
  }

  private extractChannelId(input: string): string | null {
    if (/^UC[\w-]{20,}$/.test(input)) {
      return input;
    }

    const match = input.match(/youtube\.com\/channel\/(UC[\w-]{20,})/i);
    return match?.[1] ?? null;
  }

  private extractHandle(input: string): string | null {
    if (/^@[\w.-]+$/.test(input)) {
      return input.slice(1);
    }

    const match = input.match(/youtube\.com\/@([\w.-]+)/i);
    return match?.[1] ?? null;
  }

  private async request<T>(resource: string, params: Record<string, string | undefined>, attempt = 0): Promise<T> {
    const waitMs = this.minDelayMs - (Date.now() - this.lastRequestAt);
    if (waitMs > 0) {
      await sleep(waitMs);
    }

    const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
    url.searchParams.set("key", config.youtubeApiKey);

    for (const [key, value] of Object.entries(params)) {
      if (value) {
        url.searchParams.set(key, value);
      }
    }

    this.lastRequestAt = Date.now();
    const response = await fetch(url);

    if (!response.ok) {
      if ((response.status === 403 || response.status === 429) && attempt < 4) {
        await sleep(2 ** attempt * 500);
        return this.request<T>(resource, params, attempt + 1);
      }

      const message = await response.text();
      throw new Error(`YouTube API error (${response.status}): ${message}`);
    }

    return (await response.json()) as T;
  }
}
