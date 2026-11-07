// Mercator Lab: a globe, a Mercator cylinder around it, the map projected onto the cylinder, and the cylinder
// unrolled into a wall map. Routes (great circle and rhumb line together) ride on the globe through every step.
const $ = id => document.getElementById(id);
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const COL = { earth: css("--earth"), cyl: css("--cyl"), seam: css("--seam"), b: css("--b"), a: css("--a"), bg: css("--bg"), gc: css("--gcl"), rh: css("--rhl"), ink: css("--ink") };

// ---------------- data ----------------
const FEATURES = topojson.feature(WORLD, WORLD.objects.countries).features.filter(f => f.properties && f.properties.name);
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
  hi: [],
};
let HI = { name: "", centroid: [0, 0], poly: null };
function setCountry(name) {
  const f = FEATURES.find(f => f.properties.name.toLowerCase() === name.toLowerCase());
  if (!f) return false;
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  // keep the largest part (contiguous US, mainland France...)
  let best = polys[0], bestA = -1;
  for (const p of polys) { const a = d3.geoArea({ type: "Polygon", coordinates: p }); if (a < 2 * Math.PI && a > bestA) { bestA = a; best = p; } }
  HI = { name: f.properties.name, centroid: d3.geoCentroid({ type: "Polygon", coordinates: best }), poly: { type: "Polygon", coordinates: best } };
  mapKey = "";
  SRC.hi = toVecs(best);
  dirty = true;
  return true;
}
$("countries").innerHTML = FEATURES.map(f => f.properties.name).sort().map(n => `<option value="${n.replace(/"/g, "&quot;")}"></option>`).join("");

// ---------------- state ----------------
// step: 0 globe, 2 projected, 3 unrolled (the buttons; 1, an empty cylinder, is no longer offered). s: 0 on the globe → 1 on the cylinder → 2 flat (animated).
const S = {
  G: ident(), C: ident(),   // globe and cylinder rotations, geo frame
  step: 0, s: 0, cylOn: false,
  globeOpacity: 0.55, mapOpacity: 0.85,
  routes: [], from: null,   // from: {c, name} waiting for a To
  A: null,                  // frozen map: projected segments on the cylinder
  moved: null,              // {G0}: the globe before a country was moved
  armed: false, busy: false,
};
let dirty = true, routesVer = 0;
const M = () => mmul(mT(S.C), S.G); // the globe in the cylinder's frame: all the map depends on

// ---------------- three.js scene ----------------
const bench = $("bench");
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setClearColor(new THREE.Color(COL.bg), 1);
bench.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(new THREE.Color(COL.bg), 6, 16);
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
const cam = { yaw: 0.55, pitch: 0.22, dist: 14 };
const CAM0 = { yaw: 0.55, pitch: 0.22, dist: 6 }; // the globe alone
const CAMCYL = 14;                                  // room for the cylinder
Object.assign(cam, CAM0);
function placeCamera() {
  camera.position.set(cam.dist * Math.sin(cam.yaw) * Math.cos(cam.pitch), cam.dist * Math.sin(cam.pitch), cam.dist * Math.cos(cam.yaw) * Math.cos(cam.pitch));
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
const mapCanvas = document.createElement("canvas"); mapCanvas.width = 1024; mapCanvas.height = Math.round(1024 * MAXH / Math.PI);
const mapTex = new THREE.CanvasTexture(mapCanvas); mapTex.anisotropy = 4;
const mapMat = new THREE.MeshBasicMaterial({ map: mapTex, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, fog: false });
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
let mapKey = "", mapDrawn = 0, mapTimer = 0;
function drawMap(force) {
  const base = S.moved && S.A ? S.A.M : M();
  const key = JSON.stringify([base, M(), HI.name, !!S.moved]);
  if (key === mapKey) return;
  const now = performance.now();
  if (!force && now - mapDrawn < 120) { clearTimeout(mapTimer); mapTimer = setTimeout(() => { dirty = true; drawMap(true); }, 130); return; } // at most ~8 redraws a second while dragging
  mapKey = key; mapDrawn = now;
  const W = mapCanvas.width, H = mapCanvas.height, g = mapCanvas.getContext("2d");
  const proj = R => d3.geoMercator().rotate(euler(R)).scale(W / (2 * Math.PI)).translate([W / 2, H / 2]).precision(0.5).clipExtent([[0, 0], [W, H]]);
  g.fillStyle = "#1f4552"; g.fillRect(0, 0, W, H);
  const p = d3.geoPath(proj(base), g);
  g.beginPath(); p(LANDGEO); g.fillStyle = "#d9cfb4"; g.fill();
  g.beginPath(); p(BORDERS); g.strokeStyle = "rgba(40,40,30,0.45)"; g.lineWidth = 0.8; g.stroke();
  if (HI.poly) { const q = d3.geoPath(proj(M()), g); g.beginPath(); q(HI.poly); g.fillStyle = S.moved ? "rgba(255,122,89,0.75)" : "rgba(255,122,89,0.35)"; g.fill(); }
  mapTex.needsUpdate = true;
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
  coast: dynLines(COL.b, 0.9), grat: dynLines(COL.earth, 0.3, 30000), eq: dynLines(COL.earth, 1, 4000), hi: dynLines(COL.b, 1, 20000),
  aCoast: dynLines(COL.a, 0.7), aEq: dynLines(COL.a, 0.9, 6000), aHi: dynLines(COL.a, 1, 20000),
};
// routes are drawn as tubes so they stay visible on the busy cylinder; rebuilt whenever the scene changes
const routeGroup = new THREE.Group(); scene.add(routeGroup);
const routeMats = { gc: new THREE.MeshBasicMaterial({ color: new THREE.Color(COL.gc), depthWrite: false, transparent: true }), rh: new THREE.MeshBasicMaterial({ color: new THREE.Color(COL.rh), depthWrite: false, transparent: true }) };
function drawRoutes(s) {
  routeGroup.children.forEach(m => m.geometry.dispose());
  routeGroup.clear();
  const RVs = routeVecs(), radius = 0.014 * Math.max(1, cam.dist / 8);
  for (const kind of ["gc", "rh"]) for (const line of RVs[kind]) {
    let run = [];
    const flush = () => {
      if (run.length > 1) {
        const curve = new THREE.CatmullRomCurve3(run.map(p => new THREE.Vector3(...p)));
        const m = new THREE.Mesh(new THREE.TubeGeometry(curve, run.length * 2, radius, 6, false), routeMats[kind]);
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
// frozen segments and the cylinder's own grid live on the cylinder; they only unroll
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
const routesShown = () => S.moved ? [] : S.routes;   // hidden while a country is moved: they'd have turned with the globe
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
  if (S.moved) return note("Hidden while a country is moved");
  for (const r of S.routes) {
    const st = routeStats(r.a, r.b), li = document.createElement("li");
    const both = km => `${fmtNum(km, km)} km · ${fmtNum(km * KM_MI, km)} mi`;
    li.innerHTML = `<span class="mbar"></span><div class="meta"><b></b><br><span class="g">Great circle ${both(st.gc)}</span><br><span class="r">Rhumb ${both(st.rh)}</span> <span class="x2">+${st.extraPct.toFixed(st.extraPct < 10 ? 1 : 0)}%</span></div><button class="x" aria-label="Remove route">×</button>`;
    li.querySelector("b").textContent = `${r.an} → ${r.bn}`;
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
  if (S.moved) putBack();
  routesChanged();
}
function clickName(c) { const p = nearestPlace(PLACES, c, 50); return p ? p[0] : fmtLL(c); }

// ---------------- draw ----------------
let PB = null, PBkey = "";
function rebuild() {
  const Mr = M();
  const key = JSON.stringify([Mr, HI.name]);
  if (key !== PBkey) {
    PB = { coast: projectLines(SRC.coast, Mr), grat: projectLines(SRC.grat, Mr), eq: projectLines(SRC.eq, Mr), hi: projectLines(SRC.hi, Mr) };
    PBkey = key;
  }
  const s = S.s, Gg = S.G, Cg = S.C;
  setObjMatrix(globe, Gg); setObjMatrix(cyl, Cg);

  // the globe fades while unrolling
  const u = Math.max(0, Math.min(1, s - 1));
  const gop = S.globeOpacity * (1 - u);
  globeMat.opacity = gop;
  const solid = gop > 0.97;
  if (globeMat.depthWrite !== solid) { globeMat.depthWrite = solid; globeMat.side = solid ? THREE.FrontSide : THREE.DoubleSide; globeMat.needsUpdate = true; }
  cylSurface.material.opacity = hoverTarget === "cyl" ? 0.12 : 0.045;
  globeLines.forEach(o => { o.visible = u < 0.6; });
  cyl.visible = S.cylOn;
  cylStatics.forEach(o => { o.visible = u < 0.02; });

  const on = S.cylOn;
  // the fill fades in over the second half of Project
  const fill = on ? S.mapOpacity * Math.max(0, Math.min(1, (s - 0.5) * 2)) : 0;
  mapMesh.visible = fill > 0.001; mapMat.opacity = fill;
  if (mapMesh.visible) { drawMap(); placeMap(s); }
  writeLines(L.wire, scratch, on ? placeOnCyl(WIRE.w, s, Cg, scratch) : 0);
  writeLines(L.wireHi, scratch, on ? placeOnCyl(WIRE.hi, s, Cg, scratch) : 0);
  writeLines(L.seam, scratch, on ? placeOnCyl(WIRE.seam, s, Cg, scratch) : 0);

  // the projected map exists only once Project starts; before that the globe's own texture is the map
  const proj = s > 0.001, whole = proj && !S.moved;
  writeLines(L.coast, scratch, whole ? placeLive(PB.coast, s, Gg, Cg, scratch) : 0);
  writeLines(L.grat, scratch, whole ? placeLive(PB.grat, s, Gg, Cg, scratch) : 0);
  writeLines(L.eq, scratch, whole ? placeLive(PB.eq, s, Gg, Cg, scratch) : 0);
  writeLines(L.hi, scratch, placeLive(PB.hi, s, Gg, Cg, scratch));
  drawRoutes(s);

  if (S.A && on) {
    writeLines(L.aCoast, scratch, placeOnCyl(S.A.coast, s, Cg, scratch));
    writeLines(L.aEq, scratch, placeOnCyl(S.A.eq, s, Cg, scratch));
    writeLines(L.aHi, scratch, placeOnCyl(S.A.hi, s, Cg, scratch));
  } else ["aCoast", "aEq", "aHi"].forEach(k => writeLines(L[k], scratch, 0));

  // endpoints and labels
  const pa = ptsGeo.attributes.position.array; let np = 0;
  const ends = routesShown().flatMap(r => [r.a, r.b]).concat(S.from ? [S.from.c] : []);
  for (const c of ends) { const w = placePoint(vec(...c), s); if (w && np < 600) { pa.set(w, np * 3); np++; } }
  ptsGeo.attributes.position.needsUpdate = true; ptsGeo.setDrawRange(0, np);
  syncSprites();
  // labels sit just off the surface: outward on the globe and cylinder, toward the viewer on the flat map
  const flatN = toThree(mv(Cg, [1, 0, 0]));
  const zoom = Math.min(1, cam.dist / CAMCYL); // labels keep about the same size on screen as you zoom in
  earthN.scale.set(earthN.userData.base[0] * zoom, earthN.userData.base[1] * zoom, 1);
  earthN.position.set(0, 1 + 0.25 * zoom, 0);
  for (const sp of sprites) {
    sp.scale.set(sp.userData.base[0] * zoom, sp.userData.base[1] * zoom, 1);
    const lift = sp.userData.lift * zoom;
    const w = placePoint(sp.userData.at, s);
    sp.visible = !!w;
    if (!w) continue;
    const up = s >= 1.5 ? toThree(mv(Cg, [0, 0, 1])) : [0, 1, 0];
    const out = s >= 1.5 ? flatN : (n => [w[0] / n, w[1] / n, w[2] / n])(Math.hypot(...w) || 1);
    sp.position.set(w[0] + out[0] * 0.1 * zoom + up[0] * lift, w[1] + out[1] * 0.1 * zoom + up[1] * lift, w[2] + out[2] * 0.1 * zoom + up[2] * lift);
  }
}

// ---------------- readouts ----------------
function updateReadout() {
  $("touch").textContent = touchLabel(M());
  for (const [p, R] of [["g", S.G], ["c", S.C]]) {
    euler(R).forEach((v, i) => { const el = $(p + i); if (document.activeElement !== el) el.value = v.toFixed(1); $(p + i + "o").textContent = v.toFixed(1) + "°"; });
  }
  for (const i of [0, 2, 3]) $("st" + i).setAttribute("aria-pressed", S.step === i);
  $("putBack").disabled = !S.moved || S.busy;
  $("move").disabled = S.busy;
  $("clearA").disabled = !S.A;
  $("lgA").hidden = !(S.A && S.cylOn);
  $("bench").classList.toggle("cylOff", !S.cylOn);
}

// ---------------- animation ----------------
// Each channel runs one animation at a time; starting a new one stops the old one.
const anims = { orient: 0, stage: 0, camera: 0 };
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
// step 0 globe, 1 cylinder, 2 projected, 3 unrolled
async function setStep(t) {
  const prev = S.step;
  S.step = t; if (t >= 1) S.cylOn = true;
  const target = Math.max(0, t - 1), from = S.s;
  if (t === 3) faceSheet();
  else if (prev === 3) cameraTo({ ...CAM0, dist: t === 0 ? CAM0.dist : CAMCYL }, [0, 1, 0]);
  else if (t === 0 && prev > 0) cameraTo({ ...cam, dist: CAM0.dist }, [0, 1, 0]);
  else if (t > 0 && prev === 0) cameraTo({ ...cam, dist: Math.max(cam.dist, CAMCYL) }, [0, 1, 0]);
  dirty = true;
  await tween(1500 * Math.max(0.3, Math.abs(target - from)), k => { S.s = from + (target - from) * ease(k); }, "stage");
  if (S.step === 0 && S.s === 0) { S.cylOn = false; dirty = true; }
}
function cameraTo(to, up, ms = 900) {
  const from = { ...cam }, u0 = camera.up.clone(), u1 = new THREE.Vector3(...up);
  let dy = to.yaw - from.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  return tween(ms, k => { const e = ease(k); cam.yaw = from.yaw + dy * e; cam.pitch = from.pitch + (to.pitch - from.pitch) * e; cam.dist = from.dist + (to.dist - from.dist) * e; camera.up.copy(u0).lerp(u1, e).normalize(); placeCamera(); }, "camera");
}
// unrolled, the bench is the wall map: look at the sheet straight on, map north up
function faceSheet() {
  const n = toThree(mv(S.C, [1, 0, 0])), up = toThree(mv(S.C, [0, 0, 1]));
  const half = Math.tan(rad(camera.fov / 2));
  const fit = 1 + 1.08 * Math.max(MAXH / half, Math.PI / (half * camera.aspect));
  return cameraTo({ yaw: Math.atan2(n[0], n[2]), pitch: Math.asin(Math.max(-1, Math.min(1, n[1]))), dist: Math.min(24, fit) }, up);
}
async function animateTo(Gt, Ct, ms = 1000) {
  const G0 = S.G, C0 = S.C;
  const qG = new THREE.Quaternion(), qGt = new THREE.Quaternion(), qC = new THREE.Quaternion(), qCt = new THREE.Quaternion(), tmp = new THREE.Quaternion();
  const toQ = (R, q) => { const m = matToThree(R); q.setFromRotationMatrix(new THREE.Matrix4().set(m[0][0], m[0][1], m[0][2], 0, m[1][0], m[1][1], m[1][2], 0, m[2][0], m[2][1], m[2][2], 0, 0, 0, 0, 1)); };
  const fromQ = q => { const e = new THREE.Matrix4().makeRotationFromQuaternion(q).elements; return matFromThree([[e[0], e[4], e[8]], [e[1], e[5], e[9]], [e[2], e[6], e[10]]]); };
  toQ(G0, qG); toQ(Gt, qGt); toQ(C0, qC); toQ(Ct, qCt);
  const gen = anims.orient + 1;
  await tween(ms, k => { const e = ease(k); S.G = fromQ(tmp.copy(qG).slerp(qGt, e)); S.C = fromQ(tmp.copy(qC).slerp(qCt, e)); });
  if (anims.orient === gen) { S.G = Gt; S.C = Ct; dirty = true; }
}
// at the Globe step, turning the cylinder brings it out, map projected
function showCylinder() { if (S.step === 0) setStep(2); }

// ---------------- country, freeze ----------------
function freeze() {
  const Mr = M(), segsOf = lines => projectLines(lines, Mr).segs;
  S.A = { M: Mr, coast: segsOf(SRC.coast), eq: segsOf(SRC.eq), hi: segsOf(SRC.hi) };
  dirty = true;
}
// turn the globe so the country's center lands on t (cylinder lon/lat), north kept up; the map before stays frozen
async function moveCountryTo(t) {
  if (S.busy) return;
  S.busy = true;
  if (!S.moved) { if (!S.A) freeze(); S.moved = { G0: S.G }; routesVer++; renderRoutes(); }
  const C0 = S.C, G0 = S.G, q = lonlat(mv(M(), vec(...HI.centroid)));
  let dl = t[0] - q[0]; dl = ((dl + 540) % 360) - 180;
  await tween(1400, k => {
    const e = ease(k), tk = [q[0] + dl * e, q[1] + (t[1] - q[1]) * e];
    S.G = orthonormalize(mmul(C0, mmul(moveRotation(q, tk), mmul(mT(C0), G0))));
  });
  S.busy = false; dirty = true;
}
async function putBack() {
  if (!S.moved) return;
  const G0 = S.moved.G0;
  S.moved = null; routesVer++; renderRoutes();
  await animateTo(G0, S.C, 900);
}
function arm(on) { S.armed = on; $("move").classList.toggle("on", on); $("move").textContent = on ? "Click a spot" : "Move"; setHover(hoverTarget, true); }

// ---------------- input ----------------
const HINT = "Drag the globe or cylinder to turn it · Shift-drag: both · Right-drag: look around · Click: add a point";
const HOVER_HINT = {
  globe: "Drag: turn the globe · Click: add a point · Shift-drag: turn both",
  sheet: "Drag: turn the globe under the map · Click: add a point",
  cyl: "Drag: turn the cylinder · Shift-drag: turn both",
  view: "Drag: look around · Double-click: reset the view",
};
let hoverTarget = null;
$("dragHint").textContent = HINT;
function setHover(t, force) {
  if (t === hoverTarget && !force) return;
  hoverTarget = t; dirty = true;
  cv.style.cursor = S.armed && (t === "globe" || t === "sheet") ? "crosshair" : t === "view" || !t ? "default" : "grab";
  $("dragHint").textContent = S.armed ? "Click where the country should go · Esc: cancel" : t ? HOVER_HINT[t] : HINT;
}

const cv = renderer.domElement;
cv.addEventListener("contextmenu", e => e.preventDefault());
cv.addEventListener("dblclick", e => { if (hitTest(e.clientX, e.clientY).target === "view") S.step === 3 ? faceSheet() : cameraTo({ ...CAM0, dist: S.cylOn ? CAMCYL : CAM0.dist }, [0, 1, 0], 600); });
let drag = null, pinch = null;
const pointers = new Map();
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
// what's under the pointer: the unrolled sheet first, then the globe, then the cylinder around it
function hitTest(x, y) {
  const r = cv.getBoundingClientRect();
  ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  scene.updateMatrixWorld(); ray.setFromCamera(ndc, camera);
  if (S.s > 1.5) { const t = sheetHit(ray.ray); if (t) return { target: "sheet", t }; }
  const hg = ray.intersectObject(globeMesh, false)[0];
  if (hg) return { target: "globe", point: hg.point };
  if (S.cylOn && S.s < 1.02) { const hc = ray.intersectObject(cylSurface, false)[0]; if (hc) return { target: "cyl" }; }
  return { target: "view" };
}
// where a ray meets the unrolled sheet (the plane x = 1 in the cylinder's frame), as cylinder lon/lat
function sheetHit(r) {
  const Ci = mT(S.C);
  const o = mv(Ci, fromThree([r.origin.x, r.origin.y, r.origin.z])), d = mv(Ci, fromThree([r.direction.x, r.direction.y, r.direction.z]));
  if (Math.abs(d[0]) < 1e-9) return null;
  const k = (1 - o[0]) / d[0]; if (k <= 0) return null;
  const th = o[1] + d[1] * k, h = o[2] + d[2] * k;
  if (Math.abs(th) > Math.PI || Math.abs(h) > MAXH) return null;
  const lat = deg(cylLat(h));
  return Math.abs(lat) > 85 ? null : [deg(th), lat];
}
// a click at cylinder lon/lat t (on the globe or the sheet)
function clickAt(t) {
  if (S.armed) { arm(false); moveCountryTo(t); return; }
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
  const target = e.button === 2 ? "view" : e.shiftKey && S.cylOn ? "both" : hit.target;
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
  if (S.busy) return;
  camera.updateMatrixWorld();
  const e2 = camera.matrixWorld.elements;
  const right = fromThree([e2[0], e2[1], e2[2]]), up = fromThree([e2[4], e2[5], e2[6]]);
  const R = mmul(axisAngle(up, dx * 0.008), axisAngle(right, dy * 0.008));
  if (drag.target === "globe" || drag.target === "sheet" || drag.target === "both") S.G = orthonormalize(mmul(R, S.G));
  if (drag.target === "cyl" || drag.target === "both") S.C = orthonormalize(mmul(R, S.C));
  dirty = true;
});
cv.addEventListener("pointerup", e => {
  if (drag && !drag.moved && drag.button === 0 && !e.shiftKey) {
    if (drag.hit.target === "globe") { const p = drag.hit.point; clickAt(lonlat(mv(mT(S.C), fromThree([p.x, p.y, p.z])))); }
    else if (drag.hit.target === "sheet") clickAt(drag.hit.t);
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
  if (p === "g") S.G = d3R(...v); else { S.C = d3R(...v); showCylinder(); }
  dirty = true;
});
for (const i of [0, 2, 3]) $("st" + i).onclick = () => setStep(i);
$("pr-normal").onclick = () => { showCylinder(); animateTo(S.G, ident()); };
$("pr-trans").onclick = () => { showCylinder(); animateTo(S.G, d3R(0, 0, -90)); };
$("pr-obl").onclick = () => { showCylinder(); animateTo(S.G, d3R(0, 0, -45)); };
$("mapOpacity").addEventListener("input", e => { S.mapOpacity = +e.target.value / 100; $("mapo").textContent = e.target.value + "%"; dirty = true; });
$("opacity").addEventListener("input", e => { S.globeOpacity = +e.target.value / 100; $("opo").textContent = e.target.value + "%"; dirty = true; });
$("clearRoutes").onclick = () => { S.routes = []; S.from = null; $("from").value = ""; $("to").value = ""; routesChanged(); };
$("country").addEventListener("change", e => { if (!setCountry(e.target.value)) e.target.value = HI.name; });
$("move").onclick = () => arm(!S.armed);
$("putBack").onclick = putBack;
$("freeze").onclick = () => { freeze(); showCylinder(); };
$("clearA").onclick = () => { S.A = null; dirty = true; };
// Reset: this step's starting state (globe, cylinder, view, opacity, frozen map, moved country); step and routes stay
$("reset").onclick = async () => {
  arm(false); S.A = null; S.from = null; $("from").value = ""; $("to").value = "";
  if (S.moved) { S.moved = null; routesVer++; renderRoutes(); }
  S.globeOpacity = 0.55; $("opacity").value = 55; $("opo").textContent = "55%";
  S.mapOpacity = 0.85; $("mapOpacity").value = 85; $("mapo").textContent = "85%";
  if (S.step === 3) { await animateTo(ident(), ident(), 700); faceSheet(); }
  else { animateTo(ident(), ident(), 700); cameraTo({ ...CAM0, dist: S.step === 0 ? CAM0.dist : CAMCYL }, [0, 1, 0], 700); }
};
window.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (S.armed) arm(false);
  else if (S.from && !(e.target.closest && e.target.closest("input"))) { S.from = null; $("from").value = ""; dirty = true; }
});

// ---------------- loop ----------------
function resize() {
  const r = bench.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix();
  dirty = true;
}
new ResizeObserver(resize).observe(bench);
function frame() {
  if (dirty) { dirty = false; rebuild(); updateReadout(); }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
setCountry("United States of America");
(routesFromHash(location.hash) || []).forEach(r => S.routes.push({ a: r.a, b: r.b, an: nameOf(r.a), bn: nameOf(r.b) }));
routesChanged();
placeCamera(); resize();
window.addEventListener("DOMContentLoaded", () => requestAnimationFrame(frame)); // search.js loads after this file

// hooks for tests
window.__lab = { S, M, hi: () => HI, globe: () => ({ opacity: globeMat.opacity, depthWrite: globeMat.depthWrite }),
  screenOf: p => { scene.updateMatrixWorld(); const v = new THREE.Vector3(...p).project(camera), r = cv.getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; },
  idle: () => running === 0 && !dirty, freeze, moveCountryTo, putBack, setStep, setCountry, animateTo,
  map: () => ({ visible: mapMesh.visible, opacity: mapMat.opacity }),
  counts: () => Object.assign(Object.fromEntries(Object.entries(L).map(([k, o]) => [k, o.geometry.drawRange.count])), { routes: routeGroup.children.length }) };
