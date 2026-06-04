// ─── Project ─────────────────────────────────────────────────
export type ProjectStatus = "ACTIVE" | "ARCHIVED" | "DELETED";

export interface Project {
  id: string;
  name: string;
  description?: string | null;
  address?: string | null;
  status: ProjectStatus;
  costRegion: string;
  createdAt: string;
  updatedAt: string;
  ownerId: string;
  _count?: { drawings: number; takeoffItems: number; boqItems: number };
}

// ─── Drawing ─────────────────────────────────────────────────
export type FileFormat = "DWG" | "DXF" | "PDF" | "PNG" | "JPG" | "JPEG" | "IFC";

export interface Drawing {
  id: string;
  projectId: string;
  filename: string;
  originalName: string;
  fileUrl: string;
  fileFormat: FileFormat;
  fileSizeBytes: number;
  pageCount?: number | null;
  uploadedAt: string;
  scale?: DrawingScale | null;
  fastapiId?: number | null;
}

export interface DrawingScale {
  id: string;
  drawingId: string;
  notation?: string | null;
  pxPerUnit?: number | null;
  realUnit: string;
  scaleRatio?: number | null;
  calibratedBy: string;
}

// ─── Annotation ──────────────────────────────────────────────
export type AnnotationType = "MEASUREMENT" | "AREA" | "COUNT" | "PERIMETER" | "TEXT";

export interface AnnotationPoint { x: number; y: number }

export interface Annotation {
  id: string;
  drawingId: string;
  pageNumber: number;
  type: AnnotationType;
  geometry: AnnotationPoint[];
  measurement?: number | null;
  unit?: string | null;
  label?: string | null;
  userNote?: string | null;    // User's instruction for AI analysis
  aiAnalyzed?: boolean;        // Has this region been AI-processed?
  aiResult?: string | null;    // JSON string of AI result
  color: string;
  opacity: number;
  takeoffItemId?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Takeoff ─────────────────────────────────────────────────
export type TakeoffSource =
  | "MANUAL"
  | "AI_CLAUDE"
  | "AI_OPENAI"
  | "AI_GROQ"
  | "AI_LMSTUDIO"
  | "FASTAPI"
  | "MARKUP";

export interface TakeoffItem {
  id: string;
  projectId: string;
  drawingId?: string | null;
  annotationId?: string | null;
  source: TakeoffSource;
  category: string;
  subcategory?: string | null;
  description: string;
  quantity: number;
  unit: string;
  unitCost?: number | null;
  totalCost?: number | null;
  wastePercent: number;
  aiProvider?: string | null;
  confidence?: number | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── BOQ ─────────────────────────────────────────────────────
export interface BoqItem {
  id: string;
  projectId: string;
  section: string;
  csiCode?: string | null;
  description: string;
  unit: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  notes?: string | null;
  sortOrder: number;
  createdAt: string;
}

// ─── AI ──────────────────────────────────────────────────────
export type AiProvider = "claude" | "openai" | "groq" | "lmstudio";

export interface AiAnalysisResult {
  provider: AiProvider;
  items: Partial<TakeoffItem>[];
  rawText?: string;
  confidence?: number;
  processingTime?: number;
}

// ─── FastAPI ─────────────────────────────────────────────────
export interface FastApiDrawingUpload {
  drawing_id: number;
  project_id?: number;
  filename: string;
  format: string;
}

export interface FastApiTakeoffResult {
  drawing_id: number;
  status: "pending" | "processing" | "completed" | "failed";
  materials?: FastApiMaterial[];
  cut_list?: FastApiCutListItem[];
  error?: string;
}

export interface FastApiMaterial {
  material_type: string;
  size: string;
  quantity: number;
  unit: string;
  total_length?: number;
}

export interface FastApiCutListItem {
  size: string;
  stock_length: number;
  cuts: number[];
  waste_percent: number;
}

export interface FastApiDetectionResult {
  detection_id: string;
  detections: {
    class_name: string;
    confidence: number;
    bbox: [number, number, number, number];
  }[];
  annotated_image_url?: string;
}
