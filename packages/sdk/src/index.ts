export type OpenOutlierClientOptions = {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
};

export type Project = {
  id: number;
  name: string;
  niche: string | null;
  status: string;
  primaryChannelId: string | null;
  primaryChannelName: string | null;
  sourceSetCount: number;
  referenceCount: number;
  createdAt: string;
  updatedAt: string;
};

export class OpenOutlierClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenOutlierClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? fetch;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "x-api-key": this.apiKey,
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    return response.json() as Promise<T>;
  }

  health() {
    return this.request<{ ok: boolean; service: string; timestamp: string }>("/api/health", { headers: {} });
  }

  listProjects() {
    return this.request<Project[]>("/api/projects");
  }

  createProject(input: {
    name: string;
    niche?: string | null;
    primaryChannelInput?: string | null;
    competitorSourceSetName?: string | null;
  }) {
    return this.request<Record<string, unknown>>("/api/projects", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  getProject(projectId: number) {
    return this.request<Record<string, unknown>>(`/api/projects/${projectId}`);
  }

  createSourceSet(projectId: number, input: { name: string; role?: string; discoveryMode?: string }) {
    return this.request<Record<string, unknown>>(`/api/projects/${projectId}/source-sets`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  getSourceSet(sourceSetId: number) {
    return this.request<Record<string, unknown>>(`/api/source-sets/${sourceSetId}`);
  }

  addChannelToSourceSet(sourceSetId: number, input: {
    channelUrl?: string;
    channelId?: string;
    handle?: string;
    relationship?: string;
  }) {
    return this.request<Record<string, unknown>>(`/api/source-sets/${sourceSetId}/channels`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  discoverChannels(sourceSetId: number, input: { query?: string; niche?: string; limit?: number; autoAttach?: boolean }) {
    return this.request<Record<string, unknown>>(`/api/source-sets/${sourceSetId}/discover`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  searchReferences(projectId: number, input: Record<string, unknown>) {
    return this.request<Record<string, unknown>>(`/api/projects/${projectId}/references/search`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  listReferences(projectId: number) {
    return this.request<Record<string, unknown>[]>(`/api/projects/${projectId}/references`);
  }

  saveReference(projectId: number, input: {
    sourceSetId?: number | null;
    videoId: string;
    kind?: string;
    notes?: string | null;
    tags?: string[];
  }) {
    return this.request<Record<string, unknown>>(`/api/projects/${projectId}/references`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  importReferenceVideo(projectId: number, input: { sourceSetId?: number | null; videoId?: string | null; videoUrl?: string | null }) {
    return this.request<Record<string, unknown>>(`/api/projects/${projectId}/references/import-video`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  triggerScan(listId?: number) {
    return this.request<Record<string, unknown>>("/api/scan", {
      method: "POST",
      body: JSON.stringify(listId ? { listId } : {}),
    });
  }

  getScanStatus() {
    return this.request<Record<string, unknown>>("/api/scan/status");
  }
}
