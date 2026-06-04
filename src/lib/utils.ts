import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

export function formatNumber(n: number, decimals = 2): string {
  return n.toFixed(decimals);
}

/**
 * Safely convert an ArrayBuffer to base64.
 * The spread-operator approach `btoa(String.fromCharCode(...new Uint8Array(buf)))`
 * overflows the call stack for files larger than ~500KB.
 */
export function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * Get the LM Studio base URL.
 * Priority: localStorage → NEXT_PUBLIC_LMSTUDIO_BASE_URL env → default
 * Always includes /v1 to match the OpenAI-compatible endpoint convention.
 */
export function getLmStudioUrl(): string {
  const stored =
    typeof window !== "undefined"
      ? localStorage.getItem("lmstudio_url")
      : null;
  const url = stored ?? process.env.NEXT_PUBLIC_LMSTUDIO_BASE_URL ?? "http://localhost:1234/v1";
  // Ensure /v1 suffix
  return url.endsWith("/v1") ? url : `${url.replace(/\/+$/, "")}/v1`;
}

/** Get the last-used LM Studio model ID */
export function getLmStudioModel(): string {
  return typeof window !== "undefined"
    ? (localStorage.getItem("lmstudio_model") ?? "local-model")
    : "local-model";
}
