"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { bufToBase64, getLmStudioUrl } from "@/lib/utils";
import { BookOpen, Upload, Search, Loader2, FileText, Lightbulb, Trash2, Plus } from "lucide-react";

/** OCR an image (HTMLImageElement or canvas ImageData) using Tesseract.js (loaded lazily) */
async function ocrImage(imageUrl: string): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const { data: { text } } = await worker.recognize(imageUrl);
    return text.trim();
  } finally {
    await worker.terminate();
  }
}

/** Render first N pages of a PDF blob to canvas and OCR them */
async function ocrPdf(buffer: ArrayBuffer, maxPages = 5): Promise<string> {
  // Use pdfjs-dist (already installed) in browser mode
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages = Math.min(pdf.numPages, maxPages);
  const texts: string[] = [];

  for (let i = 1; i <= pages; i++) {
    const page   = await pdf.getPage(i);
    const vp     = page.getViewport({ scale: 2.0 }); // higher scale = better OCR
    const canvas = document.createElement("canvas");
    canvas.width  = vp.width;
    canvas.height = vp.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const dataUrl = canvas.toDataURL("image/png");
    const text = await ocrImage(dataUrl);
    if (text) texts.push(text);
  }
  return texts.join("\n\n");
}

interface KnowledgeDoc {
  id: string; name: string; type: "pdf"|"note";
  chunks: number; createdAt: string; summary?: string; content?: string;
}
interface SearchResult { docName: string; chunk: string; relevance: number }

export default function KnowledgePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [docs, setDocs]               = useState<KnowledgeDoc[]>([]);
  const [loading, setLoading]         = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [uploading, setUploading]     = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [searching, setSearching]     = useState(false);
  const [newNote, setNewNote]         = useState("");
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [askQuestion, setAskQuestion] = useState("");
  const [aiAnswer, setAiAnswer]       = useState("");
  const [asking, setAsking]           = useState(false);
  const lmStudioUrl = getLmStudioUrl();

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/projects/${projectId}/knowledge`);
    if (r.ok) setDocs(await r.json());
    setLoading(false);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const saveDoc = async (data: Omit<KnowledgeDoc, "id"|"createdAt"> & { content?: string }) => {
    const r = await fetch(`/api/projects/${projectId}/knowledge`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (r.ok) {
      const doc = await r.json();
      setDocs(prev => [doc, ...prev]);
    }
  };

  const deleteDoc = async (id: string) => {
    setDocs(prev => prev.filter(d => d.id !== id));
    await fetch(`/api/projects/${projectId}/knowledge`, {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  };

  const uploadDoc = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadStatus("Reading file…");
    try {
      const buf    = await file.arrayBuffer();
      const base64 = bufToBase64(buf);
      let content = "";
      let summary = "";

      const isPdf  = file.type === "application/pdf" || file.name.endsWith(".pdf");
      const isText = file.type.startsWith("text/") || file.name.endsWith(".txt");
      const isImage = file.type.startsWith("image/");

      if (isText) {
        content = new TextDecoder().decode(buf).slice(0, 60000);
        summary = content.slice(0, 300);

      } else if (isPdf) {
        // Try server-side text extraction first (text-based PDFs)
        setUploadStatus("Extracting PDF text…");
        try {
          const r = await fetch("/api/extract-pdf", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileBase64: base64, mimeType: file.type }),
          });
          const d = await r.json();
          content = (d.text ?? "").trim();
        } catch { content = ""; }

        // If no text found — it's a scanned/image PDF, run OCR
        if (content.length < 50) {
          setUploadStatus("Scanned PDF detected — running OCR (this may take 30–60s)…");
          try {
            content = await ocrPdf(buf);
          } catch (ocrErr) {
            console.error("OCR failed:", ocrErr);
            content = "";
          }
        }
        summary = content.slice(0, 300);

      } else if (isImage) {
        // Direct image OCR
        setUploadStatus("Running OCR on image (30–60s)…");
        try {
          const objectUrl = URL.createObjectURL(file);
          content = await ocrImage(objectUrl);
          URL.revokeObjectURL(objectUrl);
        } catch { content = ""; }
        summary = content.slice(0, 300);
      }

      setUploadStatus("Saving…");
      await saveDoc({
        name: file.name, type: "pdf",
        chunks: Math.ceil(file.size / 1000),
        summary, content,
      });
    } finally {
      setUploading(false);
      setUploadStatus("");
      e.target.value = "";
    }
  };

  const addNote = async () => {
    if (!newNote.trim()) return;
    await saveDoc({
      name: `Note — ${new Date().toLocaleDateString()}`,
      type: "note", chunks: 1,
      summary: newNote.slice(0, 300),
      content: newNote,
    });
    setNewNote(""); setShowNoteForm(false);
  };

  const searchDocs = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchResults([]);
    const r = await fetch(`/api/projects/${projectId}/knowledge`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: searchQuery }),
    });
    if (r.ok) setSearchResults(await r.json());
    setSearching(false);
  };

  const askAI = async () => {
    if (!askQuestion.trim()) return;
    setAsking(true); setAiAnswer("");
    try {
      // Use full content (up to 3000 chars per doc) for better AI answers
      const context = docs.map(d => {
        const body = (d.content && d.content.length > 10) ? d.content.slice(0, 3000) : (d.summary ?? "(no content)");
        return `[${d.name}]:\n${body}`;
      }).join("\n\n---\n\n");
      const prompt  = `You are a construction knowledge assistant. Use the following documents to answer the question.\n\nDocuments:\n${context}\n\nQuestion: ${askQuestion}\n\nAnswer concisely and cite the document name if relevant.`;
      const r = await fetch("/api/ai/lmstudio", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, baseUrl: lmStudioUrl }),
      });
      const d = await r.json();
      setAiAnswer(d.rawText ?? d.error ?? "No answer.");
    } catch { setAiAnswer("Failed to get AI answer."); }
    finally { setAsking(false); }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-(--foreground)">Knowledge Base</h2>
        <p className="text-sm text-(--muted-foreground)">
          Upload specs, codes, material datasheets, and notes. AI searches across documents to answer estimating questions.
        </p>
      </div>

      {/* Upload + Note */}
      <div className="flex flex-wrap gap-3">
        <label className={`flex cursor-pointer items-center gap-2 rounded-lg border border-(--border) bg-(--card) px-4 py-2 text-sm font-medium hover:bg-(--secondary) transition-colors ${uploading?"opacity-50":""}`}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin text-sky-500"/> : <Upload className="h-4 w-4 text-sky-500"/>}
          {uploading ? (uploadStatus || "Uploading…") : "Upload PDF / Spec"}
          <input type="file" accept=".pdf,.png,.jpg,.txt,.docx" className="hidden" onChange={uploadDoc} disabled={uploading}/>
        </label>
        <button onClick={()=>setShowNoteForm(!showNoteForm)} className="flex items-center gap-2 rounded-lg border border-(--border) bg-(--card) px-4 py-2 text-sm font-medium hover:bg-(--secondary) transition-colors">
          <Plus className="h-4 w-4 text-violet-500"/>Add Note
        </button>
      </div>

      {showNoteForm && (
        <div className="rounded-xl border border-(--border) bg-(--card) p-4 space-y-3">
          <textarea value={newNote} onChange={e=>setNewNote(e.target.value)}
            placeholder="Write your knowledge note here… (specs, observations, lessons learned)"
            rows={4} className="w-full rounded-lg border border-(--border) bg-(--muted) px-3 py-2 text-sm outline-none focus:border-sky-400 resize-none"/>
          <div className="flex justify-end gap-2">
            <button onClick={()=>setShowNoteForm(false)} className="rounded-lg border border-(--border) px-3 py-1.5 text-sm hover:bg-(--secondary) transition-colors">Cancel</button>
            <button onClick={addNote} disabled={!newNote.trim()} className="rounded-lg bg-violet-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-600 disabled:opacity-50">Save Note</button>
          </div>
        </div>
      )}

      {/* AI Q&A */}
      <div className="rounded-xl border border-violet-200 bg-violet-50 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-violet-500"/>
          <h3 className="font-semibold text-violet-800">Ask AI about your documents</h3>
        </div>
        <div className="flex gap-2">
          <input value={askQuestion} onChange={e=>setAskQuestion(e.target.value)} onKeyDown={e=>e.key==="Enter"&&askAI()}
            placeholder="e.g. What fire rating is required for exterior walls?"
            className="flex-1 rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-400"/>
          <button onClick={askAI} disabled={!askQuestion.trim()||asking||!docs.length}
            className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50">
            {asking ? <Loader2 className="h-4 w-4 animate-spin"/> : <Lightbulb className="h-4 w-4"/>}Ask
          </button>
        </div>
        {aiAnswer && <div className="rounded-lg border border-violet-200 bg-white p-4 text-sm whitespace-pre-wrap">{aiAnswer}</div>}
        {!docs.length && <p className="text-xs text-violet-600">Upload documents first to enable AI Q&A.</p>}
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--muted-foreground)"/>
          <input value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&searchDocs()}
            placeholder="Search knowledge base…"
            className="w-full rounded-lg border border-(--border) bg-(--card) pl-9 pr-3 py-2 text-sm outline-none focus:border-sky-400"/>
        </div>
        <button onClick={searchDocs} disabled={searching||!docs.length}
          className="flex items-center gap-2 rounded-lg border border-(--border) bg-(--card) px-4 py-2 text-sm hover:bg-(--secondary) disabled:opacity-50">
          {searching ? <Loader2 className="h-4 w-4 animate-spin"/> : <Search className="h-4 w-4"/>}Search
        </button>
      </div>

      {searchResults.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)">Search Results</p>
          {searchResults.map((r, i) => (
            <div key={i} className="rounded-xl border border-(--border) bg-(--card) p-4">
              <div className="mb-1 flex items-center justify-between">
                <p className="text-sm font-medium text-sky-600">{r.docName}</p>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">{(r.relevance*100).toFixed(0)}% match</span>
              </div>
              <p className="text-sm text-(--muted-foreground)">{r.chunk}</p>
            </div>
          ))}
        </div>
      )}

      {/* Documents */}
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)">
          Documents ({loading ? "…" : docs.length})
        </p>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-14 text-(--muted-foreground)">
            <Loader2 size={18} className="animate-spin"/>Loading…
          </div>
        ) : docs.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-(--border) py-14 text-center">
            <BookOpen className="h-10 w-10 text-(--muted-foreground)"/>
            <p className="text-sm text-(--muted-foreground)">No documents yet. Upload PDFs, specs, or add notes.</p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {docs.map(doc => (
              <div key={doc.id} className="rounded-xl border border-(--border) bg-(--card) p-4">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${doc.type==="pdf"?"bg-sky-100":"bg-violet-100"}`}>
                      {doc.type==="pdf" ? <FileText className="h-4 w-4 text-sky-500"/> : <BookOpen className="h-4 w-4 text-violet-500"/>}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-(--foreground)">{doc.name}</p>
                      <p className="text-xs text-(--muted-foreground)">{doc.chunks} chunks · {new Date(doc.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <button onClick={()=>deleteDoc(doc.id)} className="text-(--muted-foreground) hover:text-red-500 transition-colors">
                    <Trash2 className="h-3.5 w-3.5"/>
                  </button>
                </div>
                {doc.summary && <p className="text-xs text-(--muted-foreground) line-clamp-3">{doc.summary}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
