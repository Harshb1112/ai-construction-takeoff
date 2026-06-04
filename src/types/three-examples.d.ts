declare module "three/examples/jsm/controls/OrbitControls" {
  import * as THREE from "three";
  export class OrbitControls extends THREE.EventDispatcher {
    constructor(object: THREE.Camera, domElement?: HTMLElement);
    enabled: boolean;
    enableDamping: boolean;
    dampingFactor: number;
    screenSpacePanning: boolean;
    minDistance: number;
    maxDistance: number;
    minPolarAngle: number;
    maxPolarAngle: number;
    target: THREE.Vector3;
    update(): void;
    dispose(): void;
  }
}

declare module "three/examples/jsm/loaders/IFCLoader" {
  import * as THREE from "three";
  export class IFCLoader extends THREE.Loader {
    ifcManager: any;
    load(
      url: string,
      onLoad: (object: THREE.Object3D) => void,
      onProgress?: (event: ProgressEvent<EventTarget>) => void,
      onError?: (event: ErrorEvent) => void
    ): void;
  }
}
