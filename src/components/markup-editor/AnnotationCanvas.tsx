"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import type { Annotation, AnnotationPoint, DrawingScale } from "@/types";
import type { ToolType } from "./MarkupEditor";

// ─── Bluebeam Revu-style color palette ───────────────────────
const TOOL_COLORS: Record<string, string> = {
  select:     "#2563eb",
  measure:    "#2563eb",   // Blue — linear dimension
  area:       "#059669",   // Green — area
  polygon:    "#7c3aed",   // Purple — polygon
  perimeter:  "#0891b2",   // Cyan — perimeter
  count:      "#d97706",   // Amber — count
  text:       "#111827",   // Near-black
  cloud:      "#dc2626",   // Red — revision cloud
  arrow:      "#ea580c",   // Orange — arrow
  rectangle:  "#2563eb",   // Blue — rectangle
  highlight:  "#eab308",   // Yellow — highlight
  stamp:      "#dc2626",   // Red
  callout:    "#7c3aed",   // Purple
  image:      "#059669",
};

const FILL_OPACITY: Record<string, number> = {
  area: 0.15, polygon: 0.18, rectangle: 0.12,
  highlight: 0.40, cloud: 0.10,
};

const STAMPS = ["APPROVED","REJECTED","FOR REVIEW","REVISED","FINAL","NOT APPROVED","VOID"];
const STAMP_COLORS: Record<string, string> = {
  "APPROVED":"#16a34a","REJECTED":"#dc2626","FOR REVIEW":"#d97706",
  "REVISED":"#2563eb","FINAL":"#7c3aed","NOT APPROVED":"#dc2626","VOID":"#6b7280",
};

// ─── Math helpers ─────────────────────────────────────────────
function dist(a: AnnotationPoint, b: AnnotationPoint) {
  return Math.sqrt((a.x-b.x)**2+(a.y-b.y)**2);
}
function polyLen(pts: AnnotationPoint[]) {
  return pts.reduce((s,p,i)=>i===0?0:s+dist(pts[i-1],p),0);
}
function polyArea(pts: AnnotationPoint[]) {
  let a=0;
  for(let i=0;i<pts.length;i++){const j=(i+1)%pts.length;a+=pts[i].x*pts[j].y-pts[j].x*pts[i].y;}
  return Math.abs(a/2);
}
function pxToReal(px: number, scale: DrawingScale|null) {
  return scale?.pxPerUnit ? px/scale.pxPerUnit : px;
}
function centroid(pts: AnnotationPoint[]) {
  return {x:pts.reduce((s,p)=>s+p.x,0)/pts.length,y:pts.reduce((s,p)=>s+p.y,0)/pts.length};
}
function snapToAngle(start: AnnotationPoint, end: AnnotationPoint, snap=false): AnnotationPoint {
  if(!snap) return end;
  const dx=end.x-start.x, dy=end.y-start.y;
  const angle=Math.atan2(dy,dx);
  const snapped=Math.round(angle/(Math.PI/4))*(Math.PI/4);
  const len=Math.sqrt(dx*dx+dy*dy);
  return {x:start.x+Math.cos(snapped)*len, y:start.y+Math.sin(snapped)*len};
}

// Cloud path for Revu-style revision clouds
function buildCloudPath(pts: AnnotationPoint[], r: number): string {
  if(pts.length<2) return "";
  let d=`M ${pts[0].x} ${pts[0].y}`;
  for(let i=0;i<pts.length;i++){
    const p1=pts[i], p2=pts[(i+1)%pts.length];
    const dx=p2.x-p1.x, dy=p2.y-p1.y;
    const len=Math.sqrt(dx*dx+dy*dy)||1;
    const steps=Math.max(2,Math.floor(len/(r*2)));
    for(let s=1;s<=steps;s++){
      const t=s/steps;
      d+=` A ${r} ${r} 0 0 1 ${p1.x+dx*t} ${p1.y+dy*t}`;
    }
  }
  return d+" Z";
}

// Dimension line with end ticks (Revu-style)
function DimLine({pts,color,sw,zoom,label,fs}:{pts:AnnotationPoint[];color:string;sw:number;zoom:number;label?:string;fs:number}) {
  if(pts.length<2) return null;
  const p0=pts[0], p1=pts[pts.length-1];
  const dx=p1.x-p0.x, dy=p1.y-p0.y;
  const len=Math.sqrt(dx*dx+dy*dy)||1;
  const nx=-dy/len*7/zoom, ny=dx/len*7/zoom;
  const mid = {x:(p0.x+p1.x)/2, y:(p0.y+p1.y)/2};
  const angle=Math.atan2(dy,dx)*180/Math.PI;
  return (
    <g>
      {/* Main line */}
      <polyline points={pts.map(p=>`${p.x},${p.y}`).join(" ")} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"/>
      {/* End ticks */}
      <line x1={p0.x-nx} y1={p0.y-ny} x2={p0.x+nx} y2={p0.y+ny} stroke={color} strokeWidth={sw*1.2}/>
      <line x1={p1.x-nx} y1={p1.y-ny} x2={p1.x+nx} y2={p1.y+ny} stroke={color} strokeWidth={sw*1.2}/>
      {/* Dimension label in white pill */}
      {label && (
        <g>
          <rect x={mid.x-label.length*fs*0.35} y={mid.y-fs*0.8} width={label.length*fs*0.7} height={fs*1.6} rx={3/zoom} fill="white" fillOpacity={0.92} stroke={color} strokeWidth={0.8/zoom}/>
          <text x={mid.x} y={mid.y+fs*0.4} textAnchor="middle" fill={color} fontSize={fs} fontWeight="700">{label}</text>
        </g>
      )}
    </g>
  );
}

interface Props {
  width: number; height: number;
  annotations: Annotation[];
  activeTool: ToolType;
  scale: DrawingScale|null;
  zoom: number;
  selectedId: string|null;
  onSelect: (id:string|null)=>void;
  onCreated: (a:Omit<Annotation,"id"|"createdAt"|"updatedAt">)=>void;
  onDeleted: (id:string)=>void;
  onUpdated?: (id:string, geometry:AnnotationPoint[])=>void;
  pageNumber: number;
  drawingId: string;
}

export function AnnotationCanvas({
  width,height,annotations,activeTool,scale,
  zoom,selectedId,onSelect,onCreated,onDeleted,onUpdated,
  pageNumber,drawingId,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);

  // Drawing state
  const [pts, setPts]             = useState<AnnotationPoint[]>([]);
  const [mouse, setMouse]         = useState<AnnotationPoint|null>(null);
  const [rectStart, setRectStart] = useState<AnnotationPoint|null>(null);
  const [shiftHeld, setShiftHeld] = useState(false);

  // Text / stamp / callout
  const [textPos, setTextPos]     = useState<AnnotationPoint|null>(null);
  const [textVal, setTextVal]     = useState("");
  const [stampPos, setStampPos]   = useState<AnnotationPoint|null>(null);
  const [calloutAnchor, setCalloutAnchor] = useState<AnnotationPoint|null>(null);
  const [calloutText, setCalloutText]     = useState("");

  // Vertex drag editing
  const [dragging, setDragging] = useState<{annId:string;vtxIdx:number}|null>(null);
  const [editGeom, setEditGeom] = useState<AnnotationPoint[]|null>(null);

  // Image insert
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImagePos, setPendingImagePos] = useState<AnnotationPoint|null>(null);

  // Count tracker per drawing
  const countRef = useRef<Record<string,number>>({});

  const getPos = useCallback((e:React.MouseEvent<SVGSVGElement>):AnnotationPoint => {
    const svg = svgRef.current!;
    // Use SVG's native coordinate transform — handles all CSS transforms correctly
    // (zoom, pan, scale, devicePixelRatio — all accounted for automatically)
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgPt = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: svgPt.x, y: svgPt.y };
  }, []);

  // Keyboard
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      setShiftHeld(e.shiftKey);
      if(e.key==="Escape"){setPts([]);setRectStart(null);setTextPos(null);setStampPos(null);setCalloutAnchor(null);}
      if(e.key==="Delete"&&selectedId){onDeleted(selectedId);}
      if(e.key==="Backspace"&&selectedId){onDeleted(selectedId);}
    };
    const onKeyUp=()=>setShiftHeld(false);
    window.addEventListener("keydown",onKey);
    window.addEventListener("keyup",onKeyUp);
    return()=>{window.removeEventListener("keydown",onKey);window.removeEventListener("keyup",onKeyUp);};
  },[selectedId,onDeleted]);

  const color    = TOOL_COLORS[activeTool]??"#2563eb";
  const unit     = scale?.realUnit??"ft";
  const sw       = 2.5/zoom;
  const fs       = 11/zoom;
  const vtxR     = 5/zoom;
  const midVtxR  = 3.5/zoom;

  // ── Finish shape ────────────────────────────────────────────
  const finishShape = useCallback((points:AnnotationPoint[])=>{
    if(points.length<2){setPts([]);return;}
    const c = TOOL_COLORS[activeTool]??"#2563eb";
    const u = unit;

    if(activeTool==="measure"){
      const len=pxToReal(polyLen(points),scale);
      onCreated({drawingId,pageNumber,type:"MEASUREMENT",geometry:points,
        measurement:+len.toFixed(2),unit:u,label:`${len.toFixed(1)} ${u}`,color:c,opacity:1});
    } else if(activeTool==="perimeter"){
      const len=pxToReal(polyLen(points),scale);
      onCreated({drawingId,pageNumber,type:"PERIMETER",geometry:points,
        measurement:+len.toFixed(2),unit:u,label:`${len.toFixed(1)} ${u}`,color:c,opacity:1});
    } else if(["area","polygon","rectangle","cloud","highlight"].includes(activeTool)){
      const pxA=polyArea(points);
      const rs=pxToReal(Math.sqrt(pxA),scale);
      const area=+(rs*rs).toFixed(2);
      onCreated({drawingId,pageNumber,type:"AREA",geometry:points,
        measurement:area,unit:`${u}²`,
        label:activeTool==="highlight"?"Highlight":activeTool==="cloud"?"Cloud":`${area.toFixed(1)} ${u}²`,
        color:c,opacity:FILL_OPACITY[activeTool]??0.15});
    } else if(activeTool==="arrow"){
      onCreated({drawingId,pageNumber,type:"MEASUREMENT",geometry:points,
        label:"→",color:c,opacity:1});
    }
    setPts([]);setRectStart(null);
  },[activeTool,color,drawingId,onCreated,pageNumber,scale,unit]);

  // ── Vertex drag handlers ─────────────────────────────────────
  const onVtxMouseDown = useCallback((e:React.MouseEvent,annId:string,vtxIdx:number,geom:AnnotationPoint[])=>{
    if(activeTool!=="select") return;
    e.stopPropagation();
    setDragging({annId,vtxIdx});
    setEditGeom([...geom]);
  },[activeTool]);

  const onSvgMouseMove = useCallback((e:React.MouseEvent<SVGSVGElement>)=>{
    const p=getPos(e);
    setMouse(p);
    if(dragging&&editGeom){
      const newGeom=[...editGeom];
      newGeom[dragging.vtxIdx]=p;
      setEditGeom(newGeom);
    }
  },[dragging,editGeom,getPos]);

  const onSvgMouseUp = useCallback(()=>{
    if(dragging&&editGeom){
      onUpdated?.(dragging.annId,editGeom);
      setDragging(null);
      setEditGeom(null);
    }
  },[dragging,editGeom,onUpdated]);

  // ── Main click handler ────────────────────────────────────────
  const handleClick = useCallback((e:React.MouseEvent<SVGSVGElement>)=>{
    if(dragging) return;
    e.stopPropagation();
    const p=getPos(e);

    if(activeTool==="select"){onSelect(null);return;}

    if(activeTool==="count"){
      const key=`${drawingId}-${pageNumber}`;
      countRef.current[key]=(countRef.current[key]??0)+1;
      const n=countRef.current[key];
      onCreated({drawingId,pageNumber,type:"COUNT",geometry:[p],
        measurement:n,unit:"EA",label:`${n}`,color:TOOL_COLORS.count,opacity:1});
      return;
    }

    if(activeTool==="text"){setTextPos(p);setTextVal("");return;}
    if(activeTool==="stamp"){setStampPos(p);return;}

    if(activeTool==="callout"){
      if(!calloutAnchor){setCalloutAnchor(p);return;}
      setTextPos(p);setTextVal("");
      return;
    }

    if(activeTool==="image"){
      setPendingImagePos(p);
      fileInputRef.current?.click();
      return;
    }

    // Rectangle/highlight: 2-click
    if(activeTool==="rectangle"||activeTool==="highlight"){
      if(!rectStart){setRectStart(p);return;}
      const corners=[rectStart,{x:p.x,y:rectStart.y},p,{x:rectStart.x,y:p.y}];
      finishShape(corners);
      return;
    }

    // Arrow: 2-click
    if(activeTool==="arrow"){
      if(pts.length===0){setPts([p]);return;}
      finishShape([pts[0],snapToAngle(pts[0],p,shiftHeld)]);
      return;
    }

    // Poly tools
    setPts(prev=>[...prev,shiftHeld&&prev.length>0?snapToAngle(prev[prev.length-1],p,true):p]);
  },[activeTool,calloutAnchor,dragging,drawingId,finishShape,getPos,onCreated,onSelect,pageNumber,pts,rectStart,shiftHeld]);

  const handleDblClick = useCallback((e:React.MouseEvent<SVGSVGElement>)=>{
    e.stopPropagation();
    if(pts.length>=2) finishShape(pts);
    setPts([]);
  },[finishShape,pts]);

  // ── Text/callout save ─────────────────────────────────────────
  const saveText = useCallback(()=>{
    if(!textPos||!textVal.trim()){setTextPos(null);setCalloutAnchor(null);return;}
    if(activeTool==="callout"&&calloutAnchor){
      onCreated({drawingId,pageNumber,type:"MEASUREMENT",
        geometry:[calloutAnchor,textPos],
        label:textVal,color:TOOL_COLORS.callout,opacity:1});
      setCalloutAnchor(null);
    } else {
      onCreated({drawingId,pageNumber,type:"TEXT",
        geometry:[textPos],label:textVal,color:TOOL_COLORS.text,opacity:1});
    }
    setTextPos(null);setTextVal("");
  },[activeTool,calloutAnchor,drawingId,onCreated,pageNumber,textPos,textVal]);

  // ── Add vertex on segment midpoint ──────────────────────────
  const addVertex = useCallback((annId:string, geom:AnnotationPoint[], segIdx:number)=>{
    const p1=geom[segIdx], p2=geom[(segIdx+1)%geom.length];
    const mid={x:(p1.x+p2.x)/2, y:(p1.y+p2.y)/2};
    const newGeom=[...geom.slice(0,segIdx+1),mid,...geom.slice(segIdx+1)];
    onUpdated?.(annId,newGeom);
  },[onUpdated]);

  // ── Remove single vertex ─────────────────────────────────────
  const removeVertex = useCallback((annId:string, geom:AnnotationPoint[], vtxIdx:number)=>{
    if(geom.length<=2) return;
    const newGeom=geom.filter((_,i)=>i!==vtxIdx);
    onUpdated?.(annId,newGeom);
  },[onUpdated]);

  // ── Image file handler ────────────────────────────────────────
  const handleImageFile = useCallback((e:React.ChangeEvent<HTMLInputElement>)=>{
    const file=e.target.files?.[0];
    if(!file||!pendingImagePos) return;
    const reader=new FileReader();
    reader.onload=ev=>{
      const src=ev.target?.result as string;
      onCreated({drawingId,pageNumber,type:"TEXT",
        geometry:[pendingImagePos,{x:pendingImagePos.x+200/zoom,y:pendingImagePos.y+150/zoom}],
        label:`__IMG__${src}`,color:"transparent",opacity:1});
    };
    reader.readAsDataURL(file);
    setPendingImagePos(null);
    if(fileInputRef.current) fileInputRef.current.value="";
  },[drawingId,onCreated,pageNumber,pendingImagePos,zoom]);

  // ── Preview ───────────────────────────────────────────────────
  const previewPts = mouse&&pts.length>0?[...pts,mouse]:pts;
  const rectPrev   = rectStart&&mouse?[rectStart,{x:mouse.x,y:rectStart.y},mouse,{x:rectStart.x,y:mouse.y}]:null;

  const selectedAnn  = annotations.find(a=>a.id===selectedId);
  const displayGeom  = (id:string,geom:AnnotationPoint[]) => dragging?.annId===id&&editGeom ? editGeom : geom;

  return (
    <>
      {/* Hidden file input for image tool */}
      <input ref={fileInputRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleImageFile}/>

      <svg
        ref={svgRef}
        width={width} height={height}
        style={{
          position:"absolute", top:0, left:0,
          width:"100%", height:"100%",
          cursor:activeTool==="select"?"default":"crosshair",
          touchAction:"none",
          pointerEvents:"all",
          // overflow visible so vertex handles at edges don't clip
          overflow:"visible",
        }}
        onClick={handleClick}
        onDoubleClick={handleDblClick}
        onMouseMove={onSvgMouseMove}
        onMouseUp={onSvgMouseUp}
      >
        <defs>
          <marker id="arrowhead" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
            <polygon points="0 0,9 4.5,0 9" fill={TOOL_COLORS.arrow}/>
          </marker>
          <marker id="arrowhead-blue" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
            <polygon points="0 0,9 4.5,0 9" fill={TOOL_COLORS.callout}/>
          </marker>
          <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1" stdDeviation="2" floodOpacity="0.25"/>
          </filter>
        </defs>

        {/* ── Saved annotations ──────────────────────────────── */}
        {annotations.map(ann=>{
          const sel = selectedId===ann.id;
          const geom = displayGeom(ann.id, ann.geometry);
          return (
            <AnnotationShape
              key={ann.id} ann={{...ann,geometry:geom}}
              selected={sel} zoom={zoom}
              onSelect={()=>onSelect(ann.id)}
              onDelete={()=>onDeleted(ann.id)}
              onVtxMouseDown={(e,i)=>onVtxMouseDown(e,ann.id,i,geom)}
              addVertex={(segIdx)=>addVertex(ann.id,geom,segIdx)}
              removeVertex={(vtxIdx)=>removeVertex(ann.id,geom,vtxIdx)}
              cloudPath={buildCloudPath}
            />
          );
        })}

        {/* ── Live preview ────────────────────────────────────── */}
        {/* Rectangle / highlight */}
        {rectPrev&&(
          <polygon points={rectPrev.map(p=>`${p.x},${p.y}`).join(" ")}
            fill={`${color}${activeTool==="highlight"?"55":"20"}`}
            stroke={color} strokeWidth={sw} strokeDasharray={`${5/zoom},${3/zoom}`}/>
        )}

        {/* Poly area / polygon / cloud */}
        {previewPts.length>=2&&!rectStart&&!["arrow","rectangle","highlight","callout"].includes(activeTool)&&(
          <>
            {["area","polygon"].includes(activeTool)&&(
              <polygon points={previewPts.map(p=>`${p.x},${p.y}`).join(" ")}
                fill={`${color}18`} stroke={color} strokeWidth={sw} strokeDasharray={`${5/zoom},${3/zoom}`}/>
            )}
            {["measure","perimeter"].includes(activeTool)&&(
              <DimLine pts={previewPts} color={color} sw={sw} zoom={zoom} fs={fs}/>
            )}
            {activeTool==="cloud"&&previewPts.length>=3&&(
              <path d={buildCloudPath(previewPts,10/zoom)} fill={`${color}10`} stroke={color} strokeWidth={sw}/>
            )}
          </>
        )}

        {/* Arrow preview */}
        {activeTool==="arrow"&&pts.length===1&&mouse&&(
          <line x1={pts[0].x} y1={pts[0].y} x2={mouse.x} y2={mouse.y}
            stroke={color} strokeWidth={sw*1.5} markerEnd="url(#arrowhead)"/>
        )}

        {/* Callout preview */}
        {activeTool==="callout"&&calloutAnchor&&mouse&&(
          <line x1={calloutAnchor.x} y1={calloutAnchor.y} x2={mouse.x} y2={mouse.y}
            stroke={TOOL_COLORS.callout} strokeWidth={sw} strokeDasharray={`${4/zoom},${3/zoom}`}/>
        )}

        {/* Vertex dots on in-progress poly */}
        {pts.map((p,i)=>(
          <circle key={i} cx={p.x} cy={p.y} r={vtxR} fill={color} stroke="#fff" strokeWidth={1.5/zoom}/>
        ))}
        {rectStart&&<circle cx={rectStart.x} cy={rectStart.y} r={vtxR} fill={color} stroke="#fff" strokeWidth={1.5/zoom}/>}

        {/* ── Inline text input ────────────────────────────── */}
        {textPos&&(
          <foreignObject x={textPos.x} y={textPos.y-22/zoom} width={240/zoom} height={44/zoom}>
            <input
              // @ts-expect-error — xmlns is valid on SVG foreignObject children but not in React's JSX types
              xmlns="http://www.w3.org/1999/xhtml" autoFocus
              value={textVal} onChange={e=>setTextVal(e.target.value)}
              onBlur={saveText} onKeyDown={e=>e.key==="Enter"&&saveText()}
              placeholder="Type note… Enter to save"
              style={{fontSize:13/zoom,padding:`${4/zoom}px ${8/zoom}px`,
                border:`${2/zoom}px solid #2563eb`,borderRadius:6/zoom,
                background:"#fff",outline:"none",width:"100%",
                boxShadow:`0 2px 12px rgba(37,99,235,.25)`,fontFamily:"inherit"}}
            />
          </foreignObject>
        )}

        {/* ── Stamp menu ───────────────────────────────────── */}
        {stampPos&&(
          <foreignObject x={stampPos.x} y={stampPos.y} width={170/zoom} height={210/zoom}>
            <div
              // @ts-expect-error — xmlns is valid on SVG foreignObject children but not in React's JSX types
              xmlns="http://www.w3.org/1999/xhtml"
              style={{background:"#fff",border:"1px solid #e2e8f0",
                borderRadius:10/zoom,boxShadow:`0 8px 32px rgba(0,0,0,.18)`,overflow:"hidden"}}>
              {STAMPS.map(s=>(
                <button key={s} onClick={()=>{
                  onCreated({drawingId,pageNumber,type:"TEXT",
                    geometry:[stampPos],label:`[${s}]`,
                    color:STAMP_COLORS[s]??"#2563eb",opacity:1});
                  setStampPos(null);
                }} style={{display:"block",width:"100%",padding:`${7/zoom}px ${12/zoom}px`,
                  textAlign:"left",cursor:"pointer",border:"none",
                  borderBottom:`1px solid #f1f5f9`,background:"transparent",
                  fontSize:13/zoom,fontWeight:700,color:STAMP_COLORS[s]}}>
                  {s}
                </button>
              ))}
              <button onClick={()=>setStampPos(null)} style={{display:"block",width:"100%",
                padding:`${5/zoom}px`,textAlign:"center",fontSize:11/zoom,
                color:"#94a3b8",border:"none",cursor:"pointer",background:"transparent"}}>
                Cancel
              </button>
            </div>
          </foreignObject>
        )}
      </svg>
    </>
  );
}

// ─── Individual annotation renderer ───────────────────────────
interface ShapeProps {
  ann: Annotation; selected: boolean; zoom: number;
  onSelect: ()=>void; onDelete: ()=>void;
  onVtxMouseDown: (e:React.MouseEvent,i:number)=>void;
  addVertex: (segIdx:number)=>void;
  removeVertex: (vtxIdx:number)=>void;
  cloudPath: (pts:AnnotationPoint[],r:number)=>string;
}

function AnnotationShape({ann,selected,zoom,onSelect,onDelete,onVtxMouseDown,addVertex,removeVertex,cloudPath}:ShapeProps) {
  const {type,geometry:pts,color,opacity,label,measurement} = ann;
  const sw  = selected?3/zoom:2/zoom;
  const fs  = 11/zoom;
  const vtxR= 5/zoom;
  const midR= 3.5/zoom;

  const textStroke:React.CSSProperties={paintOrder:"stroke",stroke:"white",strokeWidth:3/zoom} as React.CSSProperties;

  // Check if it's an embedded image
  const isImage = label?.startsWith("__IMG__");

  return (
    <g onClick={e=>{e.stopPropagation();onSelect();}} style={{cursor:"pointer"}}>

      {/* ── COUNT ─────────────────────────────── */}
      {type==="COUNT"&&pts[0]&&(
        <>
          <circle cx={pts[0].x} cy={pts[0].y} r={11/zoom}
            fill={color} stroke={selected?"#fff":color} strokeWidth={selected?2/zoom:1/zoom}
            style={selected?{filter:"drop-shadow(0 0 4px rgba(0,0,0,.4))"}:{}}/>
          <text x={pts[0].x} y={pts[0].y+4/zoom} textAnchor="middle"
            fill="#fff" fontSize={10/zoom} fontWeight="800">{label||"1"}</text>
        </>
      )}

      {/* ── TEXT / CALLOUT / STAMP ────────────── */}
      {type==="TEXT"&&pts[0]&&!isImage&&(
        <>
          {/* Callout: has 2 points */}
          {pts.length>=2&&label!=="→"&&(
            <>
              <line x1={pts[0].x} y1={pts[0].y} x2={pts[1].x} y2={pts[1].y}
                stroke={color} strokeWidth={sw*1.2} markerEnd="url(#arrowhead-blue)"/>
            </>
          )}
          <text x={pts[pts.length>1?1:0].x} y={pts[pts.length>1?1:0].y}
            fill={color} fontSize={14/zoom} fontWeight="700" style={textStroke}>
            {label}
          </text>
        </>
      )}

      {/* ── EMBEDDED IMAGE ───────────────────── */}
      {isImage&&pts.length>=2&&(
        <>
          <image
            href={label!.slice(7)}
            x={Math.min(pts[0].x,pts[1].x)}
            y={Math.min(pts[0].y,pts[1].y)}
            width={Math.abs(pts[1].x-pts[0].x)}
            height={Math.abs(pts[1].y-pts[0].y)}
            preserveAspectRatio="xMidYMid meet"
            style={selected?{outline:`${2/zoom}px solid #2563eb`}:{}}
          />
          {selected&&<rect
            x={Math.min(pts[0].x,pts[1].x)} y={Math.min(pts[0].y,pts[1].y)}
            width={Math.abs(pts[1].x-pts[0].x)} height={Math.abs(pts[1].y-pts[0].y)}
            fill="none" stroke="#2563eb" strokeWidth={2/zoom} strokeDasharray={`${5/zoom},${3/zoom}`}
          />}
        </>
      )}

      {/* ── MEASUREMENT / DIMENSION LINE ────── */}
      {type==="MEASUREMENT"&&pts.length>=2&&(
        <>
          {label==="→"?(
            <line x1={pts[0].x} y1={pts[0].y} x2={pts[pts.length-1].x} y2={pts[pts.length-1].y}
              stroke={color} strokeWidth={sw*1.5} markerEnd="url(#arrowhead)"
              strokeLinecap="round"/>
          ):(
            <DimLine pts={pts} color={color} sw={sw} zoom={zoom} label={label??""} fs={fs}/>
          )}
        </>
      )}

      {/* ── PERIMETER ────────────────────────── */}
      {type==="PERIMETER"&&pts.length>=2&&(
        <>
          <polyline points={pts.map(p=>`${p.x},${p.y}`).join(" ")}
            fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"
            strokeDasharray={selected?`${4/zoom},${2/zoom}`:undefined}/>
          {label&&(()=>{const c=centroid(pts);return(
            <g>
              <rect x={c.x-label.length*fs*0.35} y={c.y-fs*0.85} width={label.length*fs*0.7} height={fs*1.7} rx={3/zoom} fill="white" fillOpacity={0.9} stroke={color} strokeWidth={0.8/zoom}/>
              <text x={c.x} y={c.y+fs*0.4} textAnchor="middle" fill={color} fontSize={fs} fontWeight="700">{label}</text>
            </g>
          );})()}
        </>
      )}

      {/* ── AREA ─────────────────────────────── */}
      {type==="AREA"&&pts.length>=3&&(
        <>
          {label==="Cloud"?(
            <path d={cloudPath(pts,10/zoom)} fill={`${color}18`}
              stroke={color} strokeWidth={sw*1.1} strokeLinecap="round"/>
          ):(
            <polygon points={pts.map(p=>`${p.x},${p.y}`).join(" ")}
              fill={color} fillOpacity={opacity}
              stroke={color} strokeWidth={sw}
              strokeDasharray={selected?`${4/zoom},${2/zoom}`:undefined}
              strokeLinejoin="round"/>
          )}
          {label&&label!=="Highlight"&&(()=>{
            const c=centroid(pts);
            return(
              <g>
                <rect x={c.x-label.length*fs*0.35} y={c.y-fs*0.85} width={label.length*fs*0.7} height={fs*1.7} rx={3/zoom} fill="white" fillOpacity={0.92} stroke={color} strokeWidth={0.8/zoom}/>
                <text x={c.x} y={c.y+fs*0.4} textAnchor="middle" fill={color} fontSize={fs} fontWeight="700">{label}</text>
              </g>
            );
          })()}
        </>
      )}

      {/* ── SELECTION HANDLES ────────────────── */}
      {selected&&!isImage&&(
        <>
          {/* Delete button */}
          <g onClick={e=>{e.stopPropagation();onDelete();}} style={{cursor:"pointer"}}>
            <circle cx={pts[0].x+16/zoom} cy={pts[0].y-16/zoom} r={9/zoom} fill="#ef4444" filter="url(#shadow)"/>
            <text x={pts[0].x+16/zoom} y={pts[0].y-16/zoom+4/zoom}
              textAnchor="middle" fill="#fff" fontSize={13/zoom} fontWeight="800">×</text>
          </g>

          {/* Vertex handles — draggable blue dots */}
          {pts.map((p,i)=>(
            <g key={`vtx-${i}`}>
              <circle cx={p.x} cy={p.y} r={vtxR+2/zoom}
                fill="white" stroke="#2563eb" strokeWidth={1.5/zoom}
                style={{cursor:"move"}}
                onMouseDown={e=>onVtxMouseDown(e,i)}
              />
              <circle cx={p.x} cy={p.y} r={vtxR-1/zoom}
                fill="#2563eb" style={{cursor:"move",pointerEvents:"none"}}/>
              {/* Right-click to remove vertex */}
              <circle cx={p.x} cy={p.y} r={vtxR+2/zoom} fill="transparent"
                onContextMenu={e=>{e.preventDefault();e.stopPropagation();removeVertex(i);}}
                style={{cursor:"context-menu"}}/>
            </g>
          ))}

          {/* Midpoint handles — click to add vertex */}
          {pts.length>=2&&type!=="COUNT"&&type!=="TEXT"&&pts.map((_,i)=>{
            const j=(i+1)%pts.length;
            if(type==="MEASUREMENT"&&j===0) return null; // no wrap for lines
            const mx=(pts[i].x+pts[j].x)/2, my=(pts[i].y+pts[j].y)/2;
            return(
              <g key={`mid-${i}`} onClick={e=>{e.stopPropagation();addVertex(i);}} style={{cursor:"copy"}}>
                <circle cx={mx} cy={my} r={midR+2/zoom} fill="white" stroke="#64748b" strokeWidth={1/zoom} strokeDasharray={`${2/zoom},${1/zoom}`}/>
                <circle cx={mx} cy={my} r={midR-1/zoom} fill="#94a3b8" style={{pointerEvents:"none"}}/>
                <text x={mx} y={my+3/zoom} textAnchor="middle" fill="#fff" fontSize={8/zoom} fontWeight="800" style={{pointerEvents:"none"}}>+</text>
              </g>
            );
          })}
        </>
      )}
    </g>
  );
}
