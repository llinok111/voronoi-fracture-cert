// Exact rational Voronoi fracture core.
// Pure ES module: no three.js, no DOM, no I/O, no environment access.
// Every coordinate is an exact BigInt fraction; nothing here rounds.
// Inside a convex polyhedron: n . x <= d for every defining plane.

const B = BigInt;
const abs = (x) => (x < 0n ? -x : x);

function gcd(a, b) {
  a = abs(a); b = abs(b);
  while (b) { const t = a % b; a = b; b = t; }
  return a;
}

export class Frac {
  constructor(n, d = 1n) {
    n = B(n); d = B(d);
    if (d === 0n) throw new Error('zero denominator');
    if (d < 0n) { n = -n; d = -d; }
    const g = gcd(n, d);
    if (g > 1n) { n /= g; d /= g; }
    this.n = n; this.d = d;
  }
  static of(x) { return x instanceof Frac ? x : new Frac(x, 1n); }
  add(o) { o = Frac.of(o); return new Frac(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o) { o = Frac.of(o); return new Frac(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o) { o = Frac.of(o); return new Frac(this.n * o.n, this.d * o.d); }
  div(o) { o = Frac.of(o); return new Frac(this.n * o.d, this.d * o.n); }
  neg() { return new Frac(-this.n, this.d); }
  cmp(o) { o = Frac.of(o); const l = this.n * o.d, r = o.n * this.d; return l < r ? -1 : l > r ? 1 : 0; }
  eq(o) { return this.cmp(o) === 0; }
  isZero() { return this.n === 0n; }
  sign() { return this.n === 0n ? 0 : this.n > 0n ? 1 : -1; }
  toNumber() {
    if (this.n === 0n) return 0;
    const neg = this.n < 0n; const n = abs(this.n);
    // exact-ish conversion with 40 significant bits, good enough for display only
    const shift = 40n - BigInt(n.toString(2).length) + BigInt(this.d.toString(2).length);
    let q = shift >= 0n ? (n << shift) / this.d : n / (this.d << -shift);
    const v = Number(q) * Math.pow(2, -Number(shift));
    return neg ? -v : v;
  }
  key() { return this.n.toString() + '/' + this.d.toString(); }
  toString() { return this.d === 1n ? this.n.toString() : this.n.toString() + '/' + this.d.toString(); }
}

const V = {
  sub: (a, b) => [a[0].sub(b[0]), a[1].sub(b[1]), a[2].sub(b[2])],
  add: (a, b) => [a[0].add(b[0]), a[1].add(b[1]), a[2].add(b[2])],
  mul: (a, s) => [a[0].mul(s), a[1].mul(s), a[2].mul(s)],
  dot: (a, b) => a[0].mul(b[0]).add(a[1].mul(b[1])).add(a[2].mul(b[2])),
  cross: (a, b) => [
    a[1].mul(b[2]).sub(a[2].mul(b[1])),
    a[2].mul(b[0]).sub(a[0].mul(b[2])),
    a[0].mul(b[1]).sub(a[1].mul(b[0])),
  ],
  eq: (a, b) => a[0].eq(b[0]) && a[1].eq(b[1]) && a[2].eq(b[2]),
  key: (a) => a[0].key() + '|' + a[1].key() + '|' + a[2].key(),
  scaled: (a, s) => V.mul(a, Frac.of(s)),
};

const det3 = (a, b, c) => V.dot(a, V.cross(b, c));

/** Solve the 3x3 system rows[i] . x = rhs[i] by Cramer's rule, exactly. */
export function solve3(rows, rhs) {
  const [a1, a2, a3] = rows;
  const D = det3(a1, a2, a3);
  if (D.isZero()) return null;
  // Cramer via vector triple products: x = (b1 (a2 x a3) + b2 (a3 x a1) + b3 (a1 x a2)) / D
  const num = V.add(
    V.add(V.mul(V.cross(a2, a3), rhs[0]), V.mul(V.cross(a3, a1), rhs[1])),
    V.mul(V.cross(a1, a2), rhs[2]),
  );
  return V.mul(num, new Frac(1n).div(D));
}

const inside = (p, x) => V.dot(p.n, x).cmp(p.d) <= 0;
const onPlane = (p, x) => V.dot(p.n, x).cmp(p.d) === 0;

/** Box [0,S]^3 as six outward normal planes: n.x <= d. */
export function boxPlanes(S) {
  const z = new Frac(0n), one = new Frac(1n);
  return [
    { n: [new Frac(-1n), z, z], d: z },
    { n: [one, z, z], d: S },
    { n: [z, new Frac(-1n), z], d: z },
    { n: [z, one, z], d: S },
    { n: [z, z, new Frac(-1n)], d: z },
    { n: [z, z, one], d: S },
  ];
}

/** Bisector plane between seeds p and q, keeping the p side. */
export function bisector(p, q) {
  const n = V.sub(q, p);
  const d = V.dot(q, q).sub(V.dot(p, p)).div(new Frac(2n));
  return { n, d };
}

/**
 * Vertex enumeration: every vertex of {n_i.x <= d_i} is the intersection of
 * three of its planes. Exact, no epsilon, no iterative clipping.
 */
export function enumerateVertices(planes) {
  const verts = [];
  const seen = new Map();
  const m = planes.length;
  for (let i = 0; i < m - 2; i++) {
    for (let j = i + 1; j < m - 1; j++) {
      for (let k = j + 1; k < m; k++) {
        const x = solve3([planes[i].n, planes[j].n, planes[k].n],
          [planes[i].d, planes[j].d, planes[k].d]);
        if (!x) continue;
        let ok = true;
        for (let t = 0; t < m; t++) { if (!inside(planes[t], x)) { ok = false; break; } }
        if (!ok) continue;
        const key = V.key(x);
        if (seen.has(key)) continue;
        seen.set(key, verts.length);
        verts.push(x);
      }
    }
  }
  return verts;
}

/** Order coplanar vertices counter-clockwise as seen from outside (+n). */
export function orderFace(verts, plane) {
  const n = plane.n;
  const c = verts.reduce((acc, v) => V.add(acc, v), [new Frac(0n), new Frac(0n), new Frac(0n)]);
  const centroid = V.mul(c, new Frac(1n, BigInt(verts.length)));
  const ax = abs(n[0].toNumber()) <= abs(n[1].toNumber()) && abs(n[0].toNumber()) <= abs(n[2].toNumber())
    ? [new Frac(1n), new Frac(0n), new Frac(0n)]
    : abs(n[1].toNumber()) <= abs(n[2].toNumber())
      ? [new Frac(0n), new Frac(1n), new Frac(0n)]
      : [new Frac(0n), new Frac(0n), new Frac(1n)];
  let u = V.cross(n, ax);
  // cross(u, w) points along +n when w = cross(n, u)
  const w = V.cross(n, u);
  const rel = verts.map((v) => V.sub(v, centroid));
  const ab = rel.map((r) => [V.dot(r, u), V.dot(r, w)]);
  const idx = verts.map((_, i) => i);
  idx.sort((i, j) => {
    const [ai, bi] = ab[i], [aj, bj] = ab[j];
    const hi = (bi.sign() > 0 || (bi.isZero() && ai.sign() > 0)) ? 0 : 1;
    const hj = (bj.sign() > 0 || (bj.isZero() && aj.sign() > 0)) ? 0 : 1;
    if (hi !== hj) return hi - hj;
    const cr = ai.mul(bj).sub(bi.mul(aj));
    if (cr.sign() !== 0) return cr.sign() > 0 ? -1 : 1;
    return 0;
  });
  return idx.map((i) => verts[i]);
}

/** Build faces + exact volume for one convex cell given its planes. */
export function buildCell(planes) {
  const verts = enumerateVertices(planes);
  const faces = [];
  for (const p of planes) {
    const idx = [];
    for (let i = 0; i < verts.length; i++) if (onPlane(p, verts[i])) idx.push(i);
    if (idx.length < 3) continue;
    const poly = orderFace(idx.map((i) => verts[i]), p);
    // exact convexity of the polygon: all consecutive cross products agree with +n
    let convex = true;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], c = poly[(i + 2) % poly.length];
      const cr = V.cross(V.sub(b, a), V.sub(c, b));
      if (cr[0].isZero() && cr[1].isZero() && cr[2].isZero()) continue; // collinear
      if (V.dot(cr, p.n).sign() < 0) { convex = false; break; }
    }
    faces.push({ plane: p, verts: poly, ids: poly.map((v) => verts.findIndex((x) => x === v)), convex });
  }
  // Divergence theorem, exact: V = 1/6 * sum_faces sum_fan a . (b x c)
  let vol = new Frac(0n);
  for (const f of faces) {
    const v = f.verts;
    for (let i = 1; i + 1 < v.length; i++) {
      vol = vol.add(V.dot(v[0], V.cross(v[i], v[i + 1])).div(new Frac(6n)));
    }
  }
  const vkeys = new Map();
  verts.forEach((v, i) => vkeys.set(V.key(v), i));
  const facesOut = faces.map((f) => ({ plane: f.plane, verts: f.verts, ids: vkeys, convex: f.convex }));
  return {
    vertices: verts,
    faces: facesOut.map((f) => ({ ids: f.verts.map((v) => vkeys.get(V.key(v))), convex: f.convex })),
    planeCount: planes.length,
    volume: vol,
  };
}

/** Exact watertight audit: every undirected edge must appear exactly twice, opposite directions. */
export function auditWatertight(cell) {
  const directed = new Map();
  const keyOf = (i) => i;
  let edges = 0;
  for (const f of cell.faces) {
    const n = f.ids.length;
    for (let i = 0; i < n; i++) {
      const a = keyOf(f.ids[i]), b = keyOf(f.ids[(i + 1) % n]);
      edges++;
      const k = a < b ? a + '-' + b : b + '-' + a;
      const rec = directed.get(k) || { fwd: 0, rev: 0 };
      if (a < b) rec.fwd++; else rec.rev++;
      directed.set(k, rec);
    }
  }
  let twice = 0, bad = 0, unpaired = 0;
  for (const rec of directed.values()) {
    const total = rec.fwd + rec.rev;
    if (total === 2 && rec.fwd === 1 && rec.rev === 1) twice++;
    else if (total === 1) unpaired++;
    else bad++;
  }
  return { halfEdges: edges, undirected: directed.size, paired: twice, bad, unpaired };
}

/** Point membership in a cell (exact, using the cell's original planes). */
export function containsPoint(planes, x) {
  for (const p of planes) if (!inside(p, x)) return false;
  return true;
}

/**
 * Compute the Voronoi fracture of a box for the given unit-cube seeds.
 * seeds: array of [x,y,z] rationals/numbers in [0,1]; S: exact box edge length.
 */
export function fracture({ seeds, S }) {
  const Sf = Frac.of(S);
  const pts = seeds.map((s) => s.map((c) => Frac.of(c).mul(Sf)));
  const bp = boxPlanes(Sf);
  const cells = [];
  for (let i = 0; i < pts.length; i++) {
    const planes = bp.slice();
    for (let j = 0; j < pts.length; j++) {
      if (i !== j) planes.push(bisector(pts[i], pts[j]));
    }
    const cell = buildCell(planes);
    let minEdge = null, maxEdge = null;
    for (const f of cell.faces) {
      for (let k = 0; k < f.ids.length; k++) {
        const a = cell.vertices[f.ids[k]], b = cell.vertices[f.ids[(k + 1) % f.ids.length]];
        const d2 = V.dot(V.sub(b, a), V.sub(b, a));
        if (!minEdge || d2.cmp(minEdge) < 0) minEdge = d2;
        if (!maxEdge || d2.cmp(maxEdge) > 0) maxEdge = d2;
      }
    }
    cells.push({ seed: pts[i], planes, ...cell, minEdge, maxEdge, watertight: auditWatertight(cell) });
  }
  let total = new Frac(0n);
  for (const c of cells) total = total.add(c.volume);
  const boxVolume = Sf.mul(Sf).mul(Sf);
  const err = total.sub(boxVolume).div(boxVolume);
  return {
    boxVolume, seedCount: pts.length, cells, totalVolume: total,
    volumeError: err, // exact relative error, expected exactly 0
    triangles: cells.reduce((s, c) => s + c.faces.reduce((t, f) => t + Math.max(0, f.ids.length - 2), 0), 0),
  };
}

/** Deterministic integer-seed patterns; all coordinates are k/1000. */
export function seedPattern(name, count) {
  const out = [];
  let state = 123456789;
  const rnd = () => { state = (1103515245 * state + 12345) % 2147483648; return state / 2147483648; };
  for (let i = 0; i < count; i++) {
    if (name === 'grid') {
      const per = Math.ceil(Math.cbrt(count));
      out.push([((i % per) + 0.5) / per, (Math.floor(i / per) % per + 0.5) / per, (Math.floor(i / (per * per)) + 0.5) / per]);
    } else if (name === 'slab') {
      out.push([0.5, 0.5, (i + 0.5) / count]);
    } else {
      out.push([0.08 + 0.84 * rnd(), 0.08 + 0.84 * rnd(), 0.08 + 0.84 * rnd()]);
    }
  }
  return out.map((p) => p.map((c) => new Frac(BigInt(Math.round(c * 1000)), 1000n)));
}

export function toIndexedGeometry(cell) {
  const positions = [];
  for (const v of cell.vertices) positions.push(v[0].toNumber(), v[1].toNumber(), v[2].toNumber());
  const indices = [];
  for (const f of cell.faces) {
    for (let i = 1; i + 1 < f.ids.length; i++) indices.push(f.ids[0], f.ids[i], f.ids[i + 1]);
  }
  return { positions, indices };
}
