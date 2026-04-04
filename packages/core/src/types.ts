export type ScoreBand = "warm" | "hot" | "fire";

export type DiscoverVideo = {
  videoId: string;
  title: string;
  channelId: string;
  channelName: string;
  channelHandle: string | null;
  channelSubscribers: number;
  channelMedianViews: number;
  views: number;
  likes: number;
  comments: number;
  publishedAt: string | null;
  thumbnailUrl: string | null;
  videoUrl: string;
  outlierScore: number;
  viewVelocity: number;
  engagementRatio: number;
  duration: string | null;
  durationSeconds: number;
  contentType: "long" | "short";
  scoreBand: ScoreBand;
  lists: string[];
  projectReferenceId?: number | null;
};

export type SavedOutlierInput = {
  videoId: string;
  notes?: string | null;
  tags?: string[];
  listId?: number | null;
};

export type IdeaGenerationKind =
  | "idea"
  | "title_set"
  | "thumbnail_brief"
  | "hook_angles"
  | "channel_strategy_summary";

export type LlmProviderMode = "api_key" | "oauth";

export type LlmProviderConfig = {
  id: number;
  name: string;
  provider: "openai" | "anthropic" | "openrouter";
  mode: LlmProviderMode;
  apiKey: string | null;
  oauthConfigJson: string | null;
  model: string | null;
  isActive: number;
};

export type PromptSourceVideo = Pick<
  DiscoverVideo,
  | "videoId"
  | "title"
  | "channelName"
  | "views"
  | "outlierScore"
  | "viewVelocity"
  | "lists"
  | "publishedAt"
>;
