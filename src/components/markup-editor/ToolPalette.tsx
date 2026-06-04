"use client";

import { Tooltip } from "@/components/ui/Tooltip";
import {
  MousePointer2, Ruler, Square, Hash, Route, Type,
  SlidersHorizontal, PanelRightClose, PanelRightOpen,
  Cloud, MoveUpRight, RectangleHorizontal, Highlighter,
  Pentagon, Stamp, Layers, MessageSquare, ImagePlus,
  Table2, Bot, Cpu
} from "lucide-react";
import type { ToolType } from "./MarkupEditor";

const GROUPS = [
  {
    label: "Selection",
    tools: [
      { type:"select"    as ToolType, icon:MousePointer2,       label:"Select & Edit",     key:"V" },
    ],
  },
  {
    label: "Measure",
    tools: [
      { type:"measure"   as ToolType, icon:Ruler,               label:"Linear Measure",    key:"M" },
      { type:"area"      as ToolType, icon:Square,              label:"Area",              key:"A" },
      { type:"perimeter" as ToolType, icon:Route,               label:"Perimeter",         key:"P" },
      { type:"polygon"   as ToolType, icon:Pentagon,            label:"Polygon Area",      key:"G" },
      { type:"count"     as ToolType, icon:Hash,                label:"Count",             key:"C" },
    ],
  },
  {
    label: "Markup",
    tools: [
      { type:"cloud"     as ToolType, icon:Cloud,               label:"Revision Cloud",    key:"K" },
      { type:"arrow"     as ToolType, icon:MoveUpRight,         label:"Arrow",             key:"W" },
      { type:"rectangle" as ToolType, icon:RectangleHorizontal, label:"Rectangle",         key:"R" },
      { type:"highlight" as ToolType, icon:Highlighter,         label:"Highlight",         key:"H" },
      { type:"callout"   as ToolType, icon:MessageSquare,       label:"Callout",           key:"L" },
      { type:"text"      as ToolType, icon:Type,                label:"Text Note",         key:"T" },
      { type:"stamp"     as ToolType, icon:Stamp,               label:"Stamp",             key:"S" },
      { type:"image"     as ToolType, icon:ImagePlus,           label:"Insert Image",      key:"I" },
    ],
  },
];

const COLOR_MAP: Record<string, string> = {
  select:"#2563eb", measure:"#2563eb", area:"#059669",
  polygon:"#7c3aed", perimeter:"#0891b2", count:"#d97706",
  cloud:"#dc2626", arrow:"#ea580c", rectangle:"#2563eb",
  highlight:"#eab308", callout:"#7c3aed", text:"#111827",
  stamp:"#dc2626", image:"#059669",
};

interface Props {
  activeTool: ToolType;
  onToolChange: (t:ToolType)=>void;
  onOpenScale: ()=>void;
  onToggleSidebar: ()=>void;
  showSidebar: boolean;
  isDxf?: boolean;
  showLayerPanel?: boolean;
  onToggleLayerPanel?: ()=>void;
  onToggleTable?: ()=>void;
  showTable?: boolean;
  onAiDetect?: ()=>void;
  aiDetecting?: boolean;
  onAiChat?: ()=>void;
  showAiChat?: boolean;
  tableCount?: number;
}

export function ToolPalette({activeTool,onToolChange,onOpenScale,onToggleSidebar,showSidebar,isDxf,showLayerPanel,onToggleLayerPanel,onToggleTable,showTable,onAiDetect,aiDetecting,onAiChat,showAiChat,tableCount}:Props) {
  const activeColor = COLOR_MAP[activeTool]??"#2563eb";

  return (
    <aside style={{
      width:50, flexShrink:0,
      background:"#1e293b",
      borderRight:"1px solid #334155",
      display:"flex", flexDirection:"column",
      alignItems:"center", gap:2, padding:"10px 0",
      overflowY:"auto",
    }}>
      {GROUPS.map((group,gi)=>(
        <div key={gi} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1,width:"100%"}}>
          {gi>0&&<div style={{height:1,width:32,background:"#334155",margin:"6px auto"}}/>}
          {group.tools.map(({type,icon:Icon,label,key})=>{
            const active=activeTool===type;
            const ac=COLOR_MAP[type]??"#2563eb";
            return (
              <Tooltip key={type} content={`${label} (${key})`} side="right">
                <button onClick={()=>onToolChange(type)} style={{
                  width:38,height:38,borderRadius:8,border:"none",
                  background:active?`${ac}22`:"transparent",
                  cursor:"pointer",
                  display:"flex",alignItems:"center",justifyContent:"center",
                  transition:"all .15s",
                  boxShadow:active?`0 0 0 2px ${ac}`:"none",
                }}>
                  <Icon size={16} color={active?ac:"#94a3b8"} strokeWidth={active?2.5:1.8}/>
                </button>
              </Tooltip>
            );
          })}
        </div>
      ))}

      {/* ── AI + Table tools ── */}
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1,width:"100%",marginTop:8,paddingTop:8,borderTop:"1px solid #334155"}}>
        {onToggleTable && (
          <Tooltip content="Measurement Table" side="right">
            <button onClick={onToggleTable} style={{
              width:38,height:38,borderRadius:8,border:"none",
              background:showTable?"rgba(37,99,235,.2)":"transparent",
              cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
              position:"relative",
            }}>
              <Table2 size={16} color={showTable?"#2563eb":"#64748b"}/>
              {!!tableCount && tableCount > 0 && (
                <span style={{position:"absolute",top:3,right:3,width:14,height:14,borderRadius:"50%",background:"#2563eb",color:"#fff",fontSize:8,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center"}}>
                  {tableCount}
                </span>
              )}
            </button>
          </Tooltip>
        )}
        {onAiDetect && (
          <Tooltip content="AI Detect Rooms" side="right">
            <button onClick={onAiDetect} disabled={aiDetecting} style={{
              width:38,height:38,borderRadius:8,border:"none",
              background:aiDetecting?"rgba(5,150,105,.2)":"transparent",
              cursor:aiDetecting?"not-allowed":"pointer",
              display:"flex",alignItems:"center",justifyContent:"center",
            }}>
              <Cpu size={16} color={aiDetecting?"#059669":"#64748b"}/>
            </button>
          </Tooltip>
        )}
        {onAiChat && (
          <Tooltip content="Ask AI about drawing" side="right">
            <button onClick={onAiChat} style={{
              width:38,height:38,borderRadius:8,border:"none",
              background:showAiChat?"rgba(124,58,237,.2)":"transparent",
              cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
            }}>
              <Bot size={16} color={showAiChat?"#7c3aed":"#64748b"}/>
            </button>
          </Tooltip>
        )}
      </div>

      {/* Utility tools */}
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1,width:"100%",paddingTop:8,borderTop:"1px solid #334155"}}>
        {onToggleLayerPanel&&(
          <Tooltip content={isDxf ? "Toggle CAD Layers" : "Toggle Room Layers"} side="right">
            <button onClick={onToggleLayerPanel} style={{
              width:38,height:38,borderRadius:8,border:"none",
              background:showLayerPanel?"rgba(14,165,233,.2)":"transparent",
              cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
            }}>
              <Layers size={16} color={showLayerPanel?"#0ea5e9":"#64748b"}/>
            </button>
          </Tooltip>
        )}
        <Tooltip content="Set Scale (calibrate measurements)" side="right">
          <button onClick={onOpenScale} style={{
            width:38,height:38,borderRadius:8,border:"none",background:"transparent",
            cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
          }}>
            <SlidersHorizontal size={16} color="#64748b"/>
          </button>
        </Tooltip>
        <Tooltip content={showSidebar?"Hide Takeoff Panel":"Show Takeoff Panel"} side="right">
          <button onClick={onToggleSidebar} style={{
            width:38,height:38,borderRadius:8,border:"none",background:"transparent",
            cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
          }}>
            {showSidebar
              ?<PanelRightClose size={16} color="#64748b"/>
              :<PanelRightOpen size={16} color="#64748b"/>
            }
          </button>
        </Tooltip>
      </div>

      {/* Active tool indicator at bottom */}
      <div style={{width:38,textAlign:"center",paddingBottom:4}}>
        <div style={{fontSize:9,color:"#475569",fontWeight:600,textTransform:"uppercase",letterSpacing:".04em"}}>
          {activeTool.slice(0,4)}
        </div>
      </div>
    </aside>
  );
}
