"use client";

const API_URL = process.env.NEXT_PUBLIC_OPENOUTLIER_API_URL ?? "http://localhost:3001";
const API_KEY = process.env.NEXT_PUBLIC_OPENOUTLIER_API_KEY;

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(API_KEY ? { "x-api-key": API_KEY } : {}),
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<T>;
}
