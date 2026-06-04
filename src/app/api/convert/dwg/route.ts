import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";

const PROJECT_ROOT = process.cwd();

/** Find dwg2dxf.exe / dwg2dxf binary in common locations */
function findDwg2Dxf(): string | null {
  const candidates = [
    // Project bin dir (installed via setup-dwg.ps1)
    path.join(PROJECT_ROOT, "bin", "dwg2dxf.exe"),
    path.join(PROJECT_ROOT, "bin", "dwg2dxf"),
    // FastAPI backend bin
    path.join(PROJECT_ROOT, "..", "construction-ai-master", "backend", "bin", "dwg2dxf.exe"),
    // System PATH locations
    "C:\\Program Files\\LibreDWG\\bin\\dwg2dxf.exe",
    "C:\\LibreDWG\\dwg2dxf.exe",
    "/usr/bin/dwg2dxf",
    "/usr/local/bin/dwg2dxf",
    "/opt/homebrew/bin/dwg2dxf",
  ];
  return candidates.find(p => {
    try { return fs.existsSync(p); } catch { return false; }
  }) ?? null;
}

/** Find ODA File Converter */
function findOda(): string | null {
  const candidates = [
    "C:\\Program Files\\ODA\\ODAFileConverter\\ODAFileConverter.exe",
    "C:\\Program Files (x86)\\ODA\\ODAFileConverter\\ODAFileConverter.exe",
    "/usr/bin/ODAFileConverter",
    "/opt/ODA/ODAFileConverter",
  ];
  return candidates.find(p => { try { return fs.existsSync(p); } catch { return false; } }) ?? null;
}

export async function POST(request: Request) {
  try {
    const { fileUrl } = await request.json();
    if (!fileUrl) return NextResponse.json({ error: "fileUrl required" }, { status: 400 });

    // Resolve the local file path
    const localPath = fileUrl.startsWith("/")
      ? path.join(PROJECT_ROOT, "public", fileUrl)
      : null;

    // ── Method 1: FastAPI backend ─────────────────────────────
    const fastapiUrl = process.env.FASTAPI_URL ?? "http://localhost:8000";
    try {
      let body: Buffer;
      if (localPath && fs.existsSync(localPath)) {
        body = fs.readFileSync(localPath);
      } else {
        const appBase = process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";
        const r = await fetch(fileUrl.startsWith("http") ? fileUrl : `${appBase}${fileUrl}`,
          { signal: AbortSignal.timeout(8000) });
        body = Buffer.from(await r.arrayBuffer());
      }

      const form = new FormData();
      // Convert Buffer to Uint8Array for Blob compatibility
      // Use ArrayBuffer directly for Blob compatibility
      const ab = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
      form.append("file", new Blob([ab as ArrayBuffer], { type: "application/octet-stream" }), "drawing.dwg");

      const res = await fetch(`${fastapiUrl}/api/convert/dwg`, {
        method: "POST", body: form,
        signal: AbortSignal.timeout(60000),
      });

      if (res.ok) {
        const ct = res.headers.get("content-type") ?? "";
        const text = await res.text();
        if (ct.includes("text") && (text.includes("SECTION") || text.includes("ENTITIES"))) {
          return new Response(text, { headers: { "Content-Type": "text/plain", "X-Source": "fastapi" } });
        }
      }
    } catch (e) {
      console.error("FastAPI unavailable:", (e as Error).message.slice(0, 60));
    }

    // ── Method 2: local dwg2dxf binary ───────────────────────
    const dwg2dxf = findDwg2Dxf();
    if (dwg2dxf && localPath && fs.existsSync(localPath)) {
      try {
        const { execSync } = await import("child_process");
        const os = await import("os");
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dwg-"));
        const outDxf = path.join(tmpDir, "out.dxf");

        execSync(`"${dwg2dxf}" -o "${outDxf}" "${localPath}"`, { timeout: 45000 });

        if (fs.existsSync(outDxf)) {
          const dxf = fs.readFileSync(outDxf, "utf-8");
          fs.rmSync(tmpDir, { recursive: true, force: true });
          return new Response(dxf, { headers: { "Content-Type": "text/plain", "X-Source": "dwg2dxf-local" } });
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (e) {
        console.error("dwg2dxf failed:", (e as Error).message.slice(0, 80));
      }
    }

    // ── Method 3: ODA File Converter ─────────────────────────
    const oda = findOda();
    if (oda && localPath && fs.existsSync(localPath)) {
      try {
        const { execSync } = await import("child_process");
        const os = await import("os");
        const tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), "oda-"));
        const inDir   = path.join(tmpDir, "in");
        const outDir  = path.join(tmpDir, "out");
        fs.mkdirSync(inDir); fs.mkdirSync(outDir);
        fs.copyFileSync(localPath, path.join(inDir, "input.dwg"));

        execSync(`"${oda}" "${inDir}" "${outDir}" ACAD2018 DXF 0 1`, { timeout: 60000 });

        const dxfFiles = fs.readdirSync(outDir).filter(f => f.endsWith(".dxf"));
        if (dxfFiles.length > 0) {
          const dxf = fs.readFileSync(path.join(outDir, dxfFiles[0]), "utf-8");
          fs.rmSync(tmpDir, { recursive: true, force: true });
          return new Response(dxf, { headers: { "Content-Type": "text/plain", "X-Source": "oda" } });
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (e) {
        console.error("ODA failed:", (e as Error).message.slice(0, 80));
      }
    }

    // ── Method 4: CloudConvert API (env CLOUDCONVERT_API_KEY) ────
    const ccKey = process.env.CLOUDCONVERT_API_KEY;
    if (ccKey) {
      try {
        let fileContent: Buffer;
        if (localPath && fs.existsSync(localPath)) {
          fileContent = fs.readFileSync(localPath);
        } else {
          const appBase = process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";
          const r = await fetch(fileUrl.startsWith("http") ? fileUrl : `${appBase}${fileUrl}`,
            { signal: AbortSignal.timeout(10000) });
          fileContent = Buffer.from(await r.arrayBuffer());
        }

        // Step 1: Create job
        const job = await fetch("https://api.cloudconvert.com/v2/jobs", {
          method: "POST",
          headers: { Authorization: `Bearer ${ccKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            tasks: {
              "upload-dwg": { operation: "import/upload" },
              "convert-dxf": {
                operation: "convert",
                input: "upload-dwg",
                input_format: "dwg",
                output_format: "dxf",
                engine: "autocad",
              },
              "export-dxf": { operation: "export/url", input: "convert-dxf" },
            },
          }),
        });
        const jobData = await job.json();
        const uploadTask = jobData.data?.tasks?.find((t: { name: string }) => t.name === "upload-dwg");
        if (!uploadTask?.result?.form) throw new Error("CloudConvert: no upload form");

        // Step 2: Upload file
        const { url: upUrl, parameters } = uploadTask.result.form;
        const upForm = new FormData();
        for (const [k, v] of Object.entries(parameters ?? {})) upForm.append(k, String(v));
        upForm.append("file", new Blob([fileContent as unknown as ArrayBuffer], { type: "application/octet-stream" }), "input.dwg");
        await fetch(upUrl, { method: "POST", body: upForm });

        // Step 3: Poll for completion (max 60s)
        const jobId = jobData.data?.id;
        for (let i = 0; i < 12; i++) {
          await new Promise(r => setTimeout(r, 5000));
          const poll = await fetch(`https://api.cloudconvert.com/v2/jobs/${jobId}`,
            { headers: { Authorization: `Bearer ${ccKey}` } });
          const pollData = await poll.json();
          const status = pollData.data?.status;
          if (status === "finished") {
            const exportTask = pollData.data?.tasks?.find((t: { operation: string }) => t.operation === "export/url");
            const dxfUrl = exportTask?.result?.files?.[0]?.url;
            if (dxfUrl) {
              const dxfRes = await fetch(dxfUrl);
              const dxf = await dxfRes.text();
              return new Response(dxf, { headers: { "Content-Type": "text/plain", "X-Source": "cloudconvert" } });
            }
          }
          if (status === "error") throw new Error("CloudConvert job failed");
        }
        throw new Error("CloudConvert: timed out waiting for conversion");
      } catch (e) {
        console.error("CloudConvert failed:", (e as Error).message.slice(0, 120));
      }
    }

    // ── No converter available ────────────────────────────────
    const hasDwg2dxf = !!dwg2dxf;
    const hasOda     = !!oda;

    return NextResponse.json({
      converted: false,
      reason: "no_converter",
      hasDwg2dxf, hasOda,
      hasCloudConvert: !!ccKey,
      projectBinPath: path.join(PROJECT_ROOT, "bin", "dwg2dxf.exe"),
      solutions: [
        {
          id: "fastapi",
          label: "Start FastAPI Backend (Recommended)",
          desc: "Has LibreDWG built-in — run start-backend.bat",
          cmd: "Double-click start-backend.bat in the project folder",
          primary: true,
        },
        {
          id: "libredwg",
          label: "Install dwg2dxf (LibreDWG)",
          desc: "Run the setup script to download the binary",
          cmd: "powershell -ExecutionPolicy Bypass -File scripts\\setup-dwg.ps1",
          primary: false,
        },
        {
          id: "oda",
          label: "ODA File Converter (Free)",
          desc: "Install ODA from opendesign.com — runs automatically",
          url: "https://www.opendesign.com/guestfiles/oda_file_converter",
          primary: false,
        },
        {
          id: "cloudconvert",
          label: "CloudConvert API (25 free/day)",
          desc: "Add CLOUDCONVERT_API_KEY to .env.local for automatic DWG→DXF in the cloud",
          url: "https://cloudconvert.com/api/v2",
          cmd: "CLOUDCONVERT_API_KEY=your_key  ← add to .env.local",
          primary: false,
        },
        {
          id: "online",
          label: "Convert manually online (free)",
          desc: "Convert DWG→DXF free, then upload the .dxf file here",
          url: "https://cloudconvert.com/dwg-to-dxf",
          primary: false,
        },
      ],
    }, { status: 422 });

  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

/** GET: check converter status */
export async function GET() {
  return NextResponse.json({
    dwg2dxf: findDwg2Dxf(),
    oda: findOda(),
    projectBinExists: fs.existsSync(path.join(PROJECT_ROOT, "bin")),
    startScript: fs.existsSync(path.join(PROJECT_ROOT, "start-backend.bat")),
  });
}
