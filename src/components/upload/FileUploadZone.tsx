"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, FileText, Image, Layers, X, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { formatBytes } from "@/lib/utils";

const ACCEPTED_FORMATS: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "application/octet-stream": [".dwg", ".dxf", ".ifc"],
};

const FORMAT_ICONS: Record<string, React.ElementType> = {
  pdf: FileText,
  dwg: Layers,
  dxf: Layers,
  ifc: Layers,
  png: Image,
  jpg: Image,
  jpeg: Image,
};

interface UploadFile {
  file: File;
  status: "pending" | "uploading" | "done" | "error";
  progress: number;
  error?: string;
  drawingId?: string;
}

interface FileUploadZoneProps {
  projectId: string;
  onUploaded?: (drawingId: string, filename: string) => void;
}

export function FileUploadZone({ projectId, onUploaded }: FileUploadZoneProps) {
  const [files, setFiles] = useState<UploadFile[]>([]);

  const uploadFile = useCallback(async (uploadFile: UploadFile) => {
    setFiles((prev) => prev.map((f) => f.file === uploadFile.file ? { ...f, status: "uploading", progress: 10 } : f));

    try {
      const formData = new FormData();
      formData.append("file", uploadFile.file);
      formData.append("projectId", projectId);

      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      setFiles((prev) => prev.map((f) => f.file === uploadFile.file
        ? { ...f, status: "done", progress: 100, drawingId: data.id }
        : f
      ));
      onUploaded?.(data.id, uploadFile.file.name);
    } catch (err) {
      setFiles((prev) => prev.map((f) => f.file === uploadFile.file
        ? { ...f, status: "error", error: err instanceof Error ? err.message : "Upload failed" }
        : f
      ));
    }
  }, [projectId, onUploaded]);

  const onDrop = useCallback((accepted: File[]) => {
    const newFiles: UploadFile[] = accepted.map((file) => ({
      file, status: "pending", progress: 0,
    }));
    setFiles((prev) => [...prev, ...newFiles]);
    newFiles.forEach(uploadFile);
  }, [uploadFile]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_FORMATS,
    maxSize: 100 * 1024 * 1024, // 100MB
  });

  const removeFile = (file: File) => setFiles((prev) => prev.filter((f) => f.file !== file));

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        {...getRootProps()}
        className={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition-colors cursor-pointer ${
          isDragActive
            ? "border-sky-400 bg-sky-50"
            : "border-(--border) bg-(--muted) hover:border-sky-300 hover:bg-sky-50/30"
        }`}
      >
        <input {...getInputProps()} />
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-sky-100 mb-4">
          <Upload className="h-7 w-7 text-sky-500" />
        </div>
        <p className="text-base font-semibold text-(--foreground)">
          {isDragActive ? "Drop files here..." : "Drag & drop drawings"}
        </p>
        <p className="mt-1 text-sm text-(--muted-foreground)">
          or click to browse files
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {["PDF", "DWG", "DXF", "IFC", "PNG", "JPG"].map((fmt) => (
            <span key={fmt} className="rounded-full bg-(--card) border border-(--border) px-3 py-0.5 text-xs font-medium text-(--muted-foreground)">
              {fmt}
            </span>
          ))}
        </div>
        <p className="mt-2 text-xs text-(--muted-foreground)">Max 100 MB per file</p>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map(({ file, status, progress, error }) => {
            const ext = file.name.split(".").pop()?.toLowerCase() ?? "pdf";
            const Icon = FORMAT_ICONS[ext] ?? FileText;
            return (
              <div key={file.name + file.size} className="flex items-center gap-3 rounded-lg border border-(--border) bg-(--card) p-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-100 shrink-0">
                  <Icon className="h-4 w-4 text-sky-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-(--foreground)">{file.name}</p>
                  <p className="text-xs text-(--muted-foreground)">{formatBytes(file.size)}</p>
                  {status === "uploading" && (
                    <progress
                      className="upload-progress mt-1.5 h-1.5 w-full"
                      value={progress}
                      max={100}
                      aria-label={`Upload progress for ${file.name}`}
                    />
                  )}
                  {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
                </div>
                <div className="shrink-0">
                  {status === "uploading" && <Loader2 className="h-4 w-4 animate-spin text-sky-500" />}
                  {status === "done" && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                  {status === "error" && <AlertCircle className="h-4 w-4 text-red-500" />}
                  {(status === "pending" || status === "done") && (
                    <button
                      onClick={() => removeFile(file)}
                      className="ml-2 rounded p-0.5 text-(--muted-foreground) hover:text-red-500 transition-colors"
                      aria-label={`Remove ${file.name}`}
                      title={`Remove ${file.name}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
