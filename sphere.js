// Rotation and cylinder math. Needs geo.js (rad, deg, psi, MAXLAT) loaded first.
// Frame: d3's geographic cartesian. x → (0°, 0°), y → (90°E, 0°), z → North Pole.
// three.js is y-up, so the pages map geo (x, y, z) → three (y, z, x). That's a cyclic
// permutation, so handedness and rotation directions are preserved.

var MAXH = psi(rad(MAXLAT)); // cylinder half-height in Earth radii (Mercator at 85.05°) ≈ 3.14

function vec(lon, lat) {
  var l = rad(lon), p = rad(lat);
  return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
}
function lonlat(v) {
  var z = Math.max(-1, Math.min(1, v[2] / Math.hypot(v[0], v[1], v[2])));
  return [deg(Math.atan2(v[1], v[0])), deg(Math.asin(z))];
}
function mmul(A, B) {
  var C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) C[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
  return C;
}
function mT(A) { return [[A[0][0], A[1][0], A[2][0]], [A[0][1], A[1][1], A[2][1]], [A[0][2], A[1][2], A[2][2]]]; }
function mv(A, v) {
  return [A[0][0] * v[0] + A[0][1] * v[1] + A[0][2] * v[2], A[1][0] * v[0] + A[1][1] * v[1] + A[1][2] * v[2], A[2][0] * v[0] + A[2][1] * v[1] + A[2][2] * v[2]];
}
function ident() { return [[1, 0, 0], [0, 1, 0], [0, 0, 1]]; }
function Rz(a) { var c = Math.cos(a), s = Math.sin(a); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; }
// Ry(δ) raises the latitude of a point on the 0° meridian by δ
function Ry(a) { var c = Math.cos(a), s = Math.sin(a); return [[c, 0, -s], [0, 1, 0], [s, 0, c]]; }
function Rx(a) { var c = Math.cos(a), s = Math.sin(a); return [[1, 0, 0], [0, c, -s], [0, s, c]]; }

// Same convention as d3.geoRotation([λ, φ, γ]) (degrees): spin λ about the pole, then φ, then γ.
function d3R(l, p, g) { return mmul(Rx(rad(g)), mmul(Ry(rad(p)), Rz(rad(l)))); }
function euler(M) {
  var s = Math.max(-1, Math.min(1, -M[0][2]));
  if (Math.abs(s) > 0.999999) { // gimbal lock: fold γ into λ
    return [deg(Math.atan2(M[1][0], M[1][1])), deg(Math.asin(s)), 0];
  }
  return [deg(Math.atan2(-M[0][1], M[0][0])), deg(Math.asin(s)), deg(Math.atan2(-M[1][2], M[2][2]))];
}

// rotation of `a` radians about unit axis `k` (Rodrigues)
function axisAngle(k, a) {
  var n = Math.hypot(k[0], k[1], k[2]), x = k[0] / n, y = k[1] / n, z = k[2] / n;
  var c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  return [[t * x * x + c, t * x * y - s * z, t * x * z + s * y],
          [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
          [t * x * z - s * y, t * y * z + s * x, t * z * z + c]];
}
// re-orthonormalize after many small drag rotations
function orthonormalize(M) {
  var a = [M[0][0], M[1][0], M[2][0]], b = [M[0][1], M[1][1], M[2][1]];
  var na = Math.hypot(a[0], a[1], a[2]); a = a.map(function (x) { return x / na; });
  var d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; b = [b[0] - d * a[0], b[1] - d * a[1], b[2] - d * a[2]];
  var nb = Math.hypot(b[0], b[1], b[2]); b = b.map(function (x) { return x / nb; });
  var c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return [[a[0], b[0], c[0]], [a[1], b[1], c[1]], [a[2], b[2], c[2]]];
}

// geo ↔ three.js frames
var PM = [[0, 1, 0], [0, 0, 1], [1, 0, 0]]; // three = PM · geo
function toThree(v) { return [v[1], v[2], v[0]]; }
function fromThree(t) { return [t[2], t[0], t[1]]; }
function matToThree(R) { return mmul(PM, mmul(R, mT(PM))); }
function matFromThree(R) { return mmul(mT(PM), mmul(R, PM)); }

// ---- the Mercator cylinder ----
// height on the cylinder for latitude φ (radians), and back
function cylH(phi) { return psi(phi); }
function cylLat(h) { return 2 * Math.atan(Math.exp(h)) - Math.PI / 2; }
// Where the cylinder touches the globe, given M (globe → cylinder frame). The cylinder's equator is that circle.
function touchLabel(M) {
  var ax = mv(mT(M), [0, 0, 1]);                         // cylinder axis in Earth coordinates
  var tilt = deg(Math.acos(Math.min(1, Math.abs(ax[2])))); // 0 = axis through the poles
  if (tilt < 0.5) return "Normal · touches the equator";
  if (tilt > 89.5) {
    var lon = wrapLon(deg(Math.atan2(ax[1], ax[0])) + 90);
    if (lon > 90) lon -= 180; else if (lon <= -90) lon += 180;
    var r = Math.round(lon);
    return "Transverse · touches the " + (r === 0 ? "0°" : Math.abs(r) + "°" + (r > 0 ? "E" : "W")) + " meridian";
  }
  return "Oblique " + Math.round(tilt) + "° · touches a tilted circle";
}
// The cylinder that touches the globe along the great circle through a and b (lon/lat), with the route's
// midpoint at the map's center and a → b running east. G is the globe's rotation. Its map draws the great
// circle as the straight center line.
function alongRoute(G, a, b) {
  var va = vec(a[0], a[1]), vb = vec(b[0], b[1]);
  var n = [va[1] * vb[2] - va[2] * vb[1], va[2] * vb[0] - va[0] * vb[2], va[0] * vb[1] - va[1] * vb[0]];
  var nn = Math.hypot(n[0], n[1], n[2]);
  if (nn < 1e-9) return null; // same or opposite points: no single great circle
  var m = [va[0] + vb[0], va[1] + vb[1], va[2] + vb[2]], mn = Math.hypot(m[0], m[1], m[2]);
  var x = mv(G, m.map(function (v) { return v / mn; })), z = mv(G, n.map(function (v) { return v / nn; }));
  var y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  return [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]];
}
// is this route on the cylinder's equator (within tol degrees)? M: globe → cylinder frame
function onCylEquator(M, a, b, tol) {
  return [a, b].every(function (c) { return Math.abs(lonlat(mv(M, vec(c[0], c[1])))[1]) < (tol || 0.5); });
}
// point on the unit cylinder (cylinder's own geo frame) for cylinder longitude θ and height h
function cylPoint(theta, h) { return [Math.cos(theta), Math.sin(theta), h]; }
// same point after unrolling onto the plane tangent at θ = 0
function flatPoint(theta, h) { return [1, theta, h]; }

if (typeof module !== 'undefined') module.exports = { MAXH, vec, lonlat, mmul, mT, mv, ident, Rz, Ry, Rx, d3R, euler, axisAngle, orthonormalize, toThree, fromThree, matToThree, matFromThree, cylH, cylLat, touchLabel, alongRoute, onCylEquator, cylPoint, flatPoint };
