// Assertion gate. Every number printed here is computed live from src/core.mjs.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fracture, seedPattern, Frac, containsPoint } from '../src/core.mjs';
import { floatFracture } from '../baseline/float-clip.mjs';
import { voxelFracture } from '../baseline/voxel-carve.mjs';

let pass = 0, fail = 0;
const results = [];
function ok(name, cond, detail) {
  results.push({ name, ok: !!cond, detail });
  if (cond) { pass++; console.log(`PASS ${name}  ${detail}`); }
  else { fail++; console.log(`FAIL ${name}  ${detail}`); }
}
const dot = (a, b) => a[0].mul(b[0]).add(a[1].mul(b[1])).add(a[2].mul(b[2]));

// ---- sample data determinism (generator run twice in a child process) ----
const dir = mkdtempSync(join(tmpdir(), 'frac-'));
const a = join(dir, 'a.json'), b = join(dir, 'b.json');
execFileSync(process.execPath, ['tools/gen-sample.mjs', a], { stdio: 'ignore' });
execFileSync(process.execPath, ['tools/gen-sample.mjs', b], { stdio: 'ignore' });
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const genA = sha(a), genB = sha(b);
const data = JSON.parse(readFileSync('data/fracture.json', 'utf8'));
ok('A1 generator byte-deterministic', genA === genB, `sha256 ${genA.slice(0, 16)} == ${genB.slice(0, 16)}`);
ok('A2 committed data matches generator', sha('data/fracture.json') === genA,
  `${data.scenes.length} scenes, ${data.scenes.reduce((s, x) => s + x.summary.shards, 0)} shards`);
ok('A3 sample has 3 scenes', data.scenes.length === 3, data.scenes.map((s) => `${s.name}:${s.summary.shards}`).join(' '));

// ---- exact fracture, six scales spanning five decades ----
const seeds = seedPattern('random', 12);
const SCALES = [['1/1000', 1n, 1000n], ['1/100', 1n, 100n], ['1/10', 1n, 10n], ['1', 1n, 1n], ['10', 10n, 1n], ['1000', 1000n, 1n]];
const runs = [];
for (const [label, n, d] of SCALES) {
  const t0 = performance.now();
  const f = fracture({ seeds, S: new Frac(n, d) });
  runs.push({ label, f, ms: performance.now() - t0 });
}
const unit = runs.find((r) => r.label === '1').f;
ok('A4 shard count == seed count', runs.every((r) => r.f.cells.length === 12), `12/12 at every scale`);
ok('A5 volume conserved exactly (all 6 scales)', runs.every((r) => r.f.volumeError.isZero()),
  runs.map((r) => `${r.label}:${r.f.volumeError.toString()}`).join(' '));
ok('A6 total shard volume == box volume', runs.every((r) => r.f.totalVolume.eq(r.f.boxVolume)),
  `sum=${unit.totalVolume.toString()} box=${unit.boxVolume.toString()}`);
const wtCount = unit.cells.filter((c) => c.watertight.paired === c.watertight.undirected && c.watertight.bad === 0 && c.watertight.unpaired === 0).length;
ok('A7 every shard watertight', wtCount === unit.cells.length,
  `${wtCount}/${unit.cells.length} shards, ${unit.cells.reduce((s, c) => s + c.watertight.paired, 0)} paired edges`);
ok('A8 every face convex', unit.cells.every((c) => c.faces.every((f) => f.convex)),
  `${unit.cells.reduce((s, c) => s + c.faces.length, 0)} faces checked by exact cross products`);
ok('A9 every vertex satisfies every defining plane', unit.cells.every((c) => c.vertices.every((v) => c.planes.every((p) => dot(p.n, v).cmp(p.d) <= 0))),
  `${unit.cells.reduce((s, c) => s + c.vertices.length, 0)} vertices x 17 planes`);
ok('A10 all shard volumes positive', unit.cells.every((c) => c.volume.sign() > 0),
  `min=${unit.cells.map((c) => c.volume.toNumber()).reduce((m, x) => Math.min(m, x)).toFixed(6)}`);

// exact scale equivariance: normalized shard volumes must be identical fractions
const sig = (f) => f.cells.map((c) => c.volume.div(f.boxVolume).key()).sort().join(';');
const sigs = runs.map((r) => sig(r.f));
ok('A11 exact scale equivariance (1e-3..1e3)', sigs.every((s) => s === sigs[0]),
  `6 scales, signature ${sig(unit).length} chars identical`);

// ---- pairwise disjointness via the bisector certificates ----
let pairsOk = 0, pairs = 0, minGap = null;
for (let i = 0; i < unit.cells.length; i++) {
  for (let j = i + 1; j < unit.cells.length; j++) {
    pairs++;
    const A = unit.cells[i], B = unit.cells[j];
    const p = A.seed, q = B.seed;
    const n = [q[0].sub(p[0]), q[1].sub(p[1]), q[2].sub(p[2])];
    const d = dot(q, q).sub(dot(p, p)).div(new Frac(2n));
    const sa = A.vertices.map((v) => d.sub(dot(n, v)));  // >= 0 means strictly on p side
    const sb = B.vertices.map((v) => dot(n, v).sub(d));
    const mn = [...sa, ...sb].reduce((m, x) => (m === null || x.cmp(m) < 0 ? x : m), null);
    if (sa.every((x) => x.sign() >= 0) && sb.every((x) => x.sign() >= 0)) pairsOk++;
    if (mn && (minGap === null || mn.cmp(minGap) < 0)) minGap = mn;
  }
}
ok('A12 pairwise disjoint by exact bisector certificate', pairsOk === pairs,
  `${pairsOk}/${pairs} pairs, min gap ${minGap.toString()}`);

// ---- independent containment oracle over 60k rational points ----
let state = 987654321n;
const rnd = () => { state = (state * 6364136223846793005n + 1442695040888963407n) % (1n << 63n); return state; };
const DEN = 1n << 20n;
const S = new Frac(1n);
let inOne = 0, double = 0, miss = 0, nearestMismatch = 0;
const N = 60000;
for (let t = 0; t < N; t++) {
  const x = [rnd() % DEN, rnd() % DEN, rnd() % DEN].map((v) => new Frac(v, DEN));
  const hits = [];
  for (let i = 0; i < unit.cells.length; i++) if (containsPoint(unit.cells[i].planes, x)) hits.push(i);
  if (hits.length === 1) inOne++;
  else if (hits.length > 1) double++;
  else miss++;
  // independent oracle: exact nearest seed by squared distance, not by clipping
  let best = -1, bd = null;
  for (let i = 0; i < unit.cells.length; i++) {
    const p = unit.cells[i].seed;
    const d2 = dot([x[0].sub(p[0]), x[1].sub(p[1]), x[2].sub(p[2])], [x[0].sub(p[0]), x[1].sub(p[1]), x[2].sub(p[2])]);
    if (!bd || d2.cmp(bd) < 0) { bd = d2; best = i; }
  }
  if (hits.length === 1 && hits[0] !== best) nearestMismatch++;
}
ok('A13 60k points inside exactly one shard', inOne === N && double === 0 && miss === 0,
  `inOne=${inOne} double=${double} miss=${miss} of ${N}`);
ok('A14 exact containment agrees with exact nearest-seed oracle', nearestMismatch === 0,
  `${N - nearestMismatch}/${N} agree`);

// ---- float baseline: honest measurement of the same pipeline ----
const seedNums = seeds.map((p) => p.map((c) => c.toNumber()));
const fb = floatFracture({ seeds: seedNums, S: 1 });
const fbSmall = floatFracture({ seeds: seedNums, S: 1e-3 });
ok('A15 float64 baseline drifts at unit scale', Math.abs(fb.relError) > 0,
  `rel volume error ${fb.relError.toExponential(3)}, ${fb.bad} unpaired half-edges`);
ok('A16 float64 absolute-EPS baseline breaks at 1e-3', Math.abs(fbSmall.relError) > 1e-3,
  `rel volume error ${fbSmall.relError.toExponential(3)}`);

// ---- voxel baseline: shard accuracy against exact volumes ----
const vx = voxelFracture({ seeds: seedNums, S: 1, res: 48 });
const meanRel = unit.cells.reduce((s, c, i) => s + Math.abs(vx.volumes[i] - c.volume.toNumber()) / c.volume.toNumber(), 0) / unit.cells.length;
ok('A17 voxel baseline has non-zero shard volume error', meanRel > 5e-4,
  `mean per-shard volume error ${(meanRel * 100).toFixed(2)}% at 48^3`);
ok('A18 exact path has zero volume error where baselines do not',
  unit.volumeError.isZero() && Math.abs(fb.relError) + meanRel > 0,
  `exact=0 float=${Math.abs(fb.relError).toExponential(2)} voxel=${(meanRel * 100).toFixed(2)}%`);

// ---- structural invariants ----
const tri = unit.cells.reduce((s, c) => s + c.faces.reduce((t, f) => t + f.ids.length - 2, 0), 0);
ok('A19 triangle count matches data/summary', tri === unit.triangles && tri === data.scenes[0].summary.triangles,
  `${tri} triangles`);
ok('A20 face count per shard >= 4', unit.cells.every((c) => c.faces.length >= 4),
  `min faces ${Math.min(...unit.cells.map((c) => c.faces.length))}`);
ok('A21 min edge length > 0 (no degenerate shards)', unit.cells.every((c) => c.minEdge.sign() > 0),
  `min squared edge ${unit.cells.map((c) => c.minEdge.toNumber()).reduce((m, x) => Math.min(m, x)).toExponential(3)}`);
ok('A22 watertight audit is non-vacuous', unit.cells.every((c) => c.watertight.halfEdges > 0 && c.watertight.undirected > 0),
  `${unit.cells.reduce((s, c) => s + c.watertight.halfEdges, 0)} half-edges`);

writeFileSync(join(dir, 'summary.json'), JSON.stringify({ pass, fail, results }, null, 1));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
