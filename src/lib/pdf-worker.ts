/**
 * PDF.js worker setup for react-pdf + Next.js / Turbopack
 *
 * react-pdf v10 uses pdfjs-dist v5, so we must point the internal PDF.js
 * worker to the matching v5 classic worker file in /public.
 *
 * /public/pdf.worker.min.mjs  ← pdfjs v5 (used here)
 * /public/pdf.worker.min.js   ← pdfjs v3 (legacy / compatibility only)
 *
 * This module is a singleton — safe to import from any number of components.
 */

let _ready = false;

export function setupPdfWorker(): void {
  if (typeof window === "undefined" || _ready) return;
  _ready = true;

  // Import the pdfjs instance that react-pdf uses internally (v5.x),
  // then point it at the matching v5 classic worker already in /public.
  import("react-pdf").then(({ pdfjs }) => {
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  }).catch(() => {
    // react-pdf unavailable — no-op
  });
}
