"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";

type SettingsResponse = {
  productName: string;
  scanSchedule: string;
  defaultOutlierThreshold: number;
  embeddingsModel: string;
  youtubeApiKeyConfigured: boolean;
  apiKeyConfigured: boolean;
  openAiApiKeyConfigured: boolean;
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [scanSchedule, setScanSchedule] = useState("");
  const [defaultOutlierThreshold, setDefaultOutlierThreshold] = useState("3");
  const [embeddingsModel, setEmbeddingsModel] = useState("text-embedding-3-small");
  const [message, setMessage] = useState("");

  async function load() {
    const response = await apiFetch<SettingsResponse>("/api/settings");
    setSettings(response);
    setScanSchedule(response.scanSchedule);
    setDefaultOutlierThreshold(String(response.defaultOutlierThreshold));
    setEmbeddingsModel(response.embeddingsModel);
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveDefaults() {
    await apiFetch("/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        defaultOutlierThreshold: Number(defaultOutlierThreshold),
        embeddingsModel,
      }),
    });
    setMessage("Saved discovery defaults.");
    await load();
  }

  async function saveSchedule() {
    await apiFetch("/api/settings/scan-schedule", {
      method: "PUT",
      body: JSON.stringify({ cron: scanSchedule }),
    });
    setMessage("Saved scan schedule.");
    await load();
  }

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <div className="eyebrow">Settings</div>
          <h1 className="headline">Keep discovery running smoothly</h1>
          <p className="subtle">These settings only control scanning and how OpenOutlier ranks and groups outliers.</p>
        </div>
      </header>

      {message ? <section className="panel alt">{message}</section> : null}

      <section className="panel">
        <h2 style={{ marginTop: 0 }}>Discovery defaults</h2>
        <div className="form-grid">
          <label className="field">
            <span>Default outlier threshold</span>
            <input value={defaultOutlierThreshold} onChange={(event) => setDefaultOutlierThreshold(event.target.value)} />
          </label>
          <label className="field">
            <span>Embeddings model</span>
            <input value={embeddingsModel} onChange={(event) => setEmbeddingsModel(event.target.value)} />
          </label>
          <div className="field" style={{ alignSelf: "end" }}>
            <button className="button" onClick={() => void saveDefaults()}>Save defaults</button>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2 style={{ marginTop: 0 }}>Scan schedule</h2>
        <div className="form-grid">
          <label className="field">
            <span>Cron expression</span>
            <input value={scanSchedule} onChange={(event) => setScanSchedule(event.target.value)} />
          </label>
          <div className="field" style={{ alignSelf: "end" }}>
            <button className="button" onClick={() => void saveSchedule()}>Save schedule</button>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2 style={{ marginTop: 0 }}>Environment status</h2>
        <div className="metrics">
          <span className="pill">{settings?.youtubeApiKeyConfigured ? "YouTube key ready" : "YouTube key missing"}</span>
          <span className="pill">{settings?.apiKeyConfigured ? "API key ready" : "API key missing"}</span>
          <span className="pill">{settings?.openAiApiKeyConfigured ? "OpenAI key ready" : "OpenAI key missing"}</span>
        </div>
      </section>
    </div>
  );
}
