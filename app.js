// Mercator Lab: on the left a globe inside a Mercator cylinder with the map projected onto it; on the right the
// wall map that cylinder makes, redrawn as either turns. Routes (great circle and rhumb line together) on all three.
const $ = id => document.getElementById(id);
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const COL = { earth: css("--earth"), cyl: css("--cyl"), seam: css("--seam"), b: css("--b"), a: css("--a"), bg: css("--bg"), gc: css("--gcl"), rh: css("--rhl"), ink: css("--ink") };

// ---------------- data ----------------
const COAST = topojson.mesh(WORLD, WORLD.objects.countries, (a, b) => a === b);
const LANDGEO = topojson.feature(WORLD, WORLD.objects.countries);

function densify(coords, maxDeg = 1.5) {
  const out = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = coords[i];
    const n = Math.max(1, Math.ceil(gcDist(a, b) / R_KM * 180 / Math.PI / maxDeg));
    for (let k = 1; k <= n; k++) out.push(k === n ? b : gcInterp(a, b, k / n));
  }
  return out;
}
const toVecs = lines => lines.map(l => densify(l).map(c => vec(c[0], c[1])));
function parallel(lat) { const o = []; for (let l = -180; l <= 180; l += 2) o.push([l, lat]); return o; }
function meridian(lon, a = -90, b = 90) { const o = []; for (let p = a; p <= b; p += 2) o.push([lon, p]); return o; }

const SRC = {
  coast: toVecs(COAST.coordinates),
  grat: toVecs([-60, -30, 30, 60].map(parallel).concat([-150, -120, -90, -60, -30, 30, 60, 90, 120, 150, 180].map(l => meridian(l)))),
  eq: toVecs([parallel(0), meridian(0)]),
};
// ---------------- state ----------------
const S = {
  G: ident(),               // globe rotation, geo frame (each view's cylinder rotation is in panes)
  s: 1,                     // the projected map sits on the cylinder
  globeOpacity: 0.55, cylOpacity: 0.85,
  routes: [], from: null,   // from: {c, name} waiting for a To
};
let dirty = true, routesVer = 0;
// The live view: its cylinder, projection cache and map picture.
function mkPane(id) {
  const canvas = document.createElement("canvas"); canvas.width = 1024; canvas.height = Math.round(1024 * MAXH / Math.PI);
  const tex = new THREE.CanvasTexture(canvas); tex.anisotropy = 4;
  return { id, C: ident(), PB: null, PBkey: "", canvas, tex, mapKey: "", mapDrawn: 0, mapTimer: 0, rect: { x: 0, y: 0, w: 1, h: 1 } };
}
const panes = { b: mkPane("b") };
let cur = panes.b;                // the view being drawn or handled; S.C is its cylinder
Object.defineProperty(S, "C", { get: () => cur.C, set: v => { cur.C = v; } });
function withPane(p, f) { const prev = cur; cur = p; try { return f(); } finally { cur = prev; } }
const M = () => mmul(mT(S.C), S.G); // the globe in the cylinder's frame: all the map depends on

// ---------------- three.js scene ----------------
const bench = $("live");   // the 3D view (the wall map sits beside it)
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setClearColor(new THREE.Color(COL.bg), 1);
bench.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(new THREE.Color(COL.bg), 6, 16);
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
const cam = { yaw: 0.55, pitch: 0.22, dist: 14 };
const baseUp = new THREE.Vector3(0, 1, 0);
const CAMCYL = 14;                                     // room for the cylinder
const CAM0 = { yaw: 0.55, pitch: 0.22, dist: CAMCYL };
Object.assign(cam, CAM0);
function placeCamera() {
  camera.position.set(cam.dist * Math.sin(cam.yaw) * Math.cos(cam.pitch), cam.dist * Math.sin(cam.pitch), cam.dist * Math.cos(cam.yaw) * Math.cos(cam.pitch));
  camera.up.copy(baseUp);
  camera.lookAt(0, 0, 0);
  scene.fog.near = cam.dist - 2; scene.fog.far = cam.dist + 6;
}
function setObjMatrix(obj, Rgeo) {
  const R = matToThree(Rgeo);
  obj.matrix.set(R[0][0], R[0][1], R[0][2], 0, R[1][0], R[1][1], R[1][2], 0, R[2][0], R[2][1], R[2][2], 0, 0, 0, 0, 1);
  obj.matrixWorldNeedsUpdate = true;
}
const lineMat = (color, opacity = 1) => new THREE.LineBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity, depthWrite: false, fog: true });
function tube(points, color, r = 0.012, closed = false, opacity = 1) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), closed);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(64, points.length * 2), r, 6, closed),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity, depthWrite: false, fog: true }));
}
function label(text, color, scale = 0.5) {
  const c = document.createElement("canvas"), g0 = c.getContext("2d");
  const font = "600 34px IBM Plex Sans, system-ui, sans-serif";
  g0.font = font;
  c.width = Math.ceil(g0.measureText(text).width + 28); c.height = 64;
  const g = c.getContext("2d");
  g.font = font; g.textAlign = "center"; g.textBaseline = "middle";
  g.lineWidth = 8; g.strokeStyle = "rgba(12,19,23,.9)"; g.strokeText(text, c.width / 2, 32);
  g.fillStyle = color; g.fillText(text, c.width / 2, 32);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, depthTest: false }));
  s.scale.set(scale * c.width / 64, scale, 1);
  s.userData.base = [s.scale.x, s.scale.y];
  s.renderOrder = 7;
  return s;
}

// globe ----
const globe = new THREE.Group(); globe.matrixAutoUpdate = false; scene.add(globe);
const tex = (() => {
  const c = document.createElement("canvas"); c.width = 2048; c.height = 1024;
  const g = c.getContext("2d");
  g.fillStyle = "#2a5463"; g.fillRect(0, 0, 2048, 1024);
  const path = d3.geoPath(d3.geoEquirectangular().scale(1024 / Math.PI).translate([1024, 512]), g);
  g.beginPath(); path(LANDGEO); g.fillStyle = "#d9cfb4"; g.fill();
  g.beginPath(); path(topojson.mesh(WORLD, WORLD.objects.countries, (a, b) => a !== b)); g.strokeStyle = "rgba(40,40,30,0.5)"; g.lineWidth = 1.2; g.stroke();
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
})();
const globeMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
const globeMesh = (() => {
  const geo = new THREE.BufferGeometry(), pos = [], uv = [], idx = [], NL = 128, NP = 64;
  for (let i = 0; i <= NP; i++) for (let j = 0; j <= NL; j++) {
    const lat = -90 + 180 * i / NP, lon = -180 + 360 * j / NL;
    pos.push(...toThree(vec(lon, lat))); uv.push(j / NL, i / NP);
  }
  for (let i = 0; i < NP; i++) for (let j = 0; j < NL; j++) {
    const a = i * (NL + 1) + j, b = a + NL + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const m = new THREE.Mesh(geo, globeMat); globe.add(m); return m;
})();
const globeLines = [];
let earthN = null;
(() => {
  const gl = new THREE.BufferGeometry(), arr = [];
  for (const line of SRC.grat) for (let i = 1; i < line.length; i++) arr.push(...toThree(line[i - 1]).map(x => x * 1.002), ...toThree(line[i]).map(x => x * 1.002));
  gl.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
  const grat = new THREE.LineSegments(gl, lineMat(COL.earth, 0.22)); globe.add(grat); globeLines.push(grat);
  const eq = tube(parallel(0).map(c => toThree(vec(...c)).map(x => x * 1.004)), COL.earth, 0.011, true); globe.add(eq); globeLines.push(eq);
  const pm = tube(meridian(0).map(c => toThree(vec(...c)).map(x => x * 1.004)), COL.earth, 0.011); globe.add(pm); globeLines.push(pm);
  const n = label("Earth N", COL.earth, 0.42); n.position.set(0, 1.25, 0); globe.add(n); globeLines.push(n); earthN = n;
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(COL.earth) }));
  dot.position.set(0, 1.0, 0); globe.add(dot); globeLines.push(dot);
})();

// cylinder (static parts ride along in the group) ----
const cyl = new THREE.Group(); cyl.matrixAutoUpdate = false; scene.add(cyl);
const cylSurface = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 2 * MAXH, 72, 1, true),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(COL.cyl), transparent: true, opacity: 0.045, side: THREE.DoubleSide, depthWrite: false, fog: false }));
cyl.add(cylSurface);
const cylStatics = [cylSurface];
(() => {
  const ring = []; for (let t = 0; t <= 360; t += 4) ring.push([Math.sin(rad(t)) * 1.004, 0, Math.cos(rad(t)) * 1.004]);
  const eq = tube(ring, COL.cyl, 0.013, true); cyl.add(eq); cylStatics.push(eq);
  const front = tube([[0, -MAXH, 1.004], [0, 0, 1.004], [0, MAXH, 1.004]], COL.cyl, 0.01); cyl.add(front); cylStatics.push(front);
  const axis = tube([[0, -MAXH - 0.6, 0], [0, 0, 0], [0, MAXH + 0.6, 0]], COL.cyl, 0.006, false, 0.7); cyl.add(axis); cylStatics.push(axis);
  const n = label("Map N", COL.cyl, 0.42); n.position.set(0, MAXH + 0.85, 0); cyl.add(n); cylStatics.push(n);
  const s = label("seam", COL.seam, 0.36); s.position.set(0, MAXH + 0.2, -1); cyl.add(s); cylStatics.push(s);
  const m = label("map center", COL.cyl, 0.36); m.position.set(0, MAXH + 0.2, 1); cyl.add(m); cylStatics.push(m);
})();

// filled map on the cylinder and the wall map: a Mercator picture of the map as it sits now, redrawn when it changes
const BORDERS = topojson.mesh(WORLD, WORLD.objects.countries, (a, b) => a !== b);
const mapMat = new THREE.MeshBasicMaterial({ map: panes.b.tex, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, fog: false });
const MAPN = [96, 32]; // grid of the sheet in θ and h
const mapGeo = (() => {
  const g = new THREE.BufferGeometry(), uv = [], idx = [], [NT, NH] = MAPN;
  for (let j = 0; j <= NH; j++) for (let i = 0; i <= NT; i++) uv.push(i / NT, j / NH);
  for (let j = 0; j < NH; j++) for (let i = 0; i < NT; i++) { const a = j * (NT + 1) + i, b = a + NT + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array((NT + 1) * (NH + 1) * 3), 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
})();
const mapMesh = new THREE.Mesh(mapGeo, mapMat); mapMesh.frustumCulled = false; mapMesh.renderOrder = -1; scene.add(mapMesh);
function drawMap(force) {
  const base = M(), key = JSON.stringify(base);
  const p = cur;
  if (key === p.mapKey) return;
  const now = performance.now();
  if (!force && now - p.mapDrawn < 120) { clearTimeout(p.mapTimer); p.mapTimer = setTimeout(() => { withPane(p, () => drawMap(true)); dirty = true; }, 130); return; } // at most ~8 redraws a second while dragging
  p.mapKey = key; p.mapDrawn = now;
  const W = p.canvas.width, H = p.canvas.height, g = p.canvas.getContext("2d");
  const proj = R => d3.geoMercator().rotate(euler(R)).scale(W / (2 * Math.PI)).translate([W / 2, H / 2]).precision(0.5).clipExtent([[0, 0], [W, H]]);
  g.fillStyle = "#1f4552"; g.fillRect(0, 0, W, H);
  const path = d3.geoPath(proj(base), g);
  g.beginPath(); path(LANDGEO); g.fillStyle = "#d9cfb4"; g.fill();
  g.beginPath(); path(BORDERS); g.strokeStyle = "rgba(40,40,30,0.45)"; g.lineWidth = 0.8; g.stroke();
  p.tex.needsUpdate = true;
}
function placeMap(s) {
  const a = mapGeo.attributes.position.array, [NT, NH] = MAPN, u = ease(Math.max(0, Math.min(1, s - 1)));
  for (let j = 0, o = 0; j <= NH; j++) for (let i = 0; i <= NT; i++, o += 3) cylWorld(-Math.PI + 2 * Math.PI * i / NT, -MAXH + 2 * MAXH * j / NH, u, S.C, a, o);
  mapGeo.attributes.position.needsUpdate = true;
}


// dynamic line layers ----
function dynLines(color, opacity, max = 120000) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(max * 6), 3));
  g.setDrawRange(0, 0);
  const l = new THREE.LineSegments(g, lineMat(color, opacity)); l.frustumCulled = false; scene.add(l);
  return l;
}
const L = {
  wire: dynLines(COL.cyl, 0.26, 20000), wireHi: dynLines(COL.cyl, 0.95, 4000), seam: dynLines(COL.seam, 0.9, 2000),
  coast: dynLines(COL.b, 0.9), grat: dynLines(COL.earth, 0.3, 30000), eq: dynLines(COL.earth, 1, 4000), 
};
// routes are drawn as tubes so they stay visible on the busy cylinder; rebuilt whenever the scene changes
const routeGroup = new THREE.Group(); scene.add(routeGroup);
const routeMat = c => new THREE.MeshBasicMaterial({ color: new THREE.Color(c), depthWrite: false, transparent: true });
const routeMats = [{ gc: routeMat(COL.gc), rh: routeMat(COL.rh) }, { gc: routeMat(COL.gc), rh: routeMat(COL.rh) }]; // on the globe, on the cylinder
// s 0: on the globe; 1: on the cylinder
function drawRoutes(s) {
  const mats = routeMats[s], RVs = routeVecs(), radius = 0.014 * Math.max(1, cam.dist / 8);
  for (const kind of ["gc", "rh"]) for (const line of RVs[kind]) {
    let run = [];
    const flush = () => {
      if (run.length > 1) {
        const curve = new THREE.CatmullRomCurve3(run.map(p => new THREE.Vector3(...p)));
        const m = new THREE.Mesh(new THREE.TubeGeometry(curve, run.length * 2, radius, 6, false), mats[kind]);
        m.renderOrder = 4; m.frustumCulled = false; routeGroup.add(m);
      }
      run = [];
    };
    for (const v of line) {
      const w = placePoint(v, s);
      if (!w) { flush(); continue; }
      const last = run[run.length - 1];
      if (last && Math.hypot(w[0] - last[0], w[1] - last[1], w[2] - last[2]) > 0.6) flush(); // crossed the seam
      run.push(w);
    }
    flush();
  }
}
const ptsGeo = new THREE.BufferGeometry();
ptsGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(600 * 3), 3));
const pts = new THREE.Points(ptsGeo, new THREE.PointsMaterial({ color: new THREE.Color(COL.ink), size: 7, sizeAttenuation: false, depthTest: false, transparent: true }));
pts.frustumCulled = false; pts.renderOrder = 5; scene.add(pts);
const pts2Geo = new THREE.BufferGeometry();
pts2Geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(600 * 3), 3));
const pts2 = new THREE.Points(pts2Geo, new THREE.PointsMaterial({ color: new THREE.Color(COL.ink), size: 6, sizeAttenuation: false, depthTest: false, transparent: true }));
pts2.frustumCulled = false; pts2.renderOrder = 5; scene.add(pts2);
function writeLines(obj, arr, n) {
  const a = obj.geometry.attributes.position;
  a.array.set(arr.subarray(0, n * 3));
  a.needsUpdate = true;
  obj.geometry.setDrawRange(0, n);
}
const scratch = new Float32Array(120000 * 6);

// ---------------- projection geometry ----------------
const ease = k => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// world position (three frame) of a cylinder-frame point at unroll amount u
function cylWorld(theta, h, u, Cg, out, o) {
  const p = u <= 0 ? cylPoint(theta, h) : u >= 1 ? flatPoint(theta, h) : lerp3(cylPoint(theta, h), flatPoint(theta, h), u);
  const w = mv(Cg, p);
  out[o] = w[1]; out[o + 1] = w[2]; out[o + 2] = w[0];
}
// project polylines with relative rotation Mr: segments [θ1,h1,θ2,h2,valid] + source vectors
function projectLines(lines, Mr) {
  const segs = [], src = [];
  for (const line of lines) {
    let prev = null, pv = null;
    for (const v of line) {
      const ll = lonlat(mv(Mr, v)), cur = [rad(ll[0]), ll[1]];
      if (prev) {
        const ok = Math.abs(prev[1]) <= MAXLAT && Math.abs(cur[1]) <= MAXLAT && Math.abs(prev[0] - cur[0]) < Math.PI;
        segs.push(prev[0], cylH(rad(prev[1])), cur[0], cylH(rad(cur[1])), ok ? 1 : 0);
        src.push(pv, v);
      }
      prev = cur; pv = v;
    }
  }
  return { segs, src };
}
// place segments at s: on the globe (0) → on the cylinder (1) → flat (2)
function placeLive(P, s, Gg, Cg, out) {
  let n = 0;
  const { segs, src } = P;
  for (let i = 0, j = 0; i < segs.length; i += 5, j += 2) {
    if (s > 0 && segs[i + 4] !== 1) continue;
    for (let e = 0; e < 2; e++) {
      const o = n * 3, th = segs[i + e * 2], h = segs[i + e * 2 + 1];
      const g = mv(Gg, src[j + e]), gx = g[1], gy = g[2], gz = g[0];
      if (s <= 0) { out[o] = gx * 1.004; out[o + 1] = gy * 1.004; out[o + 2] = gz * 1.004; }
      else if (s < 1) {
        cylWorld(th, h, 0, Cg, out, o); const k = ease(s);
        out[o] = gx + (out[o] - gx) * k; out[o + 1] = gy + (out[o + 1] - gy) * k; out[o + 2] = gz + (out[o + 2] - gz) * k;
      } else cylWorld(th, h, ease(Math.min(1, s - 1)), Cg, out, o);
      n++;
    }
  }
  return n;
}
// the cylinder's own grid lives on the cylinder
function placeOnCyl(segs, s, Cg, out) {
  let n = 0; const u = ease(Math.max(0, Math.min(1, s - 1)));
  for (let i = 0; i < segs.length; i += 5) {
    if (segs[i + 4] !== 1) continue;
    cylWorld(segs[i], segs[i + 1], u, Cg, out, n * 3); n++;
    cylWorld(segs[i + 2], segs[i + 3], u, Cg, out, n * 3); n++;
  }
  return n;
}
const WIRE = (() => {
  const w = [], hi = [], seam = [];
  const ring = (h, arr) => { for (let t = -180; t < 180; t += 5) arr.push(rad(t), h, rad(Math.min(180, t + 5)) - (t + 5 > 180 ? 1e-6 : 0), h, 1); };
  for (let lat = -75; lat <= 75; lat += 15) if (lat !== 0) ring(cylH(rad(lat)), w);
  ring(MAXH, w); ring(-MAXH, w); ring(0, hi);
  const vline = (t, arr) => { for (let k = 0; k < 24; k++) arr.push(t, -MAXH + 2 * MAXH * k / 24, t, -MAXH + 2 * MAXH * (k + 1) / 24, 1); };
  for (let t = -165; t <= 165; t += 15) if (t !== 0) vline(rad(t), w);
  vline(0, hi);
  vline(Math.PI - 1e-6, seam); vline(-Math.PI + 1e-6, seam);
  return { w, hi, seam };
})();

// one Earth point (geo vector) placed for the current s; null if it falls off the cylinder
function placePoint(v, s) {
  const g = mv(S.G, v), gw = [g[1] * 1.006, g[2] * 1.006, g[0] * 1.006];
  if (s <= 0) return gw;
  const ll = lonlat(mv(M(), v));
  if (Math.abs(ll[1]) > MAXLAT) return null;
  const c = new Float32Array(3);
  cylWorld(rad(ll[0]), cylH(rad(ll[1])), ease(Math.max(0, Math.min(1, s - 1))), S.C, c, 0);
  if (s >= 1) return [c[0], c[1], c[2]];
  const k = ease(s);
  return [gw[0] + (c[0] - gw[0]) * k, gw[1] + (c[1] - gw[1]) * k, gw[2] + (c[2] - gw[2]) * k];
}

// ---------------- routes ----------------
const routesShown = () => S.routes;
const nameOf = c => cityAt(c, PLACES) || fmtLL(c);
let RV = null, RVver = -1;
function routeVecs() {
  if (RVver !== routesVer) {
    RV = { gc: [], rh: [] };
    for (const r of routesShown()) {
      RV.gc.push(densify([r.a, r.b], 1).map(c => vec(...c)));
      RV.rh.push(rhumbPoints(r.a, r.b, 160).map(c => vec(...c)));
    }
    RVver = routesVer;
  }
  return RV;
}
// text sprites: endpoint names and distances; rebuilt only when the routes change
let sprites = [], spritesVer = -1;
function syncSprites() {
  const key = routesVer + "|" + (S.from ? S.from.name : "");
  if (spritesVer === key) return;
  sprites.forEach(sp => { scene.remove(sp); sp.material.map.dispose(); sp.material.dispose(); });
  sprites = [];
  const add = (text, color, at, size, lift) => { const sp = label(text, color, size); Object.assign(sp.userData, { at, lift }); scene.add(sp); sprites.push(sp); };
  for (const r of routesShown()) {
    const st = routeStats(r.a, r.b);
    add(r.an, COL.ink, vec(...r.a), 0.3, 0.14); add(r.bn, COL.ink, vec(...r.b), 0.3, 0.14);
    add(fmtNum(st.gc, st.gc) + " km", COL.gc, vec(...gcInterp(r.a, r.b, 0.5)), 0.28, 0.12);
    add(fmtNum(st.rh, st.rh) + " km", COL.rh, vec(...rhumbAt(r.a, r.b, 0.5)), 0.28, -0.12);
  }
  if (S.from) add(S.from.name, COL.ink, vec(...S.from.c), 0.3, 0.14);
  spritesVer = key;
}
function routesChanged() {
  routesVer++;
  history.replaceState(null, "", S.routes.length ? routesHash(S.routes) : location.pathname);
  renderRoutes(); dirty = true;
}
function renderRoutes() {
  const ul = $("routes"); ul.innerHTML = "";
  const note = t => { const li = document.createElement("li"); li.className = "empty"; li.textContent = t; ul.append(li); };
  if (!S.routes.length) return note("No routes yet");
  for (const r of S.routes) {
    const st = routeStats(r.a, r.b), li = document.createElement("li");
    const both = km => `${fmtNum(km, km)} km · ${fmtNum(km * KM_MI, km)} mi`;
    li.innerHTML = `<span class="mbar"></span><div class="meta"><b></b><br><span class="g">Great circle ${both(st.gc)}</span><br><span class="r">Rhumb ${both(st.rh)}</span> <span class="x2">+${st.extraPct.toFixed(st.extraPct < 10 ? 1 : 0)}%</span><br><button class="along" title="Turn the cylinder to touch the globe along this route: its great circle becomes a straight line">Cylinder along this route</button></div><button class="x" aria-label="Remove route">×</button>`;
    li.querySelector("b").textContent = `${r.an} → ${r.bn}`;
    li.querySelector(".along").onclick = () => { const C = alongRoute(S.G, r.a, r.b); if (C) turnCylinder(C); };
    li.querySelector(".x").onclick = () => { S.routes = S.routes.filter(x => x !== r); routesChanged(); };
    ul.append(li);
  }
}
// a point picked by search or click: fills From, then To (which makes the route)
function pickPoint(c, name) {
  name = name || nameOf(c);
  if (!S.from) { S.from = { c, name }; $("from").value = name; dirty = true; spritesVer = -1; return; }
  if (gcDist(S.from.c, c) < 0.5) return;
  S.routes.push({ a: S.from.c, b: c, an: S.from.name, bn: name });
  S.from = null; $("from").value = ""; $("to").value = "";
  routesChanged();
}
function clickName(c) { const p = nearestPlace(PLACES, c, 50); return p ? p[0] : fmtLL(c); }

// ---------------- draw ----------------
function rebuild() {
  const Mr = M();
  const key = JSON.stringify(Mr);
  if (key !== cur.PBkey) {
    cur.PB = { coast: projectLines(SRC.coast, Mr), grat: projectLines(SRC.grat, Mr), eq: projectLines(SRC.eq, Mr) };
    cur.PBkey = key;
  }
  const PB = cur.PB;
  const s = S.s, Gg = S.G, Cg = S.C;
  setObjMatrix(globe, Gg); setObjMatrix(cyl, Cg);

  const gop = S.globeOpacity, k = S.cylOpacity;
  globeMat.opacity = gop;
  const solid = gop > 0.97;
  if (globeMat.depthWrite !== solid) { globeMat.depthWrite = solid; globeMat.side = solid ? THREE.FrontSide : THREE.DoubleSide; globeMat.needsUpdate = true; }
  cylSurface.material.opacity = hoverTarget === "cyl" ? 0.12 : 0.045;
  // the slider fades the filled map only; outlines, grid and routes on the cylinder stay
  const fill = k > 0.005;
  mapMesh.visible = fill; mapMat.opacity = k;
  if (fill) { drawMap(); placeMap(s); mapMat.map = cur.tex; }
  writeLines(L.wire, scratch, placeOnCyl(WIRE.w, s, Cg, scratch));
  writeLines(L.wireHi, scratch, placeOnCyl(WIRE.hi, s, Cg, scratch));
  writeLines(L.seam, scratch, placeOnCyl(WIRE.seam, s, Cg, scratch));

  writeLines(L.coast, scratch, placeLive(PB.coast, s, Gg, Cg, scratch));
  writeLines(L.grat, scratch, placeLive(PB.grat, s, Gg, Cg, scratch));
  writeLines(L.eq, scratch, placeLive(PB.eq, s, Gg, Cg, scratch));
  routeGroup.children.forEach(m => m.geometry.dispose());
  routeGroup.clear();
  drawRoutes(0); drawRoutes(1);


  // endpoints (on the globe and the cylinder) and labels (on the globe)
  const ends = routesShown().flatMap(r => [r.a, r.b]).concat(S.from ? [S.from.c] : []);
  for (const [geo, at] of [[ptsGeo, 0], [pts2Geo, 1]]) {
    const pa = geo.attributes.position.array; let np = 0;
    for (const c of ends) { const w = placePoint(vec(...c), at); if (w && np < 600) { pa.set(w, np * 3); np++; } }
    geo.attributes.position.needsUpdate = true; geo.setDrawRange(0, np);
  }
  syncSprites();
  // labels sit just off the globe
  const zoom = Math.min(1, cam.dist / CAMCYL); // labels keep about the same size on screen as you zoom in
  earthN.scale.set(earthN.userData.base[0] * zoom, earthN.userData.base[1] * zoom, 1);
  earthN.position.set(0, 1 + 0.25 * zoom, 0);
  for (const sp of sprites) {
    sp.scale.set(sp.userData.base[0] * zoom, sp.userData.base[1] * zoom, 1);
    const lift = sp.userData.lift * zoom;
    const w = placePoint(sp.userData.at, 0);
    const up = [0, 1, 0], out = (n => [w[0] / n, w[1] / n, w[2] / n])(Math.hypot(...w) || 1);
    sp.position.set(w[0] + out[0] * 0.1 * zoom + up[0] * lift, w[1] + out[1] * 0.1 * zoom + up[1] * lift, w[2] + out[2] * 0.1 * zoom + up[2] * lift);
  }
}

// ---------------- readouts ----------------
// where a view's cylinder touches the globe; names the route when it runs along one
function touchText(p) {
  return withPane(p, () => {
    const Mm = M(), r = S.routes.find(r => onCylEquator(Mm, r.a, r.b));
    return r ? `Along ${r.an} → ${r.bn} · touches the route` : touchLabel(Mm);
  });
}
function updateReadout() {
  $("touch").textContent = touchText(panes.b);
  for (const [p, R] of [["g", S.G], ["c", panes.b.C]]) {
    euler(R).forEach((v, i) => { const el = $(p + i); if (document.activeElement !== el) el.value = v.toFixed(1); $(p + i + "o").textContent = v.toFixed(1) + "°"; });
  }
}

// ---------------- animation ----------------
// Each channel runs one animation at a time; starting a new one stops the old one.
const anims = { orient: 0, "orient-b": 0, camera: 0 };
let running = 0;
function tween(ms, f, channel = "orient") {
  const gen = ++anims[channel];
  if (REDUCED || ms <= 0) { f(1); dirty = true; return Promise.resolve(); }
  running++;
  return new Promise(res => {
    const t0 = performance.now();
    const step = now => {
      if (anims[channel] !== gen) { running--; res(); return; }
      const k = Math.min(1, (now - t0) / ms); f(k); dirty = true;
      if (k < 1) requestAnimationFrame(step); else { running--; res(); }
    };
    requestAnimationFrame(step);
  });
}
function cameraTo(to, up, ms = 900) {
  const from = { ...cam }, u0 = baseUp.clone(), u1 = new THREE.Vector3(...up);
  let dy = to.yaw - from.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  return tween(ms, k => { const e = ease(k); cam.yaw = from.yaw + dy * e; cam.pitch = from.pitch + (to.pitch - from.pitch) * e; cam.dist = from.dist + (to.dist - from.dist) * e; baseUp.copy(u0).lerp(u1, e).normalize(); placeCamera(); }, "camera");
}
// turn the globe to Gt and a view's cylinder to Ct together
async function animateTo(Gt, Ct, ms = 1000, pane = panes.b) {
  const G0 = S.G, C0 = pane.C, ch = "orient-" + pane.id;
  const qG = new THREE.Quaternion(), qGt = new THREE.Quaternion(), qC = new THREE.Quaternion(), qCt = new THREE.Quaternion(), tmp = new THREE.Quaternion();
  const toQ = (R, q) => { const m = matToThree(R); q.setFromRotationMatrix(new THREE.Matrix4().set(m[0][0], m[0][1], m[0][2], 0, m[1][0], m[1][1], m[1][2], 0, m[2][0], m[2][1], m[2][2], 0, 0, 0, 0, 1)); };
  const fromQ = q => { const e = new THREE.Matrix4().makeRotationFromQuaternion(q).elements; return matFromThree([[e[0], e[4], e[8]], [e[1], e[5], e[9]], [e[2], e[6], e[10]]]); };
  toQ(G0, qG); toQ(Gt, qGt); toQ(C0, qC); toQ(Ct, qCt);
  const gen = anims[ch] + 1;
  await tween(ms, k => { const e = ease(k); S.G = fromQ(tmp.copy(qG).slerp(qGt, e)); pane.C = fromQ(tmp.copy(qC).slerp(qCt, e)); }, ch);
  if (anims[ch] === gen) { S.G = Gt; pane.C = Ct; dirty = true; }
}

// ---------------- views ----------------
function paneCamera() { placeCamera(); camera.updateMatrixWorld(); }
function layout() {
  const r = bench.getBoundingClientRect();
  panes.b.rect = { x: 0, y: 0, w: r.width, h: r.height };
  camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix();
  dirty = true;
}
const turnCylinder = Ct => animateTo(S.G, Ct, 1000, panes.b);

// ---------------- wall map ----------------
// The cylinder unrolled: a flat Mercator map of the globe as it sits in the cylinder now, redrawn as either turns.
const wm = $("wall");
let wmKey = "", wmProj = null;
function drawWall() {
  const r = wm.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  const key = [JSON.stringify(M()), routesVer, S.from ? S.from.c : "", r.width, r.height].join("|");
  if (key === wmKey || r.width < 10) return;
  wmKey = key;
  wm.width = Math.round(r.width * dpr); wm.height = Math.round(r.height * dpr);
  const g = wm.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = COL.bg; g.fillRect(0, 0, r.width, r.height);
  const k = 0.94 * Math.min(r.width / (2 * Math.PI), (r.height - 40) / (2 * MAXH));
  const cx = r.width / 2, cy = 20 + (r.height - 20) / 2, mw = 2 * Math.PI * k, mh = 2 * MAXH * k;
  const box = [[cx - mw / 2, cy - mh / 2], [cx + mw / 2, cy + mh / 2]];
  wmProj = d3.geoMercator().rotate(euler(M())).scale(k).translate([cx, cy]).precision(0.4).clipExtent(box);
  const path = d3.geoPath(wmProj, g);
  g.fillStyle = "#1f4552"; g.fillRect(box[0][0], box[0][1], mw, mh);
  g.beginPath(); path(LANDGEO); g.fillStyle = "#d9cfb4"; g.fill();
  g.beginPath(); path(BORDERS); g.strokeStyle = "rgba(40,40,30,0.45)"; g.lineWidth = 0.6; g.stroke();
  g.beginPath(); path(d3.geoGraticule().step([15, 15])()); g.strokeStyle = COL.earth; g.globalAlpha = 0.25; g.lineWidth = 0.6; g.stroke(); g.globalAlpha = 1;
  g.beginPath(); path({ type: "LineString", coordinates: parallel(0) }); path({ type: "LineString", coordinates: meridian(0) }); g.strokeStyle = COL.earth; g.lineWidth = 1.2; g.stroke();
  // the cylinder's own center lines: where it touches the globe, and the map's center meridian
  g.strokeStyle = COL.cyl; g.lineWidth = 1; g.globalAlpha = 0.8; g.beginPath();
  g.moveTo(box[0][0], cy); g.lineTo(box[1][0], cy); g.moveTo(cx, box[0][1]); g.lineTo(cx, box[1][1]); g.stroke(); g.globalAlpha = 1;
  g.lineCap = "round";
  for (const rt of S.routes) {
    for (const [coords, col] of [[densify([rt.a, rt.b], 1), COL.gc], [rhumbPoints(rt.a, rt.b, 160), COL.rh]]) {
      g.beginPath(); path({ type: "LineString", coordinates: coords }); g.strokeStyle = col; g.lineWidth = 2.5; g.stroke();
    }
  }
  g.font = "600 11px IBM Plex Sans, system-ui, sans-serif"; g.textAlign = "center";
  const ends = S.routes.flatMap(rt => [[rt.a, rt.an], [rt.b, rt.bn]]).concat(S.from ? [[S.from.c, S.from.name]] : []);
  for (const [c, name] of ends) {
    const xy = wmProj(c); if (!xy || xy[1] < box[0][1] || xy[1] > box[1][1]) continue;
    g.fillStyle = COL.ink; g.beginPath(); g.arc(xy[0], xy[1], 3, 0, 2 * Math.PI); g.fill();
    g.lineWidth = 3; g.strokeStyle = "rgba(12,19,23,.9)"; g.strokeText(name, xy[0], xy[1] - 7); g.fillText(name, xy[0], xy[1] - 7);
  }
  g.strokeStyle = COL.cyl; g.lineWidth = 1; g.strokeRect(box[0][0] + 0.5, box[0][1] + 0.5, mw - 1, mh - 1);
}
// a click on the wall map adds a point, like a click on the globe
wm.addEventListener("click", e => {
  if (!wmProj) return;
  const r = wm.getBoundingClientRect(), c = wmProj.invert([e.clientX - r.left, e.clientY - r.top]);
  if (c && isFinite(c[0]) && Math.abs(c[1]) <= MAXLAT) pickPoint(c, clickName(c));
});
new ResizeObserver(() => { wmKey = ""; dirty = true; }).observe(wm);

// ---------------- input ----------------
const HINT1 = "Drag the globe or cylinder to turn it · Shift-drag: both · Right-drag: look around · Click: add a point";
const HOVER_HINT = {
  globe: "Drag: turn the globe · Click: add a point · Shift-drag: turn both",
  cyl: "Drag: turn the cylinder · Shift-drag: turn both",
  view: "Drag: look around · Double-click: reset the view",
};
let hoverTarget = null;
$("dragHint").textContent = HINT1;
function setHover(t, force) {
  if (t === hoverTarget && !force) return;
  hoverTarget = t; dirty = true;
  cv.style.cursor = t === "view" || !t ? "default" : "grab";
  $("dragHint").textContent = t ? HOVER_HINT[t] : HINT1;
}

const cv = renderer.domElement;
cv.addEventListener("contextmenu", e => e.preventDefault());
cv.addEventListener("dblclick", e => { if (hitTest(e.clientX, e.clientY).target === "view") cameraTo(CAM0, [0, 1, 0], 600); });
let drag = null, pinch = null;
const pointers = new Map();
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
// what's under the pointer: the globe, then the cylinder around it
function hitTest(x, y) {
  const r = cv.getBoundingClientRect(), pane = panes.b;
  return withPane(pane, () => Object.assign(hitPane(x - r.left, y - r.top, pane), { pane }));
}
function hitPane(px, py, pane) {
  const pr = pane.rect;
  ndc.set(((px - pr.x) / pr.w) * 2 - 1, -((py - pr.y) / pr.h) * 2 + 1);
  paneCamera(); scene.updateMatrixWorld(); ray.setFromCamera(ndc, camera);
  const hg = ray.intersectObject(globeMesh, false)[0];
  if (hg) return { target: "globe", point: hg.point };
  const hc = ray.intersectObject(cylSurface, false)[0]; if (hc) return { target: "cyl" };
  return { target: "view" };
}
// a click at cylinder lon/lat t
function clickAt(t) {
  const c = lonlat(mv(mT(M()), vec(...t)));
  pickPoint(c, clickName(c));
}
cv.addEventListener("pointerdown", e => {
  cv.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pointers.size === 2) { // two fingers: pinch to zoom
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), dist: cam.dist }; drag = null; return;
  }
  const hit = hitTest(e.clientX, e.clientY);
  const target = e.button === 2 ? "view" : e.shiftKey ? "both" : hit.target;
  drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, target, hit, button: e.button, moved: false };
  if (target !== "view") cv.style.cursor = "grabbing";
});
cv.addEventListener("pointermove", e => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    cam.dist = Math.max(4, Math.min(24, pinch.dist * pinch.d / Math.max(10, Math.hypot(a[0] - b[0], a[1] - b[1]))));
    placeCamera(); dirty = true; return;
  }
  if (!drag) { if (e.pointerType === "mouse") setHover(hitTest(e.clientX, e.clientY).target); return; }
  if (!drag.moved) { // a small wobble is still a click
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
    drag.moved = true;
  }
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
  if (drag.target === "view") { cam.yaw -= dx * 0.008; cam.pitch = Math.max(-1.45, Math.min(1.45, cam.pitch + dy * 0.008)); placeCamera(); dirty = true; return; }

  paneCamera();
  const e2 = camera.matrixWorld.elements;
  const right = fromThree([e2[0], e2[1], e2[2]]), up = fromThree([e2[4], e2[5], e2[6]]);
  const R = mmul(axisAngle(up, dx * 0.008), axisAngle(right, dy * 0.008));
  if (drag.target === "globe" || drag.target === "both") S.G = orthonormalize(mmul(R, S.G));
  if (drag.target === "cyl" || drag.target === "both") drag.hit.pane.C = orthonormalize(mmul(R, drag.hit.pane.C));
  dirty = true;
});
cv.addEventListener("pointerup", e => {
  if (drag && !drag.moved && drag.button === 0 && !e.shiftKey) {
    withPane(drag.hit.pane, () => {
      if (drag.hit.target === "globe") { const p = drag.hit.point; clickAt(lonlat(mv(mT(S.C), fromThree([p.x, p.y, p.z])))); }
    });
  }
  if (drag && drag.target !== "view") cv.style.cursor = "grab";
});
cv.addEventListener("pointerleave", () => { if (!drag) setHover(null); });
const endPointer = e => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; if (!pointers.size) drag = null; };
cv.addEventListener("pointerup", endPointer);
cv.addEventListener("pointercancel", endPointer);
cv.addEventListener("wheel", e => { e.preventDefault(); cam.dist = Math.max(4, Math.min(24, cam.dist * Math.exp(e.deltaY * 0.001))); placeCamera(); dirty = true; }, { passive: false });  // dirty: tube width follows zoom

// controls
for (const p of ["g", "c"]) for (let i = 0; i < 3; i++) $(p + i).addEventListener("input", () => {
  const v = [0, 1, 2].map(j => +$(p + j).value);
  if (p === "g") S.G = d3R(...v); else panes.b.C = d3R(...v);
  dirty = true;
});
$("pr-normal").onclick = () => turnCylinder(ident());
$("pr-trans").onclick = () => turnCylinder(d3R(0, 0, -90));
$("pr-obl").onclick = () => turnCylinder(d3R(0, 0, -45));
$("cylOpacity").addEventListener("input", e => { S.cylOpacity = +e.target.value / 100; $("cylo").textContent = e.target.value + "%"; dirty = true; });
$("opacity").addEventListener("input", e => { S.globeOpacity = +e.target.value / 100; $("opo").textContent = e.target.value + "%"; dirty = true; });
$("clearRoutes").onclick = () => { S.routes = []; S.from = null; $("from").value = ""; $("to").value = ""; routesChanged(); };
// Reset: globe, cylinder, view and opacity back to the start; routes stay
$("reset").onclick = () => {
  S.from = null; $("from").value = ""; $("to").value = "";
  S.globeOpacity = 0.55; $("opacity").value = 55; $("opo").textContent = "55%";
  S.cylOpacity = 0.85; $("cylOpacity").value = 85; $("cylo").textContent = "85%";
  animateTo(ident(), ident(), 700, panes.b); cameraTo(CAM0, [0, 1, 0], 700);
};
window.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (S.from && !(e.target.closest && e.target.closest("input"))) { S.from = null; $("from").value = ""; dirty = true; }
});

// ---------------- loop ----------------
function resize() {
  const r = bench.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  layout();
}
new ResizeObserver(resize).observe(bench);
function frame() {
  // draw only when something changed (the canvas keeps its last picture)
  if (dirty) {
    dirty = false;
    cur = panes.b; paneCamera(); rebuild();
    const r = panes.b.rect;
    renderer.setViewport(0, 0, r.w, r.h);
    renderer.render(scene, camera);
    drawWall();
    updateReadout();
  }
  requestAnimationFrame(frame);
}
(routesFromHash(location.hash) || []).forEach(r => S.routes.push({ a: r.a, b: r.b, an: nameOf(r.a), bn: nameOf(r.b) }));
routesChanged();
placeCamera(); resize();
window.addEventListener("DOMContentLoaded", () => requestAnimationFrame(frame)); // search.js loads after this file

// hooks for tests
window.__lab = { S, M, globe: () => ({ opacity: globeMat.opacity, depthWrite: globeMat.depthWrite }),
  screenOf: p => { scene.updateMatrixWorld(); const v = new THREE.Vector3(...p).project(camera), r = cv.getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; },
  idle: () => running === 0 && !dirty, animateTo, panes, alongRoute, wall: () => wmProj,
  map: () => ({ visible: mapMesh.visible, opacity: mapMat.opacity }),
  counts: () => Object.assign(Object.fromEntries(Object.entries(L).map(([k, o]) => [k, o.geometry.drawRange.count])), { routes: routeGroup.children.length }) };
