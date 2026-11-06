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

// ---- cylinders ----
// mode: "merc" (Mercator, not a real light source), "central" (light at the center), "lambert" (rays straight out from the axis)
function latMax(mode) { return mode === "central" ? deg(Math.atan(MAXH)) : mode === "lambert" ? 90 : MAXLAT; }
function cylH(mode, phi) {
  if (mode === "central") return Math.tan(phi);
  if (mode === "lambert") return Math.sin(phi);
  return psi(phi);
}
function cylLat(mode, h) {
  if (mode === "central") return Math.atan(h);
  if (mode === "lambert") return Math.asin(Math.max(-1, Math.min(1, h)));
  return 2 * Math.atan(Math.exp(h)) - Math.PI / 2;
}
// point on the unit cylinder (cylinder's own geo frame) for cylinder longitude θ and height h
function cylPoint(theta, h) { return [Math.cos(theta), Math.sin(theta), h]; }
// same point after unrolling onto the plane tangent at θ = 0
function flatPoint(theta, h) { return [1, theta, h]; }

// Moving a country: the rigid rotation taking q to t while keeping north pointing north at the moved point.
// Spin q onto the 0° meridian, slide it along that meridian to t's latitude, spin out to t's longitude.
function moveRotation(q, t) { return mmul(Rz(rad(t[0])), mmul(Ry(rad(t[1] - q[1])), Rz(rad(-q[0])))); }

if (typeof module !== 'undefined') module.exports = { MAXH, vec, lonlat, mmul, mT, mv, ident, Rz, Ry, Rx, d3R, euler, axisAngle, orthonormalize, toThree, fromThree, matToThree, matFromThree, latMax, cylH, cylLat, cylPoint, flatPoint, moveRotation };
