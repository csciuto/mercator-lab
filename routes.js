// ---------- state ----------
let mode = "gc";
let lines = [];       // {id, type, a:[lon,lat], b:[lon,lat], an?, bn?}
let pending = null;   // {c:[lon,lat], name?}
let hover = null;
let hot = null;
let nextId = 1;
let showCities = true;
const add = (type, a, b, an, bn) => lines.push({ id: nextId++, type, a, b, an, bn });
// routes from the address (shared link, or handed over from Unroll the globe); otherwise examples showing the difference
const fromUrl = linesFromHash(location.hash);
if (fromUrl) fromUrl.forEach(L => add(L.type, L.a, L.b, cityAt(L.a, PLACES), cityAt(L.b, PLACES)));
else {
  add("gc", [-71.06, 42.36], [37.62, 55.76], "Boston", "Moscow");
  add("rh", [-71.06, 42.36], [37.62, 55.76], "Boston", "Moscow");
  add("gc", [-0.13, 51.51], [151.21, -33.87], "London", "Sydney");
}

// ---------- map ----------
const svg = d3.select("#map");
const land = topojson.feature(WORLD, WORLD.objects.countries);
const borders = topojson.mesh(WORLD, WORLD.objects.countries, (a, b) => a !== b);
const grat = d3.geoGraticule10();
const projection = d3.geoMercator().precision(0.3);
const path = d3.geoPath(projection);

const gBase = svg.append("g");
const sphereP = gBase.append("path").attr("class", "sphere");
const gratP = gBase.append("path").attr("class", "grat");
const landP = gBase.append("path").attr("class", "land");
const borderP = gBase.append("path").attr("class", "borders");
const gCities = svg.append("g").attr("id", "cities-layer");
const gLines = svg.append("g").attr("id", "lines-layer");
const gLabels = svg.append("g").attr("id", "labels-layer");
const gPts = svg.append("g").attr("id", "points-layer");

let W = 1, H = 1, baseScale = 1, tx = d3.zoomIdentity;
let visibleCities = [];

function size() {
  const r = svg.node().getBoundingClientRect();
  W = Math.max(1, r.width); H = Math.max(1, r.height);
  baseScale = W / (2 * Math.PI);  // world exactly one screen wide at zoom 1
}
// Horizontal pan is a rotation of the globe, so east-west never ends.
// d3.zoom model: screen = t.x + k*worldX, worldX = W/2 + baseScale*λ  →  rotation = (t.x + k*W/2 - W/2) / (k*W) of a turn
function applyProj() {
  const k = tx.k;
  projection
    .rotate([panToRotation(tx.x + k * W / 2 - W / 2, k * W), 0])
    .scale(baseScale * k)
    .translate([W / 2, tx.y + k * H / 2]);
}

const zoom = d3.zoom().scaleExtent([1, 60]).clickDistance(5)
  .on("zoom", e => { tx = e.transform; render(); });
svg.call(zoom).on("dblclick.zoom", null);

function constrain() {
  const ys = baseScale * psi(rad(MAXLAT));
  zoom.extent([[0, 0], [W, H]]).translateExtent([[-Infinity, H / 2 - ys], [Infinity, H / 2 + ys]]);
}

function geoFor(L) {
  if (L.type === "gc") return { type: "LineString", coordinates: [L.a, L.b] };
  return { type: "LineString", coordinates: rhumbPoints(L.a, L.b) };
}
function midAndAngle(L) {
  const P = projection(lineAt(L, 0.5)), A = projection(lineAt(L, 0.49)), B = projection(lineAt(L, 0.51));
  let ang = deg(Math.atan2(B[1] - A[1], B[0] - A[0]));
  if (Math.abs(B[0] - A[0]) > W / 2) ang = 0; // midpoint straddles the wrap seam
  if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
  return { P, ang };
}

function renderCities() {
  if (!showCities) { gCities.selectAll("g").remove(); visibleCities = []; return; }
  const k = tx.k, maxTier = k >= 4 ? 3 : k >= 2 ? 2 : 1;
  const cand = [];
  for (const [name, lat, lon, tier] of CITIES) {
    if (tier > maxTier) continue;
    const [x, y] = projection([lon, lat]);
    if (x < -40 || x > W + 40 || y < -20 || y > H + 20) continue;
    const w = name.length * 6.2 + 8;
    cand.push({ name, lat, lon, tier, x, y, x0: x + 4, x1: x + 4 + w, y0: y - 7, y1: y + 6 });
  }
  cand.sort((a, b) => a.tier - b.tier);
  visibleCities = placeLabels(cand);
  gCities.selectAll("g").data(visibleCities, d => d.name).join(
    enter => { const g = enter.append("g"); g.append("circle").attr("r", 2.2); g.append("text").attr("x", 5).attr("dy", "0.35em"); return g; }
  )
    .attr("class", d => `city t${d.tier}`)
    .attr("transform", d => `translate(${d.x},${d.y})`)
    .select("text").text(d => d.name);
}

function render() {
  applyProj();
  sphereP.attr("d", path({ type: "Sphere" }));
  gratP.attr("d", path(grat));
  landP.attr("d", path(land));
  borderP.attr("d", path(borders));
  renderCities();

  const prev = pending && hover ? [{ id: "prev", type: mode, a: pending.c, b: hover, preview: true }] : [];
  const drawn = lines.concat(prev);

  gLines.selectAll("path").data(drawn, d => d.id).join("path")
    .attr("class", d => `line ${d.type}${d.preview ? " preview" : ""}${d.id === hot ? " hot" : ""}`)
    .attr("d", d => path(geoFor(d)));

  gLabels.selectAll("text").data(drawn.filter(d => gcDist(d.a, d.b) > 1), d => d.id).join("text")
    .attr("class", d => `lbl ${d.type}`)
    .attr("text-anchor", "middle")
    .each(function (d) {
      const { P, ang } = midAndAngle(d);
      d3.select(this).attr("transform", `translate(${P[0]},${P[1]}) rotate(${ang}) translate(0,-8)`).text(distLabel(lineDist(d)));
    });

  const pts = [];
  lines.forEach(L => { pts.push({ L, k: "a" }); pts.push({ L, k: "b" }); });
  if (pending) pts.push({ L: { id: "pend", type: mode }, k: "p", c: pending.c });
  gPts.selectAll("circle").data(pts, d => d.L.id + d.k).join("circle")
    .attr("class", d => `pt ${d.L.type}`)
    .attr("r", d => d.k === "p" ? 6 : 5)
    .attr("cx", d => projection(d.c || d.L[d.k])[0])
    .attr("cy", d => projection(d.c || d.L[d.k])[1])
    .call(drag);
}

// click → coordinate, snapping to a visible city within 10px
function pick(px, py) {
  const city = nearest(visibleCities, px, py, 10);
  if (city) return { c: [city.lon, city.lat], name: city.name };
  return { c: clampCoord(projection.invert([px, py])) };
}

const drag = d3.drag()
  .filter(e => !e.button)
  .subject((e, d) => d)
  .on("start", e => { e.sourceEvent.stopPropagation(); hot = e.subject.L.id; })
  .on("drag", (e, d) => {
    if (d.k === "p") return;
    const p = pick(e.x, e.y);
    d.L[d.k] = p.c; d.L[d.k + "n"] = p.name;
    render(); renderList();
  })
  .on("end", () => { hot = null; render(); });

svg.on("click", e => {
  let p;
  if (e.target.classList.contains("pt")) {
    // clicking an existing endpoint starts or finishes a line exactly there
    const d = d3.select(e.target).datum();
    if (d.k === "p") return;
    p = { c: d.L[d.k].slice(), name: d.L[d.k + "n"] };
  } else {
    const [x, y] = d3.pointer(e);
    p = pick(x, y);
  }
  addPoint(p);
});
svg.on("pointermove", e => {
  const [x, y] = d3.pointer(e);
  const c = clampCoord(projection.invert([x, y]));
  document.getElementById("status").textContent = fmtLL(c);
  if (pending) { hover = c; render(); }
});

// a point from a click or the search box: the first starts a line, the second finishes it
function addPoint(p) {
  if (!pending) { pending = p; hover = p.c; }
  else {
    if (gcDist(pending.c, p.c) > 0.5) add(mode, pending.c, p.c, pending.name, p.name);
    pending = null; hover = null; renderList();
  }
  render();
}

// ---------- search: a city or typed coordinates ----------
const q = document.getElementById("q"), qList = document.getElementById("q-results");
let qItems = [], qSel = 0;
function showResults() {
  const c = parseCoord(q.value);
  qItems = (c ? [{ c, label: fmtLL(c), where: "" }] : [])
    .concat(searchPlaces(PLACES, q.value, 8).map(([name, where, lat, lon]) => ({ c: [lon, lat], name, label: name, where })));
  qSel = 0;
  qList.innerHTML = "";
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
  const it = qItems[i];
  if (!it) return;
  q.value = ""; qList.hidden = true; qItems = [];
  // bring the point into view if it's off screen
  const [x, y] = projection(it.c);
  if (x < 40 || x > W - 40 || y < 40 || y > H - 40) svg.transition().duration(500).call(zoom.translateBy, (W / 2 - x) / tx.k, (H / 2 - y) / tx.k);
  addPoint({ c: it.c, name: it.name });
}
q.addEventListener("input", showResults);
q.addEventListener("keydown", e => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    qSel = (qSel + (e.key === "ArrowDown" ? 1 : -1) + qItems.length) % Math.max(1, qItems.length);
    [...qList.children].forEach((li, i) => li.setAttribute("aria-selected", i === qSel));
  } else if (e.key === "Enter") { e.preventDefault(); choose(qSel); }
  else if (e.key === "Escape") { q.value = ""; qList.hidden = true; }
});
q.addEventListener("blur", () => { qList.hidden = true; });

// ---------- list ----------
function syncAddress() {
  const h = linesHash(lines);
  history.replaceState(null, "", h);
  document.getElementById("to-other").href = "unroll/" + h;
}

function renderList() {
  syncAddress();
  const ul = d3.select("#list");
  document.getElementById("count").textContent = `Lines (${lines.length})`;
  ul.selectAll("li").remove();
  if (!lines.length) { ul.append("li").attr("class", "empty").style("display", "block").style("border", "0").text("No lines yet. Click the map to start one."); return; }
  lines.forEach(L => {
    const km = lineDist(L), brg = lineBearing(L);
    const li = ul.append("li").attr("class", L.type)
      .on("mouseenter", () => { hot = L.id; render(); })
      .on("mouseleave", () => { hot = null; render(); });
    li.append("span").attr("class", "bar");
    const from = L.an || fmtLL(L.a), to = L.bn || fmtLL(L.b);
    li.append("div").attr("class", "meta").html(
      `<b>${L.type === "gc" ? "Great circle" : "Rhumb line"}</b><br>` +
      `${fmtNum(km * KM_MI, km)} mi · ${fmtNum(km, km)} km · ${fmtNum(km * KM_NM, km)} nmi<br>` +
      `<span class="c"></span>` + (extraLabel(lines, L) ? `<br><span class="extra"></span>` : ""));
    li.select(".extra").text(extraLabel(lines, L));
    li.select(".c").text(`${from} → ${to} · ${L.type === "gc" ? "initial course" : "constant course"} ${brg.toFixed(1)}°`);
    li.append("button").attr("class", "x").attr("aria-label", "Remove line").text("×")
      .on("click", () => { lines = lines.filter(x => x !== L); hot = null; renderList(); render(); });
  });
}

function setMode(m) {
  mode = m;
  document.getElementById("m-gc").setAttribute("aria-pressed", m === "gc");
  document.getElementById("m-rh").setAttribute("aria-pressed", m === "rh");
  render();
}
document.getElementById("m-gc").onclick = () => setMode("gc");
document.getElementById("m-rh").onclick = () => setMode("rh");
document.getElementById("clear").onclick = () => { lines = []; pending = null; renderList(); render(); };
document.getElementById("undo").onclick = () => { lines.pop(); renderList(); render(); };
document.getElementById("pair").onclick = () => {
  const key = L => `${L.a}|${L.b}`;
  const have = new Set(lines.map(L => L.type + key(L)));
  lines.slice().forEach(L => { const o = L.type === "gc" ? "rh" : "gc"; if (!have.has(o + key(L))) { add(o, L.a.slice(), L.b.slice(), L.an, L.bn); have.add(o + key(L)); } });
  renderList(); render();
};
document.getElementById("reset").onclick = () => svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity);
document.getElementById("showcities").onchange = e => { showCities = e.target.checked; render(); };
window.addEventListener("keydown", e => {
  if (e.target.tagName === "INPUT" && e.target.type !== "checkbox") return;
  if (e.key === "g" || e.key === "G") setMode("gc");
  else if (e.key === "r" || e.key === "R") setMode("rh");
  else if (e.key === "Escape") { pending = null; hover = null; render(); }
  else if (e.key === "Backspace" || e.key === "Delete") { lines.pop(); renderList(); render(); }
});

// ---------- panel: float / dock / collapse ----------
const panel = document.getElementById("panel");
let pstate = { dock: "float", min: false, x: 16, y: 16 };
try { Object.assign(pstate, JSON.parse(localStorage.getItem("rgc-panel") || "{}")); } catch (_) {}
function savePanel() { try { localStorage.setItem("rgc-panel", JSON.stringify(pstate)); } catch (_) {} }
function clampPanel() {
  const wr = document.getElementById("wrap").getBoundingClientRect();
  pstate.x = Math.max(0, Math.min(pstate.x, wr.width - 120));
  pstate.y = Math.max(0, Math.min(pstate.y, wr.height - 44));
}
function applyPanel() {
  panel.classList.toggle("docked", pstate.dock !== "float");
  panel.classList.toggle("left", pstate.dock === "left");
  panel.classList.toggle("right", pstate.dock === "right");
  panel.classList.toggle("min", pstate.min);
  if (pstate.dock === "float") { clampPanel(); panel.style.left = pstate.x + "px"; panel.style.top = pstate.y + "px"; }
  else { panel.style.left = ""; panel.style.top = ""; }
  for (const d of ["left", "float", "right"]) document.getElementById("dock-" + d).setAttribute("aria-pressed", pstate.dock === d);
  document.getElementById("minimize").setAttribute("aria-expanded", !pstate.min);
  document.getElementById("minimize").title = pstate.min ? "Expand" : "Collapse";
  document.getElementById("minico").setAttribute("points", pstate.min ? "4,6 8,10 12,6" : "4,10 8,6 12,10");
  savePanel();
}
for (const d of ["left", "float", "right"]) document.getElementById("dock-" + d).onclick = () => { pstate.dock = d; applyPanel(); };
document.getElementById("minimize").onclick = () => { pstate.min = !pstate.min; applyPanel(); };
// drag the header to float the panel anywhere
const head = document.getElementById("head");
head.addEventListener("pointerdown", e => {
  if (e.target.closest("button") || window.matchMedia("(max-width: 640px)").matches || pstate.dock !== "float") return;
  const r = panel.getBoundingClientRect(), wr = document.getElementById("wrap").getBoundingClientRect();
  const ox = e.clientX - r.left, oy = e.clientY - r.top;
  head.setPointerCapture(e.pointerId);
  const move = ev => { pstate.x = ev.clientX - wr.left - ox; pstate.y = ev.clientY - wr.top - oy; applyPanel(); };
  const up = () => { head.removeEventListener("pointermove", move); head.removeEventListener("pointerup", up); };
  head.addEventListener("pointermove", move); head.addEventListener("pointerup", up);
});

// ---------- boot ----------
function relayout() {
  const oldW = W;
  size(); constrain();
  if (oldW > 1 && oldW !== W) {  // keep the same longitude centered when the map width changes
    const rot = projection.rotate()[0];
    tx = d3.zoomIdentity.translate(rot / 360 * tx.k * W + W / 2 - tx.k * W / 2, tx.y).scale(tx.k);
    svg.call(zoom.transform, tx);
  }
  render();
}
new ResizeObserver(relayout).observe(document.getElementById("mapbox"));
applyPanel();
size(); constrain(); render(); renderList();
