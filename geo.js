// Pure geodesy and formatting. No DOM, no d3: unit-tested in Node (tests/geo.test.js).
var R_KM = 6371.0088, KM_MI = 0.621371, KM_NM = 1 / 1.852, MAXLAT = 85.05113;
function rad(d) { return d * Math.PI / 180; }
function deg(r) { return r * 180 / Math.PI; }
function wrapRad(x) { x = (x + Math.PI) % (2 * Math.PI); if (x < 0) x += 2 * Math.PI; return x - Math.PI; }
function wrapLon(l) { l = (l + 180) % 360; if (l < 0) l += 360; return l - 180; }
function psi(phi) { return Math.log(Math.tan(Math.PI / 4 + phi / 2)); }
function gcDist(a, b) {
  var p1 = rad(a[1]), p2 = rad(b[1]), dp = p2 - p1, dl = rad(b[0] - a[0]);
  var h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
function gcBearing(a, b) {
  var p1 = rad(a[1]), p2 = rad(b[1]), dl = rad(b[0] - a[0]);
  var y = Math.sin(dl) * Math.cos(p2);
  var x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
function gcInterp(a, b, t) {
  var p1 = rad(a[1]), l1 = rad(a[0]), p2 = rad(b[1]), l2 = rad(b[0]);
  var d = gcDist(a, b) / R_KM;
  if (d < 1e-12) return a.slice();
  var A = Math.sin((1 - t) * d) / Math.sin(d), B = Math.sin(t * d) / Math.sin(d);
  var x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
  var y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
  var z = A * Math.sin(p1) + B * Math.sin(p2);
  return [deg(Math.atan2(y, x)), deg(Math.atan2(z, Math.hypot(x, y)))];
}
function rhumb(a, b) {
  var p1 = rad(a[1]), p2 = rad(b[1]), dp = p2 - p1;
  var dl = wrapRad(rad(b[0] - a[0]));
  var dpsi = psi(p2) - psi(p1);
  var q = Math.abs(dpsi) > 1e-12 ? dp / dpsi : Math.cos(p1);
  return {
    d: Math.sqrt(dp * dp + q * q * dl * dl) * R_KM,
    brg: (deg(Math.atan2(dl, dpsi)) + 360) % 360,
    dl: dl, dpsi: dpsi, psi1: psi(p1)
  };
}
function rhumbAt(a, b, t, r) {
  r = r || rhumb(a, b);
  var lam = wrapRad(rad(a[0]) + t * r.dl);
  var phi = 2 * Math.atan(Math.exp(r.psi1 + t * r.dpsi)) - Math.PI / 2;
  return [deg(lam), deg(phi)];
}
function rhumbPoints(a, b, n) {
  n = n || 160; var r = rhumb(a, b), out = [];
  for (var i = 0; i <= n; i++) out.push(rhumbAt(a, b, i / n, r));
  return out;
}
function lineDist(L) { return L.type === "gc" ? gcDist(L.a, L.b) : rhumb(L.a, L.b).d; }
function lineBearing(L) { return L.type === "gc" ? gcBearing(L.a, L.b) : rhumb(L.a, L.b).brg; }
function lineAt(L, t) { return L.type === "gc" ? gcInterp(L.a, L.b, t) : rhumbAt(L.a, L.b, t); }
function fmtNum(x, km) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: km < 100 ? 1 : 0 }).format(x);
}
function distLabel(km) { return fmtNum(km * KM_MI, km) + " mi · " + fmtNum(km, km) + " km"; }
function fmtLL(c) {
  var lon = c[0], lat = c[1];
  return Math.abs(lat).toFixed(2) + "°" + (lat >= 0 ? "N" : "S") + " " + Math.abs(lon).toFixed(2) + "°" + (lon >= 0 ? "E" : "W");
}
function clampCoord(c) { return [wrapLon(c[0]), Math.max(-MAXLAT, Math.min(MAXLAT, c[1]))]; }
// horizontal pan offset (screen px) -> longitude rotation (deg) for a world `worldPx` wide
function panToRotation(px, worldPx) { return wrapLon(px / worldPx * 360); }
// nearest item within `radius` px; items have {x, y}
function nearest(items, x, y, radius) {
  var best = null, bd = radius * radius;
  for (var i = 0; i < items.length; i++) {
    var dx = items[i].x - x, dy = items[i].y - y, d = dx * dx + dy * dy;
    if (d <= bd) { bd = d; best = items[i]; }
  }
  return best;
}
// greedy label placement: keep boxes that don't overlap ones already kept
function placeLabels(items) {
  var kept = [];
  items.forEach(function (it) {
    var hit = kept.some(function (k) { return it.x0 < k.x1 && it.x1 > k.x0 && it.y0 < k.y1 && it.y1 > k.y0; });
    if (!hit) kept.push(it);
  });
  return kept;
}

// ---- typed points: "42.36, -71.06", "42.36N 71.06W", "42°21′36″N 71°3′W" → [lon, lat], or null
function parseHalf(t) {
  var m = /^(-?\d+(?:\.\d+)?)\s*°?\s*(?:(\d+(?:\.\d+)?)\s*['′’]?\s*)?(?:(\d+(?:\.\d+)?)\s*["″”]?\s*)?([NSEW])?$/.exec(t.trim());
  if (!m) return null;
  var v = Math.abs(+m[1]) + (+(m[2] || 0)) / 60 + (+(m[3] || 0)) / 3600;
  if (m[1][0] === "-" || m[4] === "S" || m[4] === "W") v = -v;
  return { v: v, h: m[4] || "" };
}
function parseCoord(s) {
  s = String(s).toUpperCase().trim();
  var halves;
  if (s.indexOf(",") >= 0) halves = s.split(",");
  else if (/[NS]/.test(s) && /[EW]/.test(s)) halves = s.split(/(?<=[NSEW])\s*/).filter(Boolean);
  else halves = s.split(/\s+/);
  if (halves.length !== 2) return null;
  var a = parseHalf(halves[0]), b = parseHalf(halves[1]);
  if (!a || !b) return null;
  var lat = a, lon = b;
  if (/[EW]/.test(a.h) || /[NS]/.test(b.h)) { lat = b; lon = a; }       // longitude written first
  if (/[EW]/.test(lat.h) || /[NS]/.test(lon.h)) return null;
  if (Math.abs(lat.v) > 90 || Math.abs(lon.v) > 180) return null;
  return [lon.v, lat.v];
}

// ---- search: places are [name, where, lat, lon], largest first. Name starts first, then name contains.
function fold(s) { return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
function searchPlaces(places, q, n) {
  q = fold(q.trim()); n = n || 8;
  if (!q) return [];
  var starts = [], contains = [];
  for (var i = 0; i < places.length && starts.length < n; i++) {
    var f = fold(places[i][0]);
    if (f.indexOf(q) === 0) starts.push(places[i]);
    else if (contains.length < n && f.indexOf(q) > 0) contains.push(places[i]);
  }
  return starts.concat(contains).slice(0, n);
}

// the closest place within maxKm of c ([name, where, lat, lon] rows), or null
function nearestPlace(places, c, maxKm) {
  var best = null, bd = maxKm;
  for (var i = 0; i < places.length; i++) {
    var p = places[i];
    if (Math.abs(p[2] - c[1]) > 2) continue; // cheap latitude filter: 2° ≈ 220 km
    var d = gcDist(c, [p[3], p[2]]);
    if (d <= bd) { bd = d; best = p; }
  }
  return best;
}
// both distances for a route, and how much longer the rhumb line is (percent of the great circle)
function routeStats(a, b) {
  var g = gcDist(a, b), r = rhumb(a, b).d;
  return { gc: g, rh: r, extraPct: g > 0.05 ? (r - g) / g * 100 : 0 };
}

if (typeof module !== 'undefined') module.exports = { routeStats, nearestPlace, parseCoord, searchPlaces, R_KM, KM_MI, KM_NM, MAXLAT, rad, deg, wrapRad, wrapLon, psi, gcDist, gcBearing, gcInterp, rhumb, rhumbAt, rhumbPoints, lineDist, lineBearing, lineAt, fmtNum, distLabel, fmtLL, clampCoord, panToRotation, nearest, placeLabels };
