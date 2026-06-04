"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";

interface IfcElement { id: number; type: string; name: string; color: number }
interface Props {
  fileUrl: string;
  onElementsParsed?: (
    elements: IfcElement[],
    stats: { walls: number; slabs: number; columns: number; doors: number; windows: number }
  ) => void;
}

// IFC type numeric codes → display info
const IFC_TYPES: Record<number, { label: string; color: number; stat: "walls"|"slabs"|"columns"|"doors"|"windows" }> = {
  2391406946: { label: "Wall",    color: 0xdde3ec, stat: "walls"   }, // IFCWALL
  3512223829: { label: "Wall",    color: 0xdde3ec, stat: "walls"   }, // IFCWALLSTANDARDCASE
  4156078855: { label: "Wall",    color: 0xdde3ec, stat: "walls"   }, // IFCWALLELEMENTEDCASE
  1529196076: { label: "Slab",    color: 0x94a3b8, stat: "slabs"   }, // IFCSLAB
  3027962421: { label: "Slab",    color: 0x94a3b8, stat: "slabs"   }, // IFCSLABSTANDARDCASE
  3127900445: { label: "Slab",    color: 0x94a3b8, stat: "slabs"   }, // IFCSLABELEMENTEDCASE
  843113511:  { label: "Column",  color: 0x475569, stat: "columns" }, // IFCCOLUMN
  905975707:  { label: "Column",  color: 0x475569, stat: "columns" }, // IFCCOLUMNSTANDARDCASE
  753842376:  { label: "Beam",    color: 0x64748b, stat: "columns" }, // IFCBEAM
  2906023776: { label: "Beam",    color: 0x64748b, stat: "columns" }, // IFCBEAMSTANDARDCASE
  395920057:  { label: "Door",    color: 0xf59e0b, stat: "doors"   }, // IFCDOOR
  3242481149: { label: "Door",    color: 0xf59e0b, stat: "doors"   }, // IFCDOORSTANDARDCASE
  3304561284: { label: "Window",  color: 0x7dd3fc, stat: "windows" }, // IFCWINDOW
  486154966:  { label: "Window",  color: 0x7dd3fc, stat: "windows" }, // IFCWINDOWSTANDARDCASE
  2016517767: { label: "Roof",    color: 0xf87171, stat: "slabs"   }, // IFCROOF
  331165859:  { label: "Stair",   color: 0xa78bfa, stat: "walls"   }, // IFCSTAIR
};

export default function IfcViewer({ fileUrl, onElementsParsed }: Props) {
  const mountRef    = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const frameRef    = useRef<number>(0);

  const [status,    setStatus]    = useState<"loading"|"ok"|"error">("loading");
  const [errorMsg,  setErrorMsg]  = useState("");
  const [stats,     setStats]     = useState({ walls: 0, slabs: 0, columns: 0, doors: 0, windows: 0 });
  const [progress,  setProgress]  = useState("");

  useEffect(() => {
    if (!mountRef.current) return;
    let aborted = false;
    const W = mountRef.current.clientWidth || 900;
    const H = 520;

    // ── Scene ───────────────────────────────────────────────────────────────
    const scene    = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a);
    scene.fog = new THREE.Fog(0x0f172a, 300, 1000);

    const camera = new THREE.PerspectiveCamera(60, W / H, 0.01, 5000);
    camera.position.set(20, 20, 30);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0xffffff, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(50, 100, 50);
    sun.castShadow = true;
    scene.add(sun);
    scene.add(new THREE.HemisphereLight(0x87ceeb, 0x1e293b, 0.5));
    scene.add(new THREE.GridHelper(100, 20, 0x1e293b, 0x1e293b));

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    // ── Load and parse IFC ──────────────────────────────────────────────────
    (async () => {
      try {
        setStatus("loading");
        setProgress("Fetching file...");

        const res = await fetch(fileUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = await res.arrayBuffer();
        if (aborted) return;
        const data   = new Uint8Array(buffer);

        console.log("[IFC] data byteLength:", data.byteLength, "first 4 bytes:", data[0], data[1], data[2], data[3]);
        setProgress("Loading IFC engine...");

        // Dynamic import — only runs in browser (ssr:false on parent)
        const WebIFC = await import("web-ifc");
        const api = new WebIFC.IfcAPI();

        // true = absolute path → fetches /web-ifc.wasm from public/
        api.SetWasmPath("/", true);
        await api.Init();
        if (aborted) { api.Dispose?.(); return; }

        console.log("[IFC] WASM initialized, wasmModule:", !!(api as any).wasmModule);
        setProgress("Parsing geometry...");

        const modelID = api.OpenModel(data);
        console.log("[IFC] modelID from OpenModel:", modelID);
        if (modelID === -1) throw new Error("WASM failed to parse IFC file (OpenModel returned -1). File may be corrupt or use an unsupported schema.");

        // ── Build expressID → type map ──────────────────────────────────────
        const idToType = new Map<number, number>();
        for (const typeCode of Object.keys(IFC_TYPES).map(Number)) {
          try {
            const ids = api.GetLineIDsWithType(modelID, typeCode);
            if (!ids) continue;
            for (let i = 0; i < ids.size(); i++) idToType.set(ids.get(i), typeCode);
          } catch { /* type not present in this file */ }
        }

        // ── Stream all geometry ─────────────────────────────────────────────
        const countedStats = { walls: 0, slabs: 0, columns: 0, doors: 0, windows: 0 };
        const elements: IfcElement[] = [];
        const meshes: THREE.Mesh[] = [];

        const allGeometry = api.LoadAllGeometry(modelID);
        const total = allGeometry.size();
        console.log("[IFC] total flat meshes:", total);

        // Probe first mesh to see raw geometry data
        if (total > 0) {
          const probe = allGeometry.get(0);
          const gc = probe.geometries.size();
          console.log("[IFC] probe[0] expressID:", probe.expressID, "geomCount:", gc);
          if (gc > 0) {
            const pg = probe.geometries.get(0);
            console.log("[IFC] probe[0] geometryExpressID:", pg.geometryExpressID);
            console.log("[IFC] probe[0] flatTransformation length:", pg.flatTransformation?.length);
            try {
              const ig = api.GetGeometry(modelID, pg.geometryExpressID);
              console.log("[IFC] probe[0] ifcGeom:", ig, "GetVertexDataSize:", ig?.GetVertexDataSize?.());
              const vd = ig?.GetVertexDataSize?.() ?? 0;
              const id = ig?.GetIndexDataSize?.() ?? 0;
              console.log("[IFC] probe[0] vDataSize:", vd, "iDataSize:", id);
              if (vd > 0) {
                const vArr = api.GetVertexArray(ig.GetVertexData(), vd);
                console.log("[IFC] probe[0] vArr.length:", vArr?.length, "vArr[0..5]:", vArr?.[0], vArr?.[1], vArr?.[2], vArr?.[3], vArr?.[4], vArr?.[5]);
              }
              ig?.delete?.();
            } catch(pe) { console.error("[IFC] probe error:", pe); }
          }
        }

        for (let i = 0; i < total; i++) {
          const flatMesh   = allGeometry.get(i);
          const expressID  = flatMesh.expressID;
          const typeCode   = idToType.get(expressID);
          const typeMeta   = typeCode !== undefined ? IFC_TYPES[typeCode] : undefined;

          const color  = typeMeta?.color ?? 0x94a3b8;
          const label  = typeMeta?.label ?? "Element";
          const stat   = typeMeta?.stat;

          if (stat) countedStats[stat]++;

          elements.push({ id: expressID, type: label, name: `${label} ${expressID}`, color });

          // Convert each placed geometry sub-mesh
          const geomCount = flatMesh.geometries.size();
          if (i < 3) console.log(`[IFC] mesh[${i}] expressID=${expressID} label=${label} geomCount=${geomCount}`);
          for (let j = 0; j < geomCount; j++) {
            let ifcGeomRef: any = null;
            try {
              const placedGeom  = flatMesh.geometries.get(j);
              const ifcGeom     = api.GetGeometry(modelID, placedGeom.geometryExpressID);
              ifcGeomRef = ifcGeom;

              const vSize = ifcGeom.GetVertexDataSize();
              const iSize = ifcGeom.GetIndexDataSize();
              const vData = api.GetVertexArray(ifcGeom.GetVertexData(), vSize);
              const iData = api.GetIndexArray(ifcGeom.GetIndexData(),   iSize);

              if (i < 2 && j < 2) console.log(`[IFC]   geom[${j}] vSize=${vSize} iSize=${iSize} vData.len=${vData?.length} iData.len=${iData?.length}`);

              if (!vData || !iData || vData.length === 0 || iData.length === 0) { ifcGeom.delete?.(); continue; }

              // Vertex layout: [x, y, z, nx, ny, nz] = 6 floats/vertex (same as web-ifc-three)
              const posArr = new Float32Array(vData.length / 2);
              const nrmArr = new Float32Array(vData.length / 2);
              for (let k = 0; k < vData.length; k += 6) {
                posArr[k / 2]     = vData[k];
                posArr[k / 2 + 1] = vData[k + 1];
                posArr[k / 2 + 2] = vData[k + 2];
                nrmArr[k / 2]     = vData[k + 3];
                nrmArr[k / 2 + 1] = vData[k + 4];
                nrmArr[k / 2 + 2] = vData[k + 5];
              }

              // Bake placement matrix directly into geometry vertices (world space)
              const mat4 = new THREE.Matrix4().fromArray(placedGeom.flatTransformation);

              const geo = new THREE.BufferGeometry();
              geo.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
              geo.setAttribute("normal",   new THREE.BufferAttribute(nrmArr, 3));
              geo.setIndex(new THREE.BufferAttribute(iData, 1));
              geo.applyMatrix4(mat4);

              const isWindow = label === "Window";
              const mat = new THREE.MeshBasicMaterial({
                color,
                transparent: isWindow,
                opacity: isWindow ? 0.45 : 1,
                side: THREE.DoubleSide,
              });

              const mesh = new THREE.Mesh(geo, mat);
              mesh.userData = { id: expressID, type: label };
              meshes.push(mesh);
              ifcGeom.delete?.();
            } catch (geomErr) {
              console.error(`[IFC] sub-geom [${i}][${j}] THREW:`, geomErr);
              try { ifcGeomRef?.delete?.(); } catch {}
            }
          }

          try { flatMesh.delete?.(); } catch { /* ignore */ }
        }

        api.CloseModel(modelID);

        console.log("[IFC] meshes created:", meshes.length);
        if (meshes.length === 0) throw new Error("No renderable geometry found in IFC file.");

        meshes.forEach(m => scene.add(m));

        // DEBUG: will add sphere at model center after computing bbox below

        setStats(countedStats);
        onElementsParsed?.(elements, countedStats);

        // ── Auto-fit camera ─────────────────────────────────────────────────
        const box    = new THREE.Box3();
        scene.updateMatrixWorld(true);
        meshes.forEach(m => box.expandByObject(m));
        console.log("[IFC] box isEmpty:", box.isEmpty());
        console.log("[IFC] box min:", box.min.x.toFixed(2), box.min.y.toFixed(2), box.min.z.toFixed(2));
        console.log("[IFC] box max:", box.max.x.toFixed(2), box.max.y.toFixed(2), box.max.z.toFixed(2));

        if (!box.isEmpty()) {
          const center = box.getCenter(new THREE.Vector3());
          const size   = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z, 1);
          const dist   = maxDim * 1.8;

          camera.position.set(
            center.x + dist * 0.7,
            center.y + dist * 0.5,
            center.z + dist * 0.7,
          );
          camera.near = maxDim * 0.001;
          camera.far  = maxDim * 200;
          camera.updateProjectionMatrix();

          const gridSize = Math.ceil(maxDim * 2 / 10) * 10;
          scene.children
            .filter(c => c instanceof THREE.GridHelper)
            .forEach(g => scene.remove(g));
          scene.add(new THREE.GridHelper(gridSize, 20, 0x1e293b, 0x1e293b));

          scene.fog = new THREE.Fog(0x0f172a, maxDim * 5, maxDim * 50);
          controls.target.copy(center);
          controls.maxDistance = maxDim * 20;
          controls.update();
          console.log("[IFC] camera pos:", camera.position.x.toFixed(2), camera.position.y.toFixed(2), camera.position.z.toFixed(2));
          console.log("[IFC] maxDim:", maxDim.toFixed(2), "center:", center.x.toFixed(2), center.y.toFixed(2), center.z.toFixed(2));

          // DEBUG: red sphere AT model center, radius = 5% of model size
          const dbgSphere = new THREE.Mesh(
            new THREE.SphereGeometry(maxDim * 0.05, 16, 16),
            new THREE.MeshBasicMaterial({ color: 0xff0000, depthTest: false })
          );
          dbgSphere.position.copy(center);
          scene.add(dbgSphere);
        }

        setStatus("ok");
        setProgress("");
      } catch (e) {
        console.error("[IFC] parse error:", e);
        setErrorMsg(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    })();

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      aborted = true;
      cancelAnimationFrame(frameRef.current);
      renderer.dispose();
      controls.dispose();
      if (mountRef.current?.contains(renderer.domElement))
        mountRef.current.removeChild(renderer.domElement);
    };
  }, [fileUrl]);

  const Overlay = ({ children }: { children: React.ReactNode }) => (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#0f172a] text-center px-8">
      {children}
    </div>
  );

  return (
    <div className="relative bg-[#0f172a] rounded-xl overflow-hidden">

      {status === "loading" && (
        <Overlay>
          <div className="mb-3 h-10 w-10 animate-spin rounded-full border-4 border-sky-500 border-t-transparent" />
          <p className="text-sm text-sky-400 font-semibold">Loading IFC geometry...</p>
          <p className="text-xs text-slate-500 mt-1">{progress}</p>
        </Overlay>
      )}

      {status === "error" && (
        <Overlay>
          <p className="font-semibold text-red-400 mb-1">Cannot parse IFC file</p>
          <p className="text-xs text-slate-500 max-w-sm">{errorMsg}</p>
        </Overlay>
      )}

      {status === "ok" && (
        <>
          <div className="absolute top-3 right-3 z-10 rounded-xl bg-black/75 backdrop-blur px-4 py-3 text-xs text-white space-y-1.5">
            <p className="font-bold text-sky-400 text-sm mb-1">IFC Elements</p>
            {([ ["Walls", stats.walls], ["Slabs", stats.slabs], ["Columns", stats.columns],
                ["Doors", stats.doors], ["Windows", stats.windows] ] as [string, number][])
              .filter(([, n]) => n > 0)
              .map(([label, count]) => (
                <div key={label} className="flex justify-between gap-8">
                  <span className="text-white/60">{label}</span>
                  <span className="font-mono">{count}</span>
                </div>
              ))}
            <div className="mt-1 pt-1 border-t border-white/10 flex justify-between">
              <span className="text-white/40">Total</span>
              <span className="font-mono font-bold text-sky-400">
                {stats.walls + stats.slabs + stats.columns + stats.doors + stats.windows}
              </span>
            </div>
          </div>
          <div className="absolute bottom-3 left-3 z-10 rounded-lg bg-black/60 px-3 py-1.5 text-xs text-white/40">
            Drag to rotate · Scroll to zoom
          </div>
        </>
      )}

      <div ref={mountRef} style={{ height: 520 }} />
    </div>
  );
}
