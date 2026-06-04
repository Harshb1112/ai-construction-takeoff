import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { fileBase64, mimeType } = await request.json();

    if (!fileBase64) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const buffer = Buffer.from(fileBase64, "base64");

    // Plain text files — fastest path
    if (mimeType === "text/plain" || (mimeType ?? "").includes("text/")) {
      const text = buffer.toString("utf-8");
      return NextResponse.json({ text: text.slice(0, 60000), method: "text" });
    }

    // PDF extraction
    if (mimeType === "application/pdf" || (mimeType ?? "").includes("pdf")) {
      try {
        // pdf-parse is in serverExternalPackages so Next.js won't bundle it
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const pdfParse = require("pdf-parse");
        const data = await pdfParse(buffer);
        const text = (data.text ?? "").trim();

        return NextResponse.json({
          text: text.slice(0, 60000),
          pages: data.numpages,
          method: "pdf-parse",
        });
      } catch (err) {
        console.error("[extract-pdf] pdf-parse error:", err);
        return NextResponse.json({
          error: "PDF extraction failed: " + (err instanceof Error ? err.message : String(err)),
          text: "",
        }, { status: 422 });
      }
    }

    // Images — pass through (caller will use LM Studio vision)
    return NextResponse.json({ text: "", method: "image-passthrough" });

  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
