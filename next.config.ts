import type { NextConfig } from "next";
import path from "path";
import fs from "fs";

// Auto-copy pdf.worker.min.mjs (pdfjs-dist v5 uses .mjs) to public/
const workerCandidates = [
  // pdfjs-dist v5 (ESM .mjs)
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  "node_modules/react-pdf/node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  // legacy fallbacks
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
];
const workerDest = path.join(process.cwd(), "public/pdf.worker.min.mjs");
// Only copy the worker when building for production or when the dest is missing.
// Avoids slow filesystem work during frequent dev restarts.
if (process.env.NODE_ENV === "production" || !fs.existsSync(workerDest)) {
  for (const src of workerCandidates) {
    const full = path.join(process.cwd(), src);
    if (fs.existsSync(full)) {
      fs.copyFileSync(full, workerDest);
      console.log(`[OK] Copied pdf.worker.min.mjs from ${src}`);
      break;
    }
  }
}

// Auto-copy web-ifc WASM (v0.0.39, bundled inside web-ifc-three) to public/
// Must serve with Content-Type: application/wasm — configured in headers below.
const wasmSrc = path.join(process.cwd(), "node_modules/web-ifc-three/node_modules/web-ifc/web-ifc.wasm");
const wasmDest = path.join(process.cwd(), "public/web-ifc.wasm");
const wasmMtSrc = path.join(process.cwd(), "node_modules/web-ifc-three/node_modules/web-ifc/web-ifc-mt.wasm");
const wasmMtDest = path.join(process.cwd(), "public/web-ifc-mt.wasm");
if (fs.existsSync(wasmSrc) && !fs.existsSync(wasmDest)) {
  fs.copyFileSync(wasmSrc,   wasmDest);
  fs.copyFileSync(wasmMtSrc, wasmMtDest);
  console.log("[OK] Copied web-ifc WASM v0.0.39 to public/");
}

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      canvas: "./src/lib/canvas-stub.ts",
      // Prisma 7 renamed runtime/library → runtime/client
      "@prisma/client/runtime/library": "@prisma/client/runtime/client",
    },
  },
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      canvas: path.join(process.cwd(), "src/lib/canvas-stub.ts"),
      // Prisma 7 renamed runtime/library → runtime/client
      "@prisma/client/runtime/library": require.resolve("@prisma/client/runtime/client"),
    };
    return config;
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
      { protocol: "http",  hostname: "localhost" },
    ],
  },
  // Serve WASM files with correct MIME type
  async headers() {
    return [
      {
        source: "/:path*.wasm",
        headers: [
          { key: "Content-Type", value: "application/wasm" },
        ],
      },
    ];
  },
  serverExternalPackages: [
    "pdf-lib", "exceljs", "pdf-parse", "pdfjs-dist",
    "@prisma/adapter-pg", "pg",
    "@prisma/adapter-libsql", "@libsql/client",
  ],
};

export default nextConfig;
