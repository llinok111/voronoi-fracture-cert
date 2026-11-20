// Baseline A: float64 sequential half-space clipping with an absolute EPS.
// This is how most real-time engines carve convex shards. It is not a strawman:
// the algorithm is the same idea as the exact one, just with rounded coordinates.
export const EPS = 1e-9;

const dot = (n, p) => n[0] * p[0] + n[1] * p[1] + n[2] * p[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function clipPoly(poly, plane) {
  const out = [];
  const d = poly.map((p) => dot(plane.n, p) - plane.d);
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    const di = d[i], dj = d[j];
    if (di <= EPS) out.push(poly[i]);
    if ((di > EPS && dj < -EPS) || (di < -EPS && dj > EPS)) {
      const t = di / (di - dj);
      out.push([poly[i][0] + t * (poly[j][0] - poly[i][0]),
        poly[i][1] + t * (poly[j][1] - poly[i][1]),
        poly[i][2] + t * (poly[j][2] - poly[i][2])]);
    }
  }
  return out;
}

function vol(faces) {
  let v = 0;
  for (const f of faces) {
    for (let i = 1; i + 1 < f.length; i++) {
      v += dot(f[0], cross(f[i], f[i + 1])) / 6;
    }
  }
  return v;
}

function audit(faces) {
  const map = new Map();
  const key = (p) => p.map((x) => (Math.round(x * 1e12) / 1e12).toFixed(12)).join(',');
  for (const f of faces) {
    for (let i = 0; i < f.length; i++) {
      const a = key(f[i]), b = key(f[(i + 1) % f.length]);
      const k = a < b ? a + '|' + b : b + '|' + a;
      const rec = map.get(k) || { f: 0, r: 0 };
      if (a < b) rec.f++; else rec.r++;
      map.set(k, rec);
    }
  }
  let paired = 0, bad = 0;
  for (const r of map.values()) {
    if (r.f === 1 && r.r === 1) paired++;
    else bad++;
  }
  return { paired, bad, undirected: map.size };
}

/** Clip the unit box (scaled by S) by bisectors for each seed. */
export function floatFracture({ seeds, S }) {
  const pts = seeds.map((p) => p.map((c) => c * S));
  const cells = [];
  for (let i = 0; i < pts.length; i++) {
    let faces = [
      [[0, 0, 0], [0, 0, S], [0, S, S], [0, S, 0]],
      [[S, 0, 0], [S, S, 0], [S, S, S], [S, 0, S]],
      [[0, 0, 0], [S, 0, 0], [S, 0, S], [0, 0, S]],
      [[0, S, 0], [0, S, S], [S, S, S], [S, S, 0]],
      [[0, 0, 0], [0, S, 0], [S, S, 0], [S, 0, 0]],
      [[0, 0, S], [S, 0, S], [S, S, S], [0, S, S]],
    ];
    for (let j = 0; j < pts.length; j++) {
      if (i === j) continue;
      const n = sub(pts[j], pts[i]);
      const d = (dot(pts[j], pts[j]) - dot(pts[i], pts[i])) / 2;
      const plane = { n, d };
      const next = [];
      let cut = [];
      for (const f of faces) {
        const c = clipPoly(f, plane);
        if (c.length >= 3) next.push(c);
        for (const p of c) if (Math.abs(dot(plane.n, p) - d) <= 1e-7 * Math.max(1, S)) cut.push(p);
      }
      if (cut.length >= 3) {
        const c = cut.reduce((a, p) => [a[0] + p[0] / cut.length, a[1] + p[1] / cut.length, a[2] + p[2] / cut.length], [0, 0, 0]);
        let u = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
        const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
        const un = cr(n, u); u = cr(un, n);
        cut.sort((a, b) => Math.atan2(dot(sub(a, c), u), dot(sub(a, c), un)) - Math.atan2(dot(sub(b, c), u), dot(sub(b, c), un)));
        const dedup = cut.filter((p, k) => k === 0 || Math.hypot(...sub(p, cut[k - 1])) > 1e-9 * Math.max(1, S));
        if (dedup.length >= 3) next.push(dedup);
      }
      faces = next;
    }
    const v = vol(faces);
    cells.push({ seed: pts[i], volume: v, faces: faces.length, watertight: audit(faces) });
  }
  const total = cells.reduce((s, c) => s + c.volume, 0);
  const boxVolume = S * S * S;
  const paired = cells.reduce((s, c) => s + c.watertight.paired, 0);
  const bad = cells.reduce((s, c) => s + c.watertight.bad, 0);
  return { cells, total, boxVolume, relError: (total - boxVolume) / boxVolume, paired, bad };
}
