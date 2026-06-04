/**
 * Patch @prisma/client to add runtime/library shim.
 * Prisma 7 renamed runtime/library → runtime/client.
 * The generated client still imports from runtime/library, so we shim it.
 * This runs automatically via `postinstall`.
 */
const fs   = require("fs");
const path = require("path");

const runtimeDir = path.join(__dirname, "../node_modules/@prisma/client/runtime");
const pkgPath    = path.join(__dirname, "../node_modules/@prisma/client/package.json");

// 1. Create shim files
const libJs  = path.join(runtimeDir, "library.js");
const libMjs = path.join(runtimeDir, "library.mjs");
const libDts = path.join(runtimeDir, "library.d.ts");
const libMts = path.join(runtimeDir, "library.d.mts");

if (!fs.existsSync(libJs)) {
  fs.writeFileSync(libJs,  "module.exports = require('./client.js');");
  fs.writeFileSync(libMjs, "export * from './client.mjs';");
  try {
    fs.copyFileSync(path.join(runtimeDir, "client.d.ts"),  libDts);
    fs.copyFileSync(path.join(runtimeDir, "client.d.mts"), libMts);
  } catch (_) {}
  console.log("[patch-prisma] Created runtime/library shim ✅");
}

// 2. Patch package.json exports
try {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  if (!pkg.exports?.["./runtime/library"]) {
    pkg.exports["./runtime/library"] = {
      require: "./runtime/library.js",
      import:  "./runtime/library.mjs",
      types:   "./runtime/library.d.ts",
    };
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    console.log("[patch-prisma] Patched package.json exports ✅");
  }
} catch (e) {
  console.warn("[patch-prisma] Could not patch exports:", e.message);
}
