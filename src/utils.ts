export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function subtractDays(days: number): Date {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() - days);
  return value;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

export function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return Math.round((sorted[midpoint - 1] + sorted[midpoint]) / 2);
  }

  return sorted[midpoint];
}

export function safeNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function tokenizeTitle(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .filter((token) => !STOP_WORDS.has(token));
}

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
]);
