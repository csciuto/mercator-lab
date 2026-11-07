// Mercator Lab: the wall map in the side panel (the cylinder unrolled, drawn in 2D), and clicks on it.
// Shares the page's globals with app.js, which loads first.
// ---------------- drawing ----------------
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

  // cylinder equator, center line, seam edges
  g.strokeStyle = COL.cyl; g.lineWidth = 1.4; g.beginPath(); g.moveTo(0, FH / 2); g.lineTo(FW, FH / 2); g.moveTo(FW / 2, 0); g.lineTo(FW / 2, FH); g.stroke();
  g.strokeStyle = COL.seam; g.setLineDash([5, 4]); g.lineWidth = 1.5; g.strokeRect(0.75, -2, FW - 1.5, FH + 4); g.setLineDash([]);

  if (S.armed && hoverFlat) {
    g.strokeStyle = COL.b; g.lineWidth = 1.5; g.beginPath(); g.arc(hoverFlat[0], hoverFlat[1], 7, 0, 2 * Math.PI); g.moveTo(hoverFlat[0] - 11, hoverFlat[1]); g.lineTo(hoverFlat[0] + 11, hoverFlat[1]); g.moveTo(hoverFlat[0], hoverFlat[1] - 11); g.lineTo(hoverFlat[0], hoverFlat[1] + 11); g.stroke();
  }
}

// ---------------- input ----------------
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
new ResizeObserver(() => { dirty = true; }).observe(flat);
