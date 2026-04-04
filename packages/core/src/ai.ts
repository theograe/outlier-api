const STOP_WORDS = new Set([
  "about",
  "after",
  "before",
  "from",
  "have",
  "into",
  "just",
  "like",
  "made",
  "more",
  "than",
  "that",
  "their",
  "them",
  "they",
  "this",
  "what",
  "when",
  "with",
  "your",
  "you",
  "how",
  "why",
  "video",
  "youtube",
]);

export function tokenizeTitle(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .filter((token) => !STOP_WORDS.has(token));
}

export function summarizePatterns(videos: Array<{ title: string }>): string[] {
  const counts = new Map<string, number>();

  for (const video of videos) {
    for (const token of tokenizeTitle(video.title)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([token]) => token);
}
