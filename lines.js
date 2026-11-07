// Routes in the address (#lines=gc:lon,lat,lon,lat;rh:...), so a view can be shared
// and each view can hand its routes to the other. Needs geo.js (clampCoord).
function encodeLines(lines) {
  return lines.map(function (L) {
    return L.type + ":" + [L.a[0], L.a[1], L.b[0], L.b[1]].map(function (v) { return +v.toFixed(4); }).join(",");
  }).join(";");
}
function decodeLines(s) {
  if (!s) return [];
  return s.split(";").map(function (part) {
    var m = /^(gc|rh):(.+)$/.exec(part);
    if (!m) return null;
    var v = m[2].split(",").map(Number);
    if (v.length !== 4 || v.some(function (x) { return !isFinite(x); })) return null;
    return { type: m[1], a: clampCoord([v[0], v[1]]), b: clampCoord([v[2], v[3]]) };
  }).filter(Boolean);
}
// null when the address carries no routes (so the view shows its examples)
function linesFromHash(hash) {
  var m = /(?:^#|&)lines=([^&]*)/.exec(hash || "");
  return m ? decodeLines(decodeURIComponent(m[1])) : null;
}
function linesHash(lines) { return "#lines=" + encodeLines(lines); }

// Routes (each drawn both ways) in the address: #routes=lon,lat,lon,lat;...
// Old #lines= links still open: their great-circle/rhumb pairs collapse to one route.
function encodeRoutes(routes) {
  return routes.map(function (r) { return [r.a[0], r.a[1], r.b[0], r.b[1]].map(function (v) { return +v.toFixed(4); }).join(","); }).join(";");
}
function routesHash(routes) { return "#routes=" + encodeRoutes(routes); }
function routesFromHash(hash) {
  var m = /(?:^#|&)routes=([^&]*)/.exec(hash || ""), list;
  if (m) {
    list = decodeURIComponent(m[1]).split(";").map(function (part) {
      var v = part.split(",").map(Number);
      if (v.length !== 4 || v.some(function (x) { return !isFinite(x); })) return null;
      return { a: clampCoord([v[0], v[1]]), b: clampCoord([v[2], v[3]]) };
    }).filter(Boolean);
  } else {
    var old = linesFromHash(hash);
    if (!old) return null;
    list = old.map(function (L) { return { a: L.a, b: L.b }; });
  }
  var key = function (r) { return [r.a, r.b].map(function (c) { return c.map(function (v) { return v.toFixed(3); }).join(","); }).sort().join("|"); };
  var seen = {};
  return list.filter(function (r) { var k = key(r); if (seen[k]) return false; seen[k] = 1; return true; });
}

if (typeof module !== "undefined") module.exports = { encodeLines, decodeLines, linesFromHash, linesHash, encodeRoutes, routesHash, routesFromHash };
