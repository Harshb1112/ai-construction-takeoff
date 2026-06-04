"use client";

import { Document, Page } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Loader2 } from "lucide-react";

interface Props {
  fileUrl: string;
  pageNum: number;
  pageWidth: number;
  onLoadSuccess: (numPages: number) => void;
  onRenderSuccess: () => void;
}

export function PdfDocumentViewer({
  fileUrl,
  pageNum,
  pageWidth,
  onLoadSuccess,
  onRenderSuccess,
}: Props) {
  return (
    <Document
      file={fileUrl}
      onLoadSuccess={({ numPages }) => onLoadSuccess(numPages)}
      loading={
        <div style={{ width: pageWidth, height: 600, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Loader2 size={28} color="#2563eb" className="animate-spin" />
        </div>
      }
    >
      <Page
        pageNumber={pageNum}
        width={pageWidth}
        scale={1.5}
        renderTextLayer={false}
        renderAnnotationLayer={false}
        onRenderSuccess={onRenderSuccess}
      />
    </Document>
  );
}
