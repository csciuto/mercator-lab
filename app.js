const $ = id => document.getElementById(id);
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const COL = { earth: css("--earth"), cyl: css("--cyl"), seam: css("--seam"), b: css("--b"), a: css("--a"), land: css("--land"), muted: css("--muted"), bg: css("--bg") };

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
  eq: toVecs([parallel(0)]),
  pm: toVecs([meridian(0)]),
  hi: [],
};
let HI = { name: "", poly: null, centroid: [0, 0] };
function setCountry(name) {
  const f = FEATURES.find(f => f.properties.name.toLowerCase() === name.toLowerCase());
  if (!f) return false;
  let polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  // keep the largest part (contiguous US, mainland France...)
  let best = polys[0], bestA = -1;
  for (const p of polys) { const a = d3.geoArea({ type: "Polygon", coordinates: p }); if (a < 2 * Math.PI && a > bestA) { bestA = a; best = p; } }
  HI = { name: f.properties.name, poly: { type: "Polygon", coordinates: best }, centroid: d3.geoCentroid({ type: "Polygon", coordinates: best }) };
  SRC.hi = toVecs(best);
  dirty = true;
  return true;
}
$("countries").innerHTML = FEATURES.map(f => f.properties.name).sort().map(n => `<option value="${n.replace(/"/g, "&quot;")}"></option>`).join("");

// ---------------- state ----------------
const S = {
  G: ident(), C: ident(),        // globe and cylinder rotations, geo frame
  mode: "merc",
  stage: 0, stageTarget: 0,       // 0 globe → 1 on cylinder → 2 unrolled
  A: null,                        // frozen copy {M, mode, onlyHi, poly, segs}
  onlyHi: false,
  globeOpacity: 0.55, print: true,
  meas: [], measType: "gc", pendingMeas: null, measVer: 0,
  lastMove: null, armed: false, busy: false,
  routesHidden: false,            // routes ride on the globe, so they're hidden while a country is moved
};
let dirty = true;
const M = () => mmul(mT(S.C), S.G); // what the map sees: the globe in the cylinder's frame

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
const lineMat = (color, opacity = 1, extra = {}) => new THREE.LineBasicMaterial(Object.assign({ color: new THREE.Color(color), transparent: true, opacity, depthWrite: false, fog: true }, extra));
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
  return s;
}

// globe ----
const globe = new THREE.Group(); globe.matrixAutoUpdate = false; scene.add(globe);
const tex = (() => {
  const c = document.createElement("canvas"); c.width = 2048; c.height = 1024;
  const g = c.getContext("2d");
  g.fillStyle = "#2a5463"; g.fillRect(0, 0, 2048, 1024);
  const pr = d3.geoEquirectangular().scale(1024 / Math.PI).translate([1024, 512]);
  const path = d3.geoPath(pr, g);
  g.beginPath(); path(LANDGEO); g.fillStyle = "#d9cfb4"; g.fill();
  g.beginPath(); path(topojson.mesh(WORLD, WORLD.objects.countries, (a, b) => a !== b)); g.strokeStyle = "rgba(40,40,30,0.5)"; g.lineWidth = 1.2; g.stroke();
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
})();
let globeMesh = null;
const globeMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
(() => {
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
  globeMesh = new THREE.Mesh(geo, globeMat); globe.add(globeMesh);
})();
const globeLines = [];
(() => {
  const gl = new THREE.BufferGeometry(), arr = [];
  for (const line of SRC.grat) for (let i = 1; i < line.length; i++) arr.push(...toThree(line[i - 1]).map(x => x * 1.002), ...toThree(line[i]).map(x => x * 1.002));
  gl.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
  const grat = new THREE.LineSegments(gl, lineMat(COL.earth, 0.22)); globe.add(grat); globeLines.push(grat);
  const eq = tube(parallel(0).map(c => toThree(vec(...c)).map(x => x * 1.004)), COL.earth, 0.011, true); globe.add(eq); globeLines.push(eq);
  const pm = tube(meridian(0).map(c => toThree(vec(...c)).map(x => x * 1.004)), COL.earth, 0.011); globe.add(pm); globeLines.push(pm);
  const n = label("Earth N", COL.earth, 0.42); n.position.set(0, 1.25, 0); globe.add(n); globeLines.push(n);
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
  for (const y of [1, -1]) {
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(COL.cyl) }));
    d.position.set(0, y * 1.0, 0); cyl.add(d); cylStatics.push(d);
  }
  const n = label("Map N", COL.cyl, 0.42); n.position.set(0, MAXH + 0.85, 0); cyl.add(n); cylStatics.push(n);
  const s = label("seam", COL.seam, 0.36); s.position.set(0, MAXH + 0.2, -1); cyl.add(s); cylStatics.push(s);
  const m = label("map centre", COL.cyl, 0.36); m.position.set(0, MAXH + 0.2, 1); cyl.add(m); cylStatics.push(m);
})();

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
  bCoast: dynLines(COL.b, 0.95), bGrat: dynLines(COL.earth, 0.3, 30000), bEq: dynLines(COL.earth, 1, 4000), bHi: dynLines(COL.b, 1, 20000),
  aCoast: dynLines(COL.a, 0.7), aEq: dynLines(COL.a, 0.9, 6000), aHi: dynLines(COL.a, 1, 20000),
  rays: dynLines("#ffffff", 0.16, 4000),
  // live print of B on the cylinder while the globe is still in place
  pCoast: dynLines(COL.b, 0.5), pEq: dynLines(COL.earth, 0.7, 6000), pHi: dynLines(COL.b, 0.95, 20000),
  pGc: dynLines(css("--gcl"), 0.85, 20000), pRh: dynLines(css("--rhl"), 0.85, 20000),
  // measuring lines (attached to the globe)
  mGc: dynLines(css("--gcl"), 1, 20000), mRh: dynLines(css("--rhl"), 1, 20000),
};
const ptsGeo = new THREE.BufferGeometry();
ptsGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(600 * 3), 3));
const measPts = new THREE.Points(ptsGeo, new THREE.PointsMaterial({ color: new THREE.Color(css("--gcl")), size: 7, sizeAttenuation: false, depthTest: false, transparent: true }));
measPts.frustumCulled = false; measPts.renderOrder = 5; scene.add(measPts);
const pendGeo = new THREE.BufferGeometry();
pendGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
const pendPt = new THREE.Points(pendGeo, new THREE.PointsMaterial({ color: new THREE.Color(COL.b), size: 10, sizeAttenuation: false, depthTest: false, transparent: true }));
pendPt.frustumCulled = false; pendPt.renderOrder = 6; scene.add(pendPt);
let measSprites = [];
function writeLines(obj, arr, n) {
  const a = obj.geometry.attributes.position;
  a.array.set(arr.subarray(0, n * 3));
  a.needsUpdate = true;
  obj.geometry.setDrawRange(0, n);
}
const scratch = new Float32Array(120000 * 6);

// ---------------- projection geometry ----------------
const ease = k => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
// world position (three frame) of a cylinder-frame point at unroll amount u
function cylWorld(theta, h, u, Cg, out, o) {
  const p = u <= 0 ? cylPoint(theta, h) : u >= 1 ? flatPoint(theta, h) : lerp3(cylPoint(theta, h), flatPoint(theta, h), u);
  const w = mv(Cg, p);
  out[o] = w[1]; out[o + 1] = w[2]; out[o + 2] = w[0];
}
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// project polylines with relative rotation Mr: returns segments [θ1,h1,θ2,h2,valid] + source vectors
function projectLines(lines, Mr, mode) {
  const lm = latMax(mode), segs = [], src = [];
  for (const line of lines) {
    let prev = null, pv = null;
    for (const v of line) {
      const ll = lonlat(mv(Mr, v));
      const cur = [rad(ll[0]), ll[1]];
      if (prev) {
        const ok = Math.abs(prev[1]) <= lm && Math.abs(cur[1]) <= lm && Math.abs(prev[0] - cur[0]) < Math.PI;
        segs.push(prev[0], cylH(mode, rad(prev[1])), cur[0], cylH(mode, rad(cur[1])), ok ? 1 : 0);
        src.push(pv, v);
      }
      prev = cur; pv = v;
    }
  }
  return { segs, src };
}
// place live (B) segments at stage s: globe → cylinder → plane
function placeLive(P, s, Gg, Cg, out) {
  let n = 0;
  const { segs, src } = P;
  for (let i = 0, j = 0; i < segs.length; i += 5, j += 2) {
    const ok = segs[i + 4] === 1;
    if (s > 0 && !ok) continue;
    for (let e = 0; e < 2; e++) {
      const o = n * 3;
      const th = segs[i + e * 2], h = segs[i + e * 2 + 1];
      const g = mv(Gg, src[j + e]); const gx = g[1], gy = g[2], gz = g[0];
      if (s <= 0) { out[o] = gx * 1.003; out[o + 1] = gy * 1.003; out[o + 2] = gz * 1.003; }
      else if (s < 1) {
        cylWorld(th, h, 0, Cg, out, o); const k = ease(s);
        out[o] = gx + (out[o] - gx) * k; out[o + 1] = gy + (out[o + 1] - gy) * k; out[o + 2] = gz + (out[o + 2] - gz) * k;
      } else cylWorld(th, h, ease(Math.min(1, s - 1)), Cg, out, o);
      n++;
    }
  }
  return n;
}
// frozen (A) segments live on the cylinder; they only unroll
function placeFrozen(segs, s, Cg, out) {
  let n = 0; const u = ease(Math.max(0, Math.min(1, s - 1)));
  for (let i = 0; i < segs.length; i += 5) {
    if (segs[i + 4] !== 1) continue;
    cylWorld(segs[i], segs[i + 1], u, Cg, out, n * 3); n++;
    cylWorld(segs[i + 2], segs[i + 3], u, Cg, out, n * 3); n++;
  }
  return n;
}
// cylinder wireframe in (θ,h)
function wireSegs(mode) {
  const lm = latMax(mode), w = [], hi = [], seam = [];
  const ring = (h, arr) => { for (let t = -180; t < 180; t += 5) arr.push(rad(t), h, rad(Math.min(180, t + 5)) - (t + 5 > 180 ? 1e-6 : 0), h, 1); };
  for (let lat = -75; lat <= 75; lat += 15) if (lat !== 0 && Math.abs(lat) <= lm) ring(cylH(mode, rad(lat)), w);
  ring(MAXH, w); ring(-MAXH, w); ring(0, hi);
  const vline = (t, arr) => { for (let k = 0; k < 24; k++) arr.push(t, -MAXH + 2 * MAXH * k / 24, t, -MAXH + 2 * MAXH * (k + 1) / 24, 1); };
  for (let t = -165; t <= 165; t += 15) if (t !== 0) vline(rad(t), w);
  vline(0, hi);
  vline(Math.PI - 1e-6, seam); vline(-Math.PI + 1e-6, seam);
  return { w, hi, seam };
}

// ---------------- measuring lines ----------------
let MVcache = null, MVver = -1;
// the routes drawn right now: none while a country is moved (they'd have turned with the globe)
const shownMeas = () => S.routesHidden ? [] : S.meas;
function hideRoutes(on) { if (S.routesHidden !== on) { S.routesHidden = on; S.measVer++; renderMeasList(); dirty = true; } }
function measCoords(m) { return m.type === "gc" ? densify([m.a, m.b], 1) : rhumbPoints(m.a, m.b, 160); }
function measVecs() {
  if (MVver !== S.measVer) {
    MVcache = { gc: [], rh: [] };
    for (const m of shownMeas()) MVcache[m.type === "gc" ? "gc" : "rh"].push(measCoords(m).map(c => vec(c[0], c[1])));
    MVver = S.measVer;
  }
  return MVcache;
}
// one Earth point (geo vector) placed for the current stage; null if it falls off the cylinder
function placePoint(v, s) {
  const g = mv(S.G, v), gw = [g[1] * 1.006, g[2] * 1.006, g[0] * 1.006];
  if (s <= 0) return gw;
  const ll = lonlat(mv(M(), v));
  if (Math.abs(ll[1]) > latMax(S.mode)) return null;
  const c = new Float32Array(3);
  cylWorld(rad(ll[0]), cylH(S.mode, rad(ll[1])), ease(Math.max(0, Math.min(1, s - 1))), S.C, c, 0);
  if (s >= 1) return [c[0], c[1], c[2]];
  const k = ease(s);
  return [gw[0] + (c[0] - gw[0]) * k, gw[1] + (c[1] - gw[1]) * k, gw[2] + (c[2] - gw[2]) * k];
}
function syncMeasSprites() {
  const ms = shownMeas();
  if (measSprites.length === ms.length && measSprites.every((sp, i) => sp.userData.key === ms[i].id + ms[i].type + distLabel(lineDist(ms[i])))) return;
  measSprites.forEach(sp => { scene.remove(sp); sp.material.map.dispose(); sp.material.dispose(); });
  measSprites = ms.map(m => {
    const sp = label(distLabel(lineDist(m)), m.type === "gc" ? css("--gcl") : css("--rhl"), 0.3);
    sp.userData.key = m.id + m.type + distLabel(lineDist(m)); sp.renderOrder = 7; scene.add(sp); return sp;
  });
}
let measId = 1;
let pendingName = "";
function addMeasPoint(c, name = "") {
  hideRoutes(false);
  if (!S.pendingMeas) { S.pendingMeas = c; pendingName = name; }
  else {
    if (gcDist(S.pendingMeas, c) > 0.5) S.meas.push({ id: measId++, type: S.measType, a: S.pendingMeas, b: c, an: pendingName, bn: name });
    S.pendingMeas = null;
  }
  S.measVer++; renderMeasList(); dirty = true;
}
function renderMeasList() {
  const h = linesHash(S.meas);
  history.replaceState(null, "", h || location.pathname);
  const ul = $("measList"); ul.innerHTML = "";
  if (S.routesHidden && S.meas.length) {
    const li = document.createElement("li"); li.style.display = "block"; li.style.border = "0"; li.className = "prose";
    li.textContent = "Hidden while a country is moved. Reset both to show."; ul.append(li); return;
  }
  if (!S.meas.length) { const li = document.createElement("li"); li.style.display = "block"; li.style.border = "0"; li.className = "prose"; li.textContent = "No lines yet."; ul.append(li); return; }
  for (const m of S.meas) {
    const km = lineDist(m), li = document.createElement("li");
    li.className = m.type;
    li.innerHTML = `<span class="mbar"></span><div class="meta"><b>${m.type === "gc" ? "Great circle" : "Rhumb line"}</b><br>${fmtNum(km * KM_MI, km)} mi · ${fmtNum(km, km)} km · ${fmtNum(km * KM_NM, km)} nmi<br><span class="c"></span>${extraLabel(S.meas, m) ? '<br><span class="extra"></span>' : ""}</div><button class="x" aria-label="Remove line">×</button>`;
    if (li.querySelector(".extra")) li.querySelector(".extra").textContent = extraLabel(S.meas, m);
    li.querySelector(".c").textContent = `${m.an || cityAt(m.a) || fmtLL(m.a)} → ${m.bn || cityAt(m.b) || fmtLL(m.b)} · ${m.type === "gc" ? "initial course" : "constant course"} ${lineBearing(m).toFixed(1)}°`;
    li.querySelector(".x").onclick = () => { S.meas = S.meas.filter(x => x !== m); S.measVer++; renderMeasList(); dirty = true; };
    ul.append(li);
  }
}
function setMeasType(t) { S.measType = t; $("mt-gc").setAttribute("aria-pressed", t === "gc"); $("mt-rh").setAttribute("aria-pressed", t === "rh"); }

let PB = null, PBkey = "";
function rebuild() {
  const Mr = M();
  const key = JSON.stringify([Mr, S.mode, HI.name, S.onlyHi, S.measVer]);
  if (key !== PBkey) {
    const MV = measVecs();
    PB = {
      coast: projectLines(SRC.coast, Mr, S.mode), grat: projectLines(SRC.grat, Mr, S.mode),
      eq: projectLines(SRC.eq.concat(SRC.pm), Mr, S.mode), hi: projectLines(SRC.hi, Mr, S.mode),
      mGc: projectLines(MV.gc, Mr, S.mode), mRh: projectLines(MV.rh, Mr, S.mode),
    };
    PBkey = key;
  }
  const s = S.stage, Gg = S.G, Cg = S.C;
  setObjMatrix(globe, Gg); setObjMatrix(cyl, Cg);

  // fade the globe and cylinder statics while unrolling
  const u = Math.max(0, Math.min(1, s - 1));
  const gop = S.globeOpacity * (1 - 0.85 * u);
  globeMat.opacity = gop;
  const solid = gop > 0.97;
  if (globeMat.depthWrite !== solid) { globeMat.depthWrite = solid; globeMat.side = solid ? THREE.FrontSide : THREE.DoubleSide; globeMat.needsUpdate = true; }
  cylSurface.material.opacity = hoverTarget === "cyl" ? 0.12 : 0.045;
  globeLines.forEach(o => { o.visible = u < 0.6; });
  cylStatics.forEach(o => { o.visible = u < 0.02; });

  const W = wireSegs(S.mode);
  writeLines(L.wire, scratch, placeFrozen(W.w, s, Cg, scratch));
  writeLines(L.wireHi, scratch, placeFrozen(W.hi, s, Cg, scratch));
  writeLines(L.seam, scratch, placeFrozen(W.seam, s, Cg, scratch));

  writeLines(L.bCoast, scratch, S.onlyHi ? 0 : placeLive(PB.coast, s, Gg, Cg, scratch));
  writeLines(L.bGrat, scratch, S.onlyHi ? 0 : placeLive(PB.grat, s, Gg, Cg, scratch));
  writeLines(L.bEq, scratch, S.onlyHi ? 0 : placeLive(PB.eq, s, Gg, Cg, scratch));
  writeLines(L.bHi, scratch, placeLive(PB.hi, s, Gg, Cg, scratch));
  writeLines(L.mGc, scratch, placeLive(PB.mGc, s, Gg, Cg, scratch));
  writeLines(L.mRh, scratch, placeLive(PB.mRh, s, Gg, Cg, scratch));

  // live print: where everything lands on the cylinder right now, even before you press Project
  const showPrint = S.print && s < 0.999;
  const pf = Math.max(0, 1 - s);
  for (const [k, src, base, gate] of [["pCoast", PB.coast, 0.5, !S.onlyHi], ["pEq", PB.eq, 0.7, !S.onlyHi], ["pHi", PB.hi, 0.95, true], ["pGc", PB.mGc, 0.85, true], ["pRh", PB.mRh, 0.85, true]]) {
    L[k].material.opacity = base * pf;
    writeLines(L[k], scratch, showPrint && gate ? placeFrozen(src.segs, 0, Cg, scratch) : 0);
  }

  // measuring endpoints, pending point, distance labels
  const pa = ptsGeo.attributes.position.array; let np = 0;
  for (const m of shownMeas()) for (const c of [m.a, m.b]) { const w = placePoint(vec(...c), s); if (w && np < 600) { pa.set(w, np * 3); np++; } }
  ptsGeo.attributes.position.needsUpdate = true; ptsGeo.setDrawRange(0, np);
  const pw = S.pendingMeas && placePoint(vec(...S.pendingMeas), s);
  if (pw) { pendGeo.attributes.position.array.set(pw); pendGeo.attributes.position.needsUpdate = true; }
  pendPt.visible = !!pw;
  syncMeasSprites();
  shownMeas().forEach((m, i) => {
    const sp = measSprites[i], w = placePoint(vec(...lineAt(m, 0.5)), s);
    sp.visible = !!w;
    if (w) { const n = Math.hypot(...w) || 1; sp.position.set(w[0] + w[0] / n * 0.18, w[1] + w[1] / n * 0.18 + 0.08, w[2] + w[2] / n * 0.18); }
  });

  if (S.A) {
    writeLines(L.aCoast, scratch, S.A.onlyHi ? 0 : placeFrozen(S.A.segs.coast, s, Cg, scratch));
    writeLines(L.aEq, scratch, S.A.onlyHi ? 0 : placeFrozen(S.A.segs.eq, s, Cg, scratch));
    writeLines(L.aHi, scratch, placeFrozen(S.A.segs.hi, s, Cg, scratch));
  } else ["aCoast", "aEq", "aHi"].forEach(k => writeLines(L[k], scratch, 0));

  // rays while projecting (none exist for Mercator)
  let nr = 0;
  if (S.mode !== "merc" && s > 0.02 && s < 1.25) {
    const segs = PB.coast.segs, src = PB.coast.src;
    const op = s <= 1 ? 0.22 : 0.22 * (1.25 - s) / 0.25;
    L.rays.material.opacity = op;
    for (let i = 0, j = 0; i < segs.length && nr < 3800; i += 5 * 23, j += 2 * 23) {
      if (segs[i + 4] !== 1) continue;
      const end = new Float32Array(3); cylWorld(segs[i], segs[i + 1], 0, Cg, end, 0);
      let st;
      if (S.mode === "central") st = [0, 0, 0];
      else { const a = mv(Cg, [0, 0, segs[i + 1]]); st = [a[1], a[2], a[0]]; }
      scratch.set(st, nr * 3); nr++;
      scratch.set(end, nr * 3); nr++;
    }
  }
  writeLines(L.rays, scratch, nr);
}

// ---------------- flat (2D) panel ----------------
const flat = $("flat"), fctx = flat.getContext("2d");
const RAW = {
  merc: (l, p) => [l, Math.log(Math.tan(Math.PI / 4 + Math.max(-1.55, Math.min(1.55, p)) / 2))],
  central: (l, p) => [l, Math.tan(Math.max(-1.45, Math.min(1.45, p)))],
  lambert: (l, p) => [l, Math.sin(p)],
};
let FW = 400, FH = 400;
function flatProj(mode, Mr) {
  const sc = FW / (2 * Math.PI);
  return d3.geoProjection(RAW[mode]).rotate(euler(Mr)).scale(sc).translate([FW / 2, FH / 2]).precision(0.4).clipExtent([[0, 0], [FW, FH]]);
}
function flatXY(theta, h) { const sc = FW / (2 * Math.PI); return [FW / 2 + theta * sc, FH / 2 - h * sc]; }
let hoverFlat = null;
function drawFlat() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const r = flat.getBoundingClientRect();
  FW = Math.max(100, r.width); FH = FW * (2 * MAXH) / (2 * Math.PI);
  if (flat.width !== Math.round(FW * dpr)) { flat.width = Math.round(FW * dpr); flat.height = Math.round(FH * dpr); }
  const g = fctx; g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, FW, FH); g.fillStyle = "#0a1014"; g.fillRect(0, 0, FW, FH);

  // cylinder's own grid (straight lines)
  g.strokeStyle = COL.cyl; g.globalAlpha = 0.18; g.lineWidth = 1; g.beginPath();
  for (let t = -165; t <= 165; t += 15) { const [x] = flatXY(rad(t), 0); g.moveTo(x, 0); g.lineTo(x, FH); }
  for (let lat = -75; lat <= 75; lat += 15) if (Math.abs(lat) <= latMax(S.mode)) { const [, y] = flatXY(0, cylH(S.mode, rad(lat))); g.moveTo(0, y); g.lineTo(FW, y); }
  g.stroke(); g.globalAlpha = 1;

  const Mr = M();
  // frozen copy A
  if (S.A) {
    const pa = d3.geoPath(flatProj(S.A.mode, S.A.M), g);
    if (!S.A.onlyHi) { g.beginPath(); pa(LANDGEO); g.fillStyle = COL.a; g.globalAlpha = 0.22; g.fill(); g.globalAlpha = 1; }
    if (S.A.poly) { g.beginPath(); pa(S.A.poly); g.fillStyle = COL.a; g.globalAlpha = 0.5; g.fill(); g.globalAlpha = 1; g.strokeStyle = COL.a; g.lineWidth = 1.4; g.stroke(); }
  }
  // live B
  const pb = d3.geoPath(flatProj(S.mode, Mr), g);
  if (!S.onlyHi) {
    g.beginPath(); pb(LANDGEO); g.fillStyle = COL.b; g.globalAlpha = 0.2; g.fill(); g.globalAlpha = 0.75; g.strokeStyle = COL.b; g.lineWidth = 0.6; g.stroke(); g.globalAlpha = 1;
    g.beginPath(); pb(d3.geoGraticule().step([30, 30])()); g.strokeStyle = COL.earth; g.globalAlpha = 0.28; g.lineWidth = 0.8; g.stroke(); g.globalAlpha = 1;
    g.beginPath(); pb({ type: "LineString", coordinates: parallel(0) }); g.strokeStyle = COL.earth; g.lineWidth = 1.8; g.stroke();
    g.beginPath(); pb({ type: "LineString", coordinates: meridian(0) }); g.stroke();
  }
  if (HI.poly) { g.beginPath(); pb(HI.poly); g.fillStyle = COL.b; g.globalAlpha = 0.55; g.fill(); g.globalAlpha = 1; g.strokeStyle = COL.b; g.lineWidth = 1.6; g.stroke(); }

  // measuring lines, with distance labels above them
  const proj = flatProj(S.mode, Mr);
  for (const m of shownMeas()) {
    const col = m.type === "gc" ? css("--gcl") : css("--rhl");
    g.beginPath(); pb({ type: "LineString", coordinates: measCoords(m) });
    g.strokeStyle = col; g.lineWidth = 2; g.setLineDash(m.type === "rh" ? [6, 4] : []); g.stroke(); g.setLineDash([]);
    g.fillStyle = col;
    for (const c of [m.a, m.b]) { const q = lonlat(mv(Mr, vec(...c))); if (Math.abs(q[1]) <= latMax(S.mode)) { const [x, y] = flatXY(rad(q[0]), cylH(S.mode, rad(q[1]))); g.beginPath(); g.arc(x, y, 3, 0, 2 * Math.PI); g.fill(); } }
    const P = proj(lineAt(m, 0.5)), A = proj(lineAt(m, 0.48)), B = proj(lineAt(m, 0.52));
    if (P && A && B && P[0] >= 0 && P[0] <= FW && P[1] >= 0 && P[1] <= FH) {
      let ang = Math.atan2(B[1] - A[1], B[0] - A[0]);
      if (Math.abs(B[0] - A[0]) > FW / 2) ang = 0;
      if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
      g.save(); g.translate(P[0], P[1]); g.rotate(ang);
      g.font = "600 11px IBM Plex Mono, ui-monospace, monospace"; g.textAlign = "center";
      g.lineWidth = 3.5; g.strokeStyle = "#0a1014"; g.strokeText(distLabel(lineDist(m)), 0, -7); g.fillText(distLabel(lineDist(m)), 0, -7);
      g.restore();
    }
  }
  if (S.pendingMeas) {
    const q = lonlat(mv(Mr, vec(...S.pendingMeas)));
    if (Math.abs(q[1]) <= latMax(S.mode)) { const [x, y] = flatXY(rad(q[0]), cylH(S.mode, rad(q[1]))); g.fillStyle = COL.b; g.beginPath(); g.arc(x, y, 4.5, 0, 2 * Math.PI); g.fill(); }
  }

  // cylinder equator, centre line, seam edges
  g.strokeStyle = COL.cyl; g.lineWidth = 1.4; g.beginPath(); g.moveTo(0, FH / 2); g.lineTo(FW, FH / 2); g.moveTo(FW / 2, 0); g.lineTo(FW / 2, FH); g.stroke();
  g.strokeStyle = COL.seam; g.setLineDash([5, 4]); g.lineWidth = 1.5; g.strokeRect(0.75, -2, FW - 1.5, FH + 4); g.setLineDash([]);

  if (S.armed && hoverFlat) {
    g.strokeStyle = COL.b; g.lineWidth = 1.5; g.beginPath(); g.arc(hoverFlat[0], hoverFlat[1], 7, 0, 2 * Math.PI); g.moveTo(hoverFlat[0] - 11, hoverFlat[1]); g.lineTo(hoverFlat[0] + 11, hoverFlat[1]); g.moveTo(hoverFlat[0], hoverFlat[1] - 11); g.lineTo(hoverFlat[0], hoverFlat[1] + 11); g.stroke();
  }
}

// ---------------- readouts / notes ----------------
const NOTES = {
  merc: "<b>Mercator: no light source.</b> Height ln tan(45° + φ/2). Angles true; lengths stretch by sec φ.",
  central: "<b>Light at the centre.</b> Height tan φ. Runs off the cylinder past about 72°.",
  lambert: "<b>Rays out from the axis.</b> Height sin φ. Areas true; shapes squashed toward the poles.",
};
function updateReadout() {
  const Mr = M();
  $("ro-pole").textContent = fmtLL(lonlat(mv(mT(Mr), [0, 0, 1])));
  $("ro-center").textContent = fmtLL(lonlat(mv(mT(Mr), [1, 0, 0])));
  const tilt = deg(Math.acos(Math.max(-1, Math.min(1, mv(Mr, [0, 0, 1])[2]))));
  $("ro-rel").textContent = tilt < 0.05 ? "axes lined up (normal aspect)" : `axes ${tilt.toFixed(1)}° apart`;
  $("note").innerHTML = NOTES[S.mode];
  $("flatmode").textContent = { merc: "Mercator", central: "Central cylindrical", lambert: "Lambert equal-area" }[S.mode];
  for (const [p, R] of [["g", S.G], ["c", S.C]]) {
    const e = euler(R);
    e.forEach((v, i) => { const el = $(p + i); if (document.activeElement !== el) el.value = v.toFixed(1); $(p + i + "o").textContent = v.toFixed(1) + "°"; });
  }
  $("bring").disabled = !S.lastMove || S.busy;
  $("clearA").disabled = !S.A;
  for (let i = 0; i < 3; i++) $("st" + i).setAttribute("aria-pressed", S.stageTarget === i);
}

// ---------------- animation helpers ----------------
// Each channel ("orient", "stage") runs one animation at a time; starting a new one stops the old one.
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
function setStage(t) {
  S.stageTarget = t; const from = S.stage;
  $("side").classList.toggle("unrolled", t === 2);
  if (t === 2) faceSheet(); else if (from > 1.5) resetView();
  return tween(900 * Math.max(0.4, Math.abs(t - from)), k => { S.stage = from + (t - from) * k; }, "stage");
}
// unrolled, the bench becomes the wall map: look at the sheet straight on, map north up
function faceSheet() {
  const n = toThree(mv(S.C, [1, 0, 0])), up = toThree(mv(S.C, [0, 0, 1]));
  const half = Math.tan(rad(camera.fov / 2));
  const fit = 1 + 1.08 * Math.max(MAXH / half, Math.PI / (half * camera.aspect));
  const from = { ...cam }, u0 = camera.up.clone(), u1 = new THREE.Vector3(...up);
  const to = { yaw: Math.atan2(n[0], n[2]), pitch: Math.asin(Math.max(-1, Math.min(1, n[1]))), dist: Math.min(24, fit) };
  let dy = to.yaw - from.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  tween(900, k => { const e = ease(k); cam.yaw = from.yaw + dy * e; cam.pitch = from.pitch + (to.pitch - from.pitch) * e; cam.dist = from.dist + (to.dist - from.dist) * e; camera.up.copy(u0).lerp(u1, e).normalize(); placeCamera(); }, "camera");
}
// Move a country: turn the globe so the country's centre lands on target t (cylinder lon/lat), north kept up
async function moveCountryTo(t) {
  if (!HI.poly || S.busy) return;
  S.busy = true;
  const Mr = M(), q = lonlat(mv(Mr, vec(...HI.centroid)));
  const C0 = S.C, G0 = S.G;
  let dl = t[0] - q[0]; dl = ((dl + 540) % 360) - 180;
  hideRoutes(true);
  const T1 = moveRotation(q, t);
  await tween(1400, k => {
    const e = ease(k), tk = [q[0] + dl * e, q[1] + (t[1] - q[1]) * e];
    S.G = orthonormalize(mmul(C0, mmul(moveRotation(q, tk), mmul(mT(C0), G0))));
  });
  S.lastMove = { q, t, dl, T: T1 };
  S.busy = false; dirty = true;
}
async function bringCylinder() {
  if (!S.lastMove || S.busy) return;
  S.busy = true;
  const { q, t, dl } = S.lastMove, C0 = S.C;
  await tween(1400, k => {
    const e = ease(k), tk = [q[0] + dl * e, q[1] + (t[1] - q[1]) * e];
    S.C = orthonormalize(mmul(C0, moveRotation(q, tk)));
  });
  S.lastMove = null; S.busy = false; dirty = true;
}
function freeze() {
  const Mr = M();
  const segsOf = lines => projectLines(lines, Mr, S.mode).segs;
  S.A = { M: Mr, mode: S.mode, onlyHi: S.onlyHi, poly: HI.poly, segs: { coast: segsOf(SRC.coast), eq: segsOf(SRC.eq.concat(SRC.pm)), hi: segsOf(SRC.hi) } };
  dirty = true;
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

// ---------------- input ----------------
const HINT = "Drag: turn the globe or cylinder · Shift-drag: both · Right-drag: look around · Click the globe or map: add a point";
const HOVER_HINT = {
  globe: "Drag: turn the globe · Click: add a point · Shift-drag: turn both",
  sheet: "Drag: turn the globe · Click: add a point",
  cyl: "Drag: turn the cylinder · Shift-drag: turn both",
  view: "Drag: look around",
};
let hoverTarget = null;
$("dragHint").textContent = HINT;
const CAM0 = { ...cam };
function resetView() {
  const from = { ...cam }, u0 = camera.up.clone(), u1 = new THREE.Vector3(0, 1, 0);
  let dy = CAM0.yaw - from.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  tween(600, k => { const e = ease(k); cam.yaw = from.yaw + dy * e; cam.pitch = from.pitch + (CAM0.pitch - from.pitch) * e; cam.dist = from.dist + (CAM0.dist - from.dist) * e; camera.up.copy(u0).lerp(u1, e).normalize(); placeCamera(); }, "camera");
}
$("resetView").onclick = () => S.stageTarget === 2 ? faceSheet() : resetView();

const cv = renderer.domElement;
cv.addEventListener("contextmenu", e => e.preventDefault());
cv.addEventListener("dblclick", e => { if (hitTest(e.clientX, e.clientY).target === "view") $("resetView").click(); });
let drag = null;
const pointers = new Map();
let pinch = null;
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
// what's under the pointer: the globe wins over the cylinder that surrounds it
function hitTest(x, y) {
  const r = cv.getBoundingClientRect();
  ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  scene.updateMatrixWorld(); ray.setFromCamera(ndc, camera);
  if (S.stage > 1.5) { // unrolled: the wall map is in front
    const t = sheetHit(ray.ray);
    if (t) return { target: "sheet", t };
  }
  const hg = ray.intersectObject(globeMesh, false)[0];
  if (hg) return { target: "globe", point: hg.point };
  if (S.stage < 1.02) { const hc = ray.intersectObject(cylSurface, false)[0]; if (hc) return { target: "cyl" }; }
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
  const lat = deg(cylLat(S.mode, h));
  if (Math.abs(lat) > Math.min(85, latMax(S.mode))) return null;
  return [deg(th), lat];
}
function setHover(t) {
  if (t === hoverTarget) return;
  hoverTarget = t; dirty = true;
  cv.style.cursor = t === "view" || !t ? "default" : "grab";
  $("dragHint").textContent = t ? HOVER_HINT[t] : HINT;
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
  if (!drag.moved) { // small wobble is still a click
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
  if (drag.target !== "both") S.lastMove = null;
  dirty = true;
});
cv.addEventListener("pointerup", e => {
  if (drag && !drag.moved && drag.button === 0 && !e.shiftKey && drag.hit.target === "globe") {
    // a click on the globe drops a measuring point there
    const p = drag.hit.point, geoW = fromThree([p.x, p.y, p.z]);
    addMeasPoint(lonlat(mv(mT(S.G), geoW)));
  }
  if (drag && !drag.moved && drag.button === 0 && drag.hit.target === "sheet") sheetClick(drag.hit.t);
  if (drag && drag.target !== "view") cv.style.cursor = "grab";
});
cv.addEventListener("pointerleave", () => { if (!drag) setHover(null); });
const endPointer = e => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; if (!pointers.size) drag = null; };
cv.addEventListener("pointerup", endPointer);
cv.addEventListener("pointercancel", endPointer);
cv.addEventListener("wheel", e => { e.preventDefault(); cam.dist = Math.max(4, Math.min(24, cam.dist * Math.exp(e.deltaY * 0.001))); placeCamera(); dirty = true; }, { passive: false });

for (const p of ["g", "c"]) for (let i = 0; i < 3; i++) $(p + i).addEventListener("input", () => {
  const v = [0, 1, 2].map(j => +$(p + j).value);
  if (p === "g") S.G = d3R(...v); else S.C = d3R(...v);
  S.lastMove = null; dirty = true;
});
$("st0").onclick = () => setStage(0); $("st1").onclick = () => setStage(1); $("st2").onclick = () => setStage(2);
$("mode").onchange = e => { S.mode = e.target.value; dirty = true; };
$("freeze").onclick = freeze;
$("clearA").onclick = () => { S.A = null; dirty = true; };
$("onlyHi").onchange = e => { S.onlyHi = e.target.checked; dirty = true; };
$("country").addEventListener("change", e => { if (!setCountry(e.target.value)) e.target.value = HI.name; S.lastMove = null; });
$("move").onclick = () => { S.armed = !S.armed; flat.classList.toggle("armed", S.armed); $("move").textContent = S.armed ? "Click the flat map…" : "Move country…"; };
$("bring").onclick = bringCylinder;
$("print").onchange = e => { S.print = e.target.checked; dirty = true; };
$("opacity").addEventListener("input", e => { S.globeOpacity = +e.target.value / 100; $("opo").textContent = e.target.value + "%"; dirty = true; });
$("mt-gc").onclick = () => setMeasType("gc"); $("mt-rh").onclick = () => setMeasType("rh");
$("mUndo").onclick = () => { S.meas.pop(); S.measVer++; renderMeasList(); dirty = true; };
$("mClear").onclick = () => { S.meas = []; S.pendingMeas = null; S.measVer++; renderMeasList(); dirty = true; };
$("mPair").onclick = () => {
  const key = m => `${m.a}|${m.b}`, have = new Set(S.meas.map(m => m.type + key(m)));
  S.meas.slice().forEach(m => { const o = m.type === "gc" ? "rh" : "gc"; if (!have.has(o + key(m))) { S.meas.push({ id: measId++, type: o, a: m.a.slice(), b: m.b.slice(), an: m.an, bn: m.bn }); have.add(o + key(m)); } });
  S.measVer++; renderMeasList(); dirty = true;
};
window.addEventListener("keydown", e => {
  if (e.target.closest && e.target.closest("input:not([type=checkbox]):not([type=range]), select, textarea")) return;
  if (e.key === "g" || e.key === "G") setMeasType("gc");
  else if (e.key === "r" || e.key === "R") setMeasType("rh");
  else if (e.key === "Escape") { S.pendingMeas = null; S.armed = false; flat.classList.remove("armed"); $("move").textContent = "Move country…"; dirty = true; }
  else if (e.key === "Backspace" || e.key === "Delete") { S.meas.pop(); S.measVer++; renderMeasList(); dirty = true; }
});
const Rnormal = () => ident();
$("pr-normal").onclick = () => animateTo(S.G, Rnormal());
$("pr-trans").onclick = () => animateTo(S.G, d3R(0, 0, -90));
$("pr-obl").onclick = () => animateTo(S.G, d3R(0, 0, -45));
$("pr-reset").onclick = () => { S.lastMove = null; hideRoutes(false); animateTo(ident(), ident()); };

function flatToCyl(e) {
  const r = flat.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  const sc = FW / (2 * Math.PI), th = (x - FW / 2) / sc, h = (FH / 2 - y) / sc;
  return { x, y, t: [deg(th), deg(cylLat(S.mode, h))], ok: Math.abs(h) <= MAXH && Math.abs(deg(cylLat(S.mode, h))) <= Math.min(80, latMax(S.mode)) };
}
flat.addEventListener("pointermove", e => { flat.style.cursor = "crosshair"; if (!S.armed) return; const p = flatToCyl(e); hoverFlat = [p.x, p.y]; dirty = true; });
flat.addEventListener("pointerleave", () => { hoverFlat = null; dirty = true; });
// a click on the wall map (side panel or unrolled sheet), at cylinder lon/lat t
function sheetClick(t) {
  if (!S.armed) { addMeasPoint(lonlat(mv(mT(M()), vec(...t)))); return; }
  S.armed = false; flat.classList.remove("armed"); $("move").textContent = "Move country…"; hoverFlat = null;
  moveCountryTo(t);
}
flat.addEventListener("click", e => { const p = flatToCyl(e); if (p.ok) sheetClick(p.t); });

// ---------------- search: a city or typed coordinates ----------------
const q = $("q"), qList = $("q-results");
let qItems = [], qSel = 0;
function showResults() {
  const c = parseCoord(q.value);
  qItems = (c ? [{ c, label: fmtLL(c), where: "" }] : [])
    .concat(searchPlaces(PLACES, q.value, 8).map(([name, where, lat, lon]) => ({ c: [lon, lat], name, label: name, where })));
  qSel = 0; qList.innerHTML = "";
  qItems.forEach((it, i) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option"); li.setAttribute("aria-selected", i === qSel);
    li.innerHTML = '<span class="n"></span><span class="w"></span>';
    li.firstChild.textContent = it.label; li.lastChild.textContent = it.where;
    li.addEventListener("mousedown", e => { e.preventDefault(); choose(i); });
    qList.append(li);
  });
  qList.hidden = !qItems.length;
}
function choose(i) {
  const it = qItems[i]; if (!it) return;
  q.value = ""; qList.hidden = true; qItems = [];
  addMeasPoint(it.c, it.name || "");
}
q.addEventListener("input", showResults);
q.addEventListener("keydown", e => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    qSel = (qSel + (e.key === "ArrowDown" ? 1 : -1) + qItems.length) % Math.max(1, qItems.length);
    [...qList.children].forEach((li, k) => li.setAttribute("aria-selected", k === qSel));
  } else if (e.key === "Enter") { e.preventDefault(); choose(qSel); }
  else if (e.key === "Escape") { q.value = ""; qList.hidden = true; }
});
q.addEventListener("blur", () => { qList.hidden = true; });

// the guided demo
$("demo").onclick = async () => {
  if (S.busy) return;
  $("demo").disabled = true;
  S.mode = "merc"; $("mode").value = "merc";
  setCountry("United States of America"); $("country").value = HI.name;
  S.onlyHi = false; $("onlyHi").checked = false; S.A = null; S.lastMove = null;
  await animateTo(ident(), ident(), 700);
  await setStage(1);
  freeze();
  S.onlyHi = true; $("onlyHi").checked = true; dirty = true;
  await moveCountryTo([15, 50]);
  await setStage(2);
  $("demo").disabled = false;
};

// ---------------- loop ----------------
function resize() {
  const r = bench.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix();
  dirty = true;
}
new ResizeObserver(resize).observe(bench);
new ResizeObserver(() => { dirty = true; }).observe(flat);
function frame() {
  if (dirty) { dirty = false; rebuild(); drawFlat(); updateReadout(); }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
setCountry("United States of America");
// example: the same two cities both ways
const fromUrl = linesFromHash(location.hash);  // a shared or bookmarked link
if (fromUrl) fromUrl.forEach(L => S.meas.push({ id: measId++, type: L.type, a: L.a, b: L.b }));
else S.meas.push({ id: measId++, type: "gc", a: [-71.06, 42.36], b: [37.62, 55.76] }, { id: measId++, type: "rh", a: [-71.06, 42.36], b: [37.62, 55.76] });
S.measVer++; renderMeasList();
placeCamera(); resize();
requestAnimationFrame(frame);

// hooks for tests
window.__lab = { S, M, hi: () => HI, globe: () => ({ opacity: globeMat.opacity, depthWrite: globeMat.depthWrite }),
  screenOf: p => { scene.updateMatrixWorld(); const v = new THREE.Vector3(...p).project(camera), r = cv.getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; }, idle: () => running === 0, freeze, moveCountryTo, bringCylinder, setStage, setCountry, animateTo, counts: () => Object.fromEntries(Object.entries(L).map(([k, o]) => [k, o.geometry.drawRange.count])) };
