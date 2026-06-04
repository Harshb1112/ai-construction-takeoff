"use client";

import { useEffect, useRef, useState } from "react";
// Room type (kept local to avoid coupling to page internals)
interface Room {
  id: string; name: string; type: string; floorLevel: string;
  lengthFt: number; widthFt: number; heightFt: number;
  areaSqFt: number; perimeterFt: number; wallAreaSqFt: number;
  ceilingSqFt: number; windowCount: number; doorCount: number;
  confidence: number; notes?: string;
  materials?: { flooring?: string; walls?: string; ceiling?: string };
}
import * as THREE from "three";

const ROOM_COLORS: Record<string, number> = {
  BEDROOM: 0x6366f1,
  BATHROOM: 0x0ea5e9,
  KITCHEN: 0xf59e0b,
  LIVING: 0x10b981,
  DINING: 0xec4899,
  CORRIDOR: 0x94a3b8,
  STORE: 0x8b5cf6,
  BALCONY: 0x14b8a6,
  OTHER: 0x64748b,
};

interface Props {
  rooms: Room[];
  selectedRoomId: string | null;
  onSelectRoom: (id: string) => void;
}

export default function FloorPlan3D({ rooms, selectedRoomId, onSelectRoom }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const frameRef = useRef<number>(0);
  const roomMeshes = useRef<Map<string, THREE.Mesh>>(new Map());
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [view, setView] = useState<"3d" | "top">("3d");

  useEffect(() => {
    if (!mountRef.current) return;
    const W = mountRef.current.clientWidth;
    const H = 500;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    scene.fog = new THREE.Fog(0x1a1a2e, 50, 200);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 500);
    camera.position.set(0, 40, 50);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(30, 60, 30);
    dir.castShadow = true;
    scene.add(dir);
    const pointLight = new THREE.PointLight(0x0ea5e9, 1.5, 100);
    pointLight.position.set(-20, 20, -20);
    scene.add(pointLight);

    // Grid floor
    const gridHelper = new THREE.GridHelper(200, 40, 0x334155, 0x1e293b);
    scene.add(gridHelper);

    // Build 3D rooms
    buildRooms(scene, rooms, roomMeshes);

    // Orbit controls (simple manual implementation)
    let isDragging = false;
    let prevMouse = { x: 0, y: 0 };
    let theta = 0.3;
    let phi = 0.5;
    let radius = 70;

    const onMouseDown = (e: MouseEvent) => { isDragging = true; prevMouse = { x: e.clientX, y: e.clientY }; };
    const onMouseUp = () => { isDragging = false; };
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = (e.clientX - prevMouse.x) * 0.005;
      const dy = (e.clientY - prevMouse.y) * 0.005;
      theta -= dx;
      phi = Math.max(0.05, Math.min(Math.PI / 2 - 0.05, phi - dy));
      prevMouse = { x: e.clientX, y: e.clientY };
    };
    const onWheel = (e: WheelEvent) => {
      radius = Math.max(10, Math.min(200, radius + e.deltaY * 0.05));
    };

    // Raycaster for click selection
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const onClick = (e: MouseEvent) => {
      if (!rendererRef.current || !cameraRef.current) return;
      const rect = rendererRef.current.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, cameraRef.current);
      const meshes = Array.from(roomMeshes.current.values());
      const hits = raycaster.intersectObjects(meshes);
      if (hits.length > 0) {
        const hit = hits[0].object as THREE.Mesh;
        const id = hit.userData.roomId as string;
        if (id) onSelectRoom(id);
      }
    };

    renderer.domElement.addEventListener("mousedown", onMouseDown);
    renderer.domElement.addEventListener("mouseup", onMouseUp);
    renderer.domElement.addEventListener("mousemove", onMouseMove);
    renderer.domElement.addEventListener("wheel", onWheel);
    renderer.domElement.addEventListener("click", onClick);

    // Animation loop
    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      if (cameraRef.current) {
        cameraRef.current.position.x = radius * Math.sin(theta) * Math.cos(phi);
        cameraRef.current.position.y = radius * Math.sin(phi);
        cameraRef.current.position.z = radius * Math.cos(theta) * Math.cos(phi);
        cameraRef.current.lookAt(0, 0, 0);
      }
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frameRef.current);
      renderer.domElement.removeEventListener("mousedown", onMouseDown);
      renderer.domElement.removeEventListener("mouseup", onMouseUp);
      renderer.domElement.removeEventListener("mousemove", onMouseMove);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("click", onClick);
      renderer.dispose();
      if (mountRef.current && renderer.domElement.parentNode === mountRef.current) {
        mountRef.current.removeChild(renderer.domElement);
      }
    };
  }, [rooms]);

  // Update selection highlights
  useEffect(() => {
    roomMeshes.current.forEach((mesh, id) => {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const room = rooms.find((r) => r.id === id);
      const baseColor = ROOM_COLORS[room?.type ?? "OTHER"] ?? 0x64748b;
      if (id === selectedRoomId) {
        mat.emissive.setHex(baseColor);
        mat.emissiveIntensity = 0.4;
      } else {
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0;
      }
    });
  }, [selectedRoomId, rooms]);

  const setTopView = () => {
    if (cameraRef.current) {
      cameraRef.current.position.set(0, 80, 0.01);
      cameraRef.current.lookAt(0, 0, 0);
    }
  };

  return (
    <div className="relative bg-[#1a1a2e]">
      {/* Controls overlay */}
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-2">
        <button onClick={setTopView} className="rounded-lg bg-black/60 px-3 py-1.5 text-xs text-white hover:bg-black/80 backdrop-blur transition-colors">
          Top View
        </button>
        <div className="rounded-lg bg-black/60 px-3 py-1.5 text-xs text-white/60 backdrop-blur">
          Drag to rotate<br />Scroll to zoom<br />Click room to select
        </div>
      </div>

      {/* Room legend */}
      <div className="absolute top-3 left-3 z-10 rounded-lg bg-black/60 backdrop-blur p-2.5 space-y-1">
        <p className="text-xs font-semibold text-white/80 mb-1">Rooms ({rooms.length})</p>
        {rooms.slice(0, 8).map((r) => (
          <button
            key={r.id}
            onClick={() => onSelectRoom(r.id)}
            className={`flex items-center gap-2 w-full rounded px-2 py-0.5 text-left transition-colors ${selectedRoomId === r.id ? "bg-white/20" : "hover:bg-white/10"}`}
          >
            <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: `#${(ROOM_COLORS[r.type] ?? 0x64748b).toString(16).padStart(6, "0")}` }} />
            <span className="text-xs text-white/80 truncate">{r.name}</span>
            <span className="text-xs text-white/40 ml-auto">{r.areaSqFt.toFixed(0)}ft²</span>
          </button>
        ))}
      </div>

      <div ref={mountRef} style={{ height: 500 }} />
    </div>
  );
}

// ─── Build 3D room geometry ───────────────────────────────────
function buildRooms(scene: THREE.Scene, rooms: Room[], meshMap: React.MutableRefObject<Map<string, THREE.Mesh>>) {
  meshMap.current.clear();

  // Auto-layout rooms in a grid if no position data
  const cols = Math.ceil(Math.sqrt(rooms.length));
  let totalWidth = 0;

  // Compute total building width for centering
  rooms.forEach((r) => { totalWidth += r.lengthFt * 0.3; });
  let offsetX = -totalWidth / 2;

  const SCALE = 0.3; // ft to Three.js units

  rooms.forEach((room, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const posX = col * (room.lengthFt * SCALE + 1);
    const posZ = row * (room.widthFt * SCALE + 1);

    const color = ROOM_COLORS[room.type] ?? 0x64748b;

    // Floor slab
    const floorGeo = new THREE.BoxGeometry(room.lengthFt * SCALE, 0.15, room.widthFt * SCALE);
    const floorMat = new THREE.MeshStandardMaterial({
      color,
      transparent: true,
      opacity: 0.7,
      roughness: 0.4,
      metalness: 0.1,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.position.set(posX, -0.075, posZ);
    floorMesh.receiveShadow = true;
    floorMesh.userData.roomId = room.id;
    scene.add(floorMesh);
    meshMap.current.set(room.id, floorMesh);

    // Walls (4 sides as thin boxes)
    const wallH = room.heightFt * SCALE;
    const wallT = 0.12;
    const wallMat = new THREE.MeshStandardMaterial({
      color,
      transparent: true,
      opacity: 0.35,
      roughness: 0.6,
      side: THREE.DoubleSide,
    });

    const wallPositions = [
      { pos: [posX, wallH / 2, posZ - room.widthFt * SCALE / 2], size: [room.lengthFt * SCALE, wallH, wallT] },
      { pos: [posX, wallH / 2, posZ + room.widthFt * SCALE / 2], size: [room.lengthFt * SCALE, wallH, wallT] },
      { pos: [posX - room.lengthFt * SCALE / 2, wallH / 2, posZ], size: [wallT, wallH, room.widthFt * SCALE] },
      { pos: [posX + room.lengthFt * SCALE / 2, wallH / 2, posZ], size: [wallT, wallH, room.widthFt * SCALE] },
    ];

    wallPositions.forEach(({ pos, size }) => {
      const wallGeo = new THREE.BoxGeometry(...(size as [number, number, number]));
      const wall = new THREE.Mesh(wallGeo, wallMat.clone());
      wall.position.set(...(pos as [number, number, number]));
      wall.castShadow = true;
      wall.userData.roomId = room.id;
      scene.add(wall);
    });

    // Room label (sprite)
    const canvas = document.createElement("canvas");
    canvas.width = 256; canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.roundRect(0, 0, 256, 128, 10);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 22px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(room.name, 128, 40);
    ctx.font = "16px sans-serif";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(`${room.areaSqFt.toFixed(0)} sq ft`, 128, 70);
    ctx.fillText(`${room.lengthFt}' × ${room.widthFt}'`, 128, 95);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.set(posX, wallH + 1, posZ);
    sprite.scale.set(4, 2, 1);
    sprite.userData.roomId = room.id;
    scene.add(sprite);
  });
}
