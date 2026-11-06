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

if (typeof module !== "undefined") module.exports = { encodeLines, decodeLines, linesFromHash, linesHash };
