import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { Look } from "./CarShowroom";

/** The showroom turntable: a physically lit, reflective single-seater on a dark plate. Returns a way to change the look and to free
 * everything. Throws when WebGL is unavailable (the caller then shows the flat view). */
export function mountCar(host: HTMLElement, first: Look, still: boolean): { setLook: (l: Look) => void; dispose: () => void } {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);
  renderer.domElement.style.cssText = "width:100%;height:100%;display:block;touch-action:none;cursor:grab";

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new RoomEnvironment();
  const env = pmrem.fromScene(envScene, 0.035);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.9;

  const camera = new THREE.PerspectiveCamera(27, 1, 0.1, 100);
  camera.position.set(6.3, 2.5, 8.2);
  camera.lookAt(0, 0.45, 0);

  const key = new THREE.DirectionalLight(0xfff1de, 2.2);
  key.position.set(5, 8, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 22 });
  key.shadow.radius = 5;
  key.shadow.bias = -0.0004;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x7da2ff, 1.6);
  rim.position.set(-6, 3, -5);
  scene.add(rim);

  const plate = new THREE.Mesh(new THREE.CylinderGeometry(4.1, 4.1, 0.1, 96), new THREE.MeshStandardMaterial({ color: 0x1b202b, roughness: 0.85, metalness: 0.1, envMapIntensity: 0.12 }));
  plate.position.y = -0.05;
  plate.receiveShadow = true;
  scene.add(plate);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.95, 0.022, 8, 128), new THREE.MeshBasicMaterial({ color: 0x6f7b99 }));
  ring.rotation.x = Math.PI / 2;
  scene.add(ring);

  let car = buildCar(first);
  scene.add(car.root);
  let yaw = -0.6;
  let dragging = false;
  let lastX = 0;
  let idle = 0;
  const down = (e: PointerEvent) => { dragging = true; lastX = e.clientX; renderer.domElement.setPointerCapture(e.pointerId); renderer.domElement.style.cursor = "grabbing"; };
  const move = (e: PointerEvent) => { if (dragging) { yaw += (e.clientX - lastX) * 0.01; lastX = e.clientX; idle = 0; } };
  const up = () => { dragging = false; renderer.domElement.style.cursor = "grab"; };
  const el = renderer.domElement;
  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);

  const size = () => {
    const w = host.clientWidth || 600, h = host.clientHeight || 400;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 1.3 ? 36 : 27; // a narrow window needs a wider lens to keep the whole car in view
    camera.updateProjectionMatrix();
  };
  size();
  const ro = new ResizeObserver(size);
  ro.observe(host);

  let raf = 0;
  let last = performance.now();
  const frame = (t: number) => {
    const dt = Math.min((t - last) / 1000, 0.1);
    last = t;
    idle += dt;
    if (!still && !dragging && idle > 1.2) yaw += dt * 0.4;
    car.root.rotation.y = yaw;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    setLook(l) {
      scene.remove(car.root);
      car.dispose();
      car = buildCar(l);
      scene.add(car.root);
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      car.dispose();
      disposeTree(plate);
      disposeTree(ring);
      env.dispose();
      pmrem.dispose();
      envScene.traverse((n) => {
        const m = n as THREE.Mesh;
        m.geometry?.dispose();
        (Array.isArray(m.material) ? m.material : m.material ? [m.material] : []).forEach((x) => x.dispose());
      });
      renderer.dispose();
      renderer.forceContextLoss();
      el.remove();
    },
  };
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((n) => {
    const m = n as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const x of mats) {
      (x as THREE.MeshStandardMaterial).map?.dispose();
      x.dispose();
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The car. Everything is modelled here from lofted sections, extruded profiles and lathes; nothing follows a real team's car or livery.
// The car points along +x, y is up, wheels rest on y = 0. Lengths are metres.

interface Section { x: number; zc: number; yc: number; w: number; h: number; n: number }

const catmull = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);

function sectionAt(secs: Section[], s: number): Section {
  const m = secs.length;
  const i = Math.min(Math.floor(s), m - 2);
  const t = s - i;
  const at = (k: number) => secs[Math.max(0, Math.min(m - 1, k))];
  const out = {} as Section;
  for (const key of ["x", "zc", "yc", "w", "h", "n"] as const) out[key] = catmull(at(i - 1)[key], at(i)[key], at(i + 1)[key], at(i + 2)[key], t);
  return out;
}

/** A smooth closed body through rounded-rectangle cross sections along x. UVs: u runs tail (0) to nose (1), v around the section from the
 * +z side (0) over the top (0.25) and the -z side (0.5) under the floor (0.75). */
function loft(secs: Section[], nStations = 70, nTheta = 40): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const xs = secs.map((s) => s.x);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const ring = (st: Section) => {
    const out: number[][] = [];
    for (let j = 0; j <= nTheta; j++) {
      const th = (j / nTheta) * Math.PI * 2;
      const c = Math.cos(th), sn = Math.sin(th), e = 2 / st.n;
      out.push([st.x, st.yc + (st.h / 2) * Math.sign(sn) * Math.abs(sn) ** e, st.zc + st.w * Math.sign(c) * Math.abs(c) ** e]);
    }
    return out;
  };
  for (let i = 0; i <= nStations; i++) {
    const st = sectionAt(secs, (i / nStations) * (secs.length - 1));
    ring(st).forEach((p, j) => { pos.push(...p); uv.push((st.x - x0) / (x1 - x0), j / nTheta); });
  }
  const row = nTheta + 1;
  for (let i = 0; i < nStations; i++) for (let j = 0; j < nTheta; j++) {
    const a = i * row + j, b = a + row;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  // caps: a fan from the centre of each end section
  for (const [i, flip] of [[0, false], [nStations, true]] as const) {
    const st = sectionAt(secs, (i / nStations) * (secs.length - 1));
    const c = pos.length / 3;
    pos.push(st.x, st.yc, st.zc);
    uv.push(i ? 1 : 0, 0.25);
    for (let j = 0; j < nTheta; j++) flip ? idx.push(c, i * row + j, i * row + j + 1) : idx.push(c, i * row + j + 1, i * row + j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // the seam at theta = 0 is two vertices: give them the same normal so it does not show
  const nrm = g.getAttribute("normal") as THREE.BufferAttribute;
  for (let i = 0; i <= nStations; i++) {
    const a = i * row, b = a + nTheta;
    const v = new THREE.Vector3().fromBufferAttribute(nrm, a).add(new THREE.Vector3().fromBufferAttribute(nrm, b)).normalize();
    nrm.setXYZ(a, v.x, v.y, v.z);
    nrm.setXYZ(b, v.x, v.y, v.z);
  }
  return g;
}

/** A wing element: a cambered aerofoil section extruded across `span`, leading edge at the origin and the chord running towards -x. */
function aerofoil(chord: number, thick: number, camber: number, span: number, pitch = 0): THREE.BufferGeometry {
  const up: THREE.Vector2[] = [], lo: THREE.Vector2[] = [];
  const N = 18;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const yt = 5 * thick * chord * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t ** 3 - 0.1036 * t ** 4);
    const yc = camber * chord * 4 * t * (1 - t);
    up.push(new THREE.Vector2(-t * chord, yc + yt));
    lo.push(new THREE.Vector2(-t * chord, yc - yt));
  }
  const shape = new THREE.Shape([...up, ...lo.reverse()]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: span, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -span / 2);
  g.rotateZ(pitch);
  return g;
}

/** A flat plate in the x-y plane, `t` thick in z and centred on z = 0. */
function plate(points: [number, number][], t: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y))), { depth: t, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1 });
  g.translate(0, 0, -t / 2);
  return g;
}

function strut(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 8), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

/** The livery as a texture over the lofted body: base colour, the pack's pattern in its secondary colour and an accent nose band. */
function liveryTexture(look: Look): THREE.CanvasTexture {
  const W = 1024, H = 512;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const { primary, secondary, accent } = look.colours;
  g.fillStyle = primary;
  g.fillRect(0, 0, W, H);
  g.fillStyle = secondary;
  // canvas y is flipped against v, so row = (1 - v) * H; u runs left (tail) to right (nose)
  const X = (u: number) => u * W, Y = (v: number) => (1 - v) * H;
  const poly = (pts: [number, number][]) => { g.beginPath(); pts.forEach(([u, v], i) => (i ? g.lineTo(X(u), Y(v)) : g.moveTo(X(u), Y(v)))); g.closePath(); g.fill(); };
  switch (look.pattern) {
    case "stripe": poly([[0, 0.2], [1, 0.2], [1, 0.3], [0, 0.3]]); break;
    case "hoops": for (const u of [0.22, 0.5, 0.78]) poly([[u, 0], [u + 0.07, 0], [u + 0.07, 1], [u, 1]]); break;
    case "chevron": for (const u of [0.35, 0.58]) poly([[u, 0.25], [u + 0.1, 0.02], [u + 0.15, 0.02], [u + 0.05, 0.25], [u + 0.15, 0.48], [u + 0.1, 0.48]]); break;
    case "split": poly([[0, 0.38], [1, 0.38], [1, 0.62], [0, 0.62]]); poly([[0, 0], [1, 0], [1, 0.12], [0, 0.12]]); poly([[0, 0.88], [1, 0.88], [1, 1], [0, 1]]); break;
    case "diagonal": for (const u of [0.25, 0.5, 0.75]) poly([[u, 0], [u + 0.06, 0], [u - 0.04, 0.5], [u - 0.1, 0.5]]); break;
    case "dots": for (let k = 0; k < 6; k++) for (const v of [0.25, 0.02, 0.48]) { g.beginPath(); g.arc(X(0.12 + k * 0.15), Y(v), 22, 0, Math.PI * 2); g.fill(); } break;
    default: break;
  }
  g.fillStyle = accent;
  poly([[0.93, 0], [1, 0], [1, 1], [0.93, 1]]);
  poly([[0.0, 0], [0.025, 0], [0.025, 1], [0, 1]]);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function carbonTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#16181d";
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = "#23262d";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((x + y) % 2 === 0) g.fillRect(x * 8, y * 8, 8, 8);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(14, 14);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildCar(look: Look): { root: THREE.Group; dispose: () => void } {
  const root = new THREE.Group();
  const g = new THREE.Group();
  root.add(g);
  const livery = liveryTexture(look);
  const weave = carbonTexture();
  const paint = new THREE.MeshPhysicalMaterial({ map: livery, roughness: 0.26, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.06 });
  const solid = (c: string) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.3, metalness: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.1 });
  const trim = solid(look.colours.accent);
  const teamColour = solid(look.colours.primary);
  const carbon = new THREE.MeshStandardMaterial({ map: weave, roughness: 0.5, metalness: 0.3, envMapIntensity: 0.7 });
  const matt = new THREE.MeshStandardMaterial({ color: 0x0d0f13, roughness: 0.7, metalness: 0.2 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa3b2, roughness: 0.25, metalness: 0.95 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.92, metalness: 0 });
  const helmetMat = new THREE.MeshPhysicalMaterial({ color: look.helmet, roughness: 0.2, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05 });
  const visor = new THREE.MeshPhysicalMaterial({ color: 0x0a0c10, roughness: 0.05, metalness: 0.9, clearcoat: 1 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };

  // monocoque, nose and engine cover as one lofted body
  add(loft([
    { x: -2.55, zc: 0, yc: 0.31, w: 0.07, h: 0.1, n: 2.4 },
    { x: -2.2, zc: 0, yc: 0.34, w: 0.1, h: 0.2, n: 2.6 },
    { x: -1.5, zc: 0, yc: 0.42, w: 0.2, h: 0.4, n: 2.8 },
    { x: -0.8, zc: 0, yc: 0.5, w: 0.3, h: 0.56, n: 3 },
    { x: -0.1, zc: 0, yc: 0.46, w: 0.33, h: 0.52, n: 3 },
    { x: 0.6, zc: 0, yc: 0.4, w: 0.31, h: 0.44, n: 3 },
    { x: 1.2, zc: 0, yc: 0.33, w: 0.25, h: 0.32, n: 2.8 },
    { x: 1.9, zc: 0, yc: 0.27, w: 0.17, h: 0.2, n: 2.4 },
    { x: 2.5, zc: 0, yc: 0.24, w: 0.11, h: 0.14, n: 2.2 },
    { x: 2.92, zc: 0, yc: 0.215, w: 0.05, h: 0.09, n: 2 },
  ]), paint);

  // sidepods with an undercut towards the rear
  for (const s of [-1, 1]) add(loft([
    { x: -1.75, zc: s * 0.26, yc: 0.32, w: 0.09, h: 0.18, n: 2.4 },
    { x: -1.1, zc: s * 0.4, yc: 0.33, w: 0.15, h: 0.27, n: 2.6 },
    { x: -0.4, zc: s * 0.56, yc: 0.36, w: 0.24, h: 0.38, n: 2.8 },
    { x: 0.3, zc: s * 0.56, yc: 0.35, w: 0.25, h: 0.38, n: 2.8 },
    { x: 0.8, zc: s * 0.5, yc: 0.33, w: 0.19, h: 0.32, n: 2.6 },
    { x: 1.0, zc: s * 0.46, yc: 0.31, w: 0.13, h: 0.24, n: 2.2 },
  ], 50, 32), paint);
  for (const s of [-1, 1]) add(new THREE.CircleGeometry(0.11, 24), matt, 1.0, 0.31, s * 0.46).rotation.y = Math.PI / 2; // sidepod inlets

  // floor, edge wings and diffuser
  const floor = new THREE.ExtrudeGeometry(new THREE.Shape([[1.5, -0.36], [1.1, -0.75], [-0.2, -0.85], [-1.5, -0.62], [-2.45, -0.4], [-2.45, 0.4], [-1.5, 0.62], [-0.2, 0.85], [1.1, 0.75], [1.5, 0.36]].map(([x, y]) => new THREE.Vector2(x, y))), { depth: 0.035, bevelEnabled: false });
  floor.rotateX(Math.PI / 2);
  add(floor, carbon, 0, 0.115, 0);
  const diff = add(new THREE.BoxGeometry(0.95, 0.025, 0.86), carbon, -2.3, 0.2, 0);
  diff.rotation.z = -0.22;
  for (const s of [-1, 1]) for (const k of [0, 1, 2]) add(plate([[0.3, 0], [-0.3, 0], [-0.22, 0.08], [0.3, 0.05]], 0.012), carbon, 0.35 - k * 0.8, 0.12, s * (0.84 - k * 0.1));

  // cockpit: a dark opening, the rim, the helmet and the halo
  const open = add(new THREE.CircleGeometry(1, 40), matt, 0.28, 0.664, 0);
  open.rotation.x = -Math.PI / 2;
  open.scale.set(0.42, 0.17, 1);
  const rimCurve = new THREE.CatmullRomCurve3(Array.from({ length: 24 }, (_, i) => { const a = (i / 24) * Math.PI * 2; return new THREE.Vector3(0.28 + Math.cos(a) * 0.43, 0.668, Math.sin(a) * 0.175); }), true);
  add(new THREE.TubeGeometry(rimCurve, 48, 0.014, 8, true), carbon);
  add(new THREE.SphereGeometry(0.145, 28, 20), helmetMat, 0.3, 0.7, 0).scale.set(1.15, 1, 0.95);
  add(new THREE.SphereGeometry(0.147, 24, 14, -Math.PI * 0.27, Math.PI * 0.54, Math.PI * 0.28, Math.PI * 0.3), visor, 0.3, 0.7, 0).rotation.y = Math.PI / 2;
  const haloPillar = new THREE.CatmullRomCurve3([new THREE.Vector3(1.0, 0.5, 0), new THREE.Vector3(0.95, 0.72, 0), new THREE.Vector3(0.9, 0.84, 0)]);
  add(new THREE.TubeGeometry(haloPillar, 12, 0.02, 8), carbon);
  for (const s of [-1, 1]) {
    const arc = new THREE.CatmullRomCurve3([new THREE.Vector3(0.9, 0.84, 0), new THREE.Vector3(0.62, 0.82, s * 0.18), new THREE.Vector3(0.28, 0.74, s * 0.34), new THREE.Vector3(0.1, 0.62, s * 0.34)]);
    add(new THREE.TubeGeometry(arc, 24, 0.019, 8), carbon);
  }

  // airbox (sections run tail to nose like every loft, or the surface faces inwards), engine cover fin and rear lights
  add(loft([
    { x: -1.15, zc: 0, yc: 0.78, w: 0.05, h: 0.1, n: 2.2 },
    { x: -0.85, zc: 0, yc: 0.86, w: 0.09, h: 0.2, n: 2.6 },
    { x: -0.45, zc: 0, yc: 0.86, w: 0.115, h: 0.26, n: 2.6 },
    { x: -0.15, zc: 0, yc: 0.78, w: 0.1, h: 0.16, n: 2.4 },
], 24, 24), paint);
  add(new THREE.CircleGeometry(0.075, 20), matt, -0.152, 0.79, 0).rotation.y = Math.PI / 2;
  add(plate([[-1.1, 0.76], [-2.35, 0.5], [-2.35, 0.42], [-1.1, 0.64]], 0.018), paint);
  add(new THREE.BoxGeometry(0.03, 0.06, 0.1), new THREE.MeshStandardMaterial({ color: 0xff2030, emissive: 0xff1020, emissiveIntensity: 1.4 }), -2.57, 0.33, 0);
  add(new THREE.CylinderGeometry(0.035, 0.045, 0.2, 14), metal, -2.45, 0.46, 0).rotation.z = Math.PI / 2 + 0.2;

  // mirrors
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.06, 0.1, 0.17), teamColour, 0.86, 0.7, s * 0.58);
    const stalk = strut(new THREE.Vector3(0.9, 0.62, s * 0.34), new THREE.Vector3(0.88, 0.69, s * 0.54), 0.01, carbon);
    g.add(stalk);
  }

  // front wing: three stacked elements, endplates in the team colour, two pylons to the nose
  const FW = 1.95;
  [[0.36, 0.026, 0.05, 0.1, 0.05], [0.3, 0.02, 0.06, 0.155, 0.12], [0.24, 0.016, 0.07, 0.205, 0.2]].forEach(([chord, thick, camber, y, pitch], i) =>
    add(aerofoil(chord, thick, camber, FW - i * 0.05, -pitch * 0.5), i === 2 ? trim : carbon, 2.78 - i * 0.05, y, 0));
  for (const s of [-1, 1]) {
    add(plate([[0.12, 0.0], [-0.42, 0.0], [-0.42, 0.3], [-0.3, 0.3], [0.0, 0.07], [0.12, 0.05]], 0.02), teamColour, 2.78, 0.04, s * (FW / 2)).rotation.set(0, 0, 0);
    add(new THREE.BoxGeometry(0.09, 0.14, 0.02), carbon, 2.55, 0.18, s * 0.16);
  }
  add(new THREE.BoxGeometry(0.1, 0.12, 0.05), carbon, 2.5, 0.2, 0);

  // rear wing: two elements, tall endplates, a beam wing below and a central pillar
  const RW = 1.0;
  add(aerofoil(0.42, 0.03, 0.08, RW, 0.05), carbon, -2.22, 0.88, 0);
  add(aerofoil(0.28, 0.02, 0.09, RW, 0.32), trim, -2.28, 1.03, 0);
  add(aerofoil(0.3, 0.02, 0.07, RW * 0.8, 0.0), carbon, -2.1, 0.5, 0);
  for (const s of [-1, 1]) add(plate([[-1.98, 0.38], [-2.55, 0.38], [-2.58, 1.12], [-2.2, 1.12], [-2.0, 0.7]], 0.016), teamColour, 0, 0, s * (RW / 2 + 0.005));
  add(new THREE.BoxGeometry(0.09, 0.4, 0.05), carbon, -2.28, 0.65, 0);

  // wheels: tyre, sidewall ring, rim, cover and hub, with the suspension that holds them
  const wheel = (x: number, z: number, R: number, Wd: number) => {
    const w = new THREE.Group();
    const rIn = R * 0.6;
    const prof = [[rIn, -0.46], [rIn + 0.03, -0.5], [R * 0.86, -0.5], [R * 0.95, -0.46], [R, -0.32], [R, 0.32], [R * 0.95, 0.46], [R * 0.86, 0.5], [rIn + 0.03, 0.5], [rIn, 0.46]].map(([r, y]) => new THREE.Vector2(r, y * Wd));
    const tyre = new THREE.Mesh(new THREE.LatheGeometry(prof, 56), rubber);
    const band = new THREE.Mesh(new THREE.RingGeometry(R * 0.7, R * 0.78, 48), new THREE.MeshStandardMaterial({ color: 0xe9ecf2, roughness: 0.6 }));
    band.rotation.x = -Math.PI / 2;
    band.position.y = Wd * 0.503;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(rIn, rIn, Wd * 0.9, 40), metal);
    const cover = new THREE.Mesh(new THREE.CylinderGeometry(rIn * 0.97, rIn * 0.97, 0.012, 40), matt);
    cover.position.y = Wd * 0.47;
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 12), trim);
    nut.position.y = Wd * 0.48;
    for (const m of [tyre, band, rim, cover, nut]) { m.castShadow = true; m.receiveShadow = true; w.add(m); }
    // wheel spokes seen through the cover's cut-outs
    for (let k = 0; k < 5; k++) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(rIn * 0.86, 0.006, 0.03), carbon);
      sp.position.y = Wd * 0.486;
      sp.rotation.y = (k / 5) * Math.PI * 2;
      sp.translateX(rIn * 0.43);
      w.add(sp);
    }
    w.rotation.x = z > 0 ? Math.PI / 2 : -Math.PI / 2;
    w.position.set(x, R, z);
    g.add(w);
  };
  for (const s of [-1, 1]) {
    wheel(1.78, s * 0.87, 0.34, 0.3);
    wheel(-1.85, s * 0.84, 0.355, 0.4);
    const hubF = (y: number) => new THREE.Vector3(1.78, y, s * 0.7), hubR = (y: number) => new THREE.Vector3(-1.85, y, s * 0.64);
    for (const [a, b] of [
      [new THREE.Vector3(1.55, 0.4, s * 0.2), hubF(0.4)], [new THREE.Vector3(2.0, 0.34, s * 0.2), hubF(0.4)],
      [new THREE.Vector3(1.6, 0.18, s * 0.26), hubF(0.28)], [new THREE.Vector3(1.95, 0.17, s * 0.26), hubF(0.28)], [new THREE.Vector3(1.4, 0.45, s * 0.22), hubF(0.3)],
      [new THREE.Vector3(-1.6, 0.36, s * 0.24), hubR(0.4)], [new THREE.Vector3(-2.05, 0.3, s * 0.24), hubR(0.4)],
      [new THREE.Vector3(-1.65, 0.2, s * 0.28), hubR(0.3)], [new THREE.Vector3(-2.0, 0.19, s * 0.28), hubR(0.3)],
    ]) { const m = strut(a, b, 0.011, carbon); m.castShadow = true; g.add(m); }
  }

  g.position.y = 0;
  return {
    root,
    dispose() {
      disposeTree(root);
      livery.dispose();
      weave.dispose();
    },
  };
}
