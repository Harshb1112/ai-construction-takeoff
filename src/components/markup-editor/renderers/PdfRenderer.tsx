"use client";

import { useState } from "react";
import { Document, Page } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { setupPdfWorker } from "@/lib/pdf-worker";

if (typeof window !== "undefined") setupPdfWorker();

interface Props {
  fileUrl: string;
  pageNumber: number;
  onPageCount: (n: number) => void;
}

export function PdfRenderer({ fileUrl, pageNumber, onPageCount }: Props) {
  return (
    <div style={{
      boxShadow: "0 8px 40px rgba(0,0,0,.25)",
      borderRadius: 4,
      overflow: "hidden",
      background: "#fff",
    }}>
      <Document
        file={fileUrl}
        onLoadSuccess={({ numPages }) => onPageCount(numPages)}
        loading={
          <div style={{
            width: 850, height: 1100,
            background: "#fff",
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 14,
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: "50%",
              border: "4px solid #e2e8f0",
              borderTopColor: "#2563eb",
            }} className="spin" />
            <p style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>Loading PDF...</p>
          </div>
        }
        error={
          <div style={{
            width: 850, height: 500,
            background: "#fff",
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 10,
          }}>
            <p style={{ fontSize: 22 }}>⚠️</p>
            <p style={{ fontSize: 14, fontWeight: 600, color: "#ef4444" }}>Could not load PDF</p>
            <p style={{ fontSize: 12, color: "#94a3b8" }}>
              Make sure the file is a valid PDF and re-upload if needed
            </p>
          </div>
        }
      >
        <Page
          pageNumber={pageNumber}
          width={880}
          renderTextLayer={true}
          renderAnnotationLayer={false}
        />
      </Document>
    </div>
  );
}
