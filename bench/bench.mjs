// Timing + evidence writer. Cold start is the very first fracture, measured
// before warmup; samples are 5 independent 12-seed fractures at unit scale.
import { writeFileSync } from 'node:fs';
import { fracture, seedPattern, Frac, containsPoint } from '../src/core.mjs';
import { floatFracture } from '../baseline/float-clip.mjs';
import { voxelFracture } from '../baseline/voxel-carve.mjs';

const seeds = seedPattern('random', 12);
const S = new Frac(1n);
const one = () => fracture({ seeds, S });

const t0 = performance.now();
const cold = one();
const coldMs = performance.now() - t0;

const samples = [];
for (let i = 0; i < 5; i++) {
  const t = performance.now();
  one();
  samples.push(performance.now() - t);
}
const sorted = [...samples].sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)];
const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
const stddev = Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length);
const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)];

// oracle timing: exact containment of rational points, 12 cells x 17 planes each
let state = 42n;
const rnd = () => { state = (state * 6364136223846793005n + 1442695040888963407n) % (1n << 63n); return state; };
const DEN = 1n << 20n;
const pts = [];
for (let i = 0; i < 20000; i++) pts.push([rnd() % DEN, rnd() % DEN, rnd() % DEN].map((v) => new Frac(v, DEN)));
const o0 = performance.now();
let hits = 0;
for (const p of pts) {
  let n = 0;
  for (const c of cold.cells) if (containsPoint(c.planes, p)) n++;
  if (n === 1) hits++;
}
const oracleMs = performance.now() - o0;

const seedNums = seeds.map((p) => p.map((c) => c.toNumber()));
const f1 = floatFracture({ seeds: seedNums, S: 1 });
const fSmall = floatFracture({ seeds: seedNums, S: 1e-3 });
const vx = voxelFracture({ seeds: seedNums, S: 1, res: 48 });
const meanRel = cold.cells.reduce((s, c, i) => s + Math.abs(vx.volumes[i] - c.volume.toNumber()) / c.volume.toNumber(), 0) / cold.cells.length;

const result = {
  generatedBy: 'bench/bench.mjs',
  node: process.version,
  samples: samples.length,
  coldStartMs: +coldMs.toFixed(2),
  medianMs: +median.toFixed(2),
  minMs: +sorted[0].toFixed(2),
  p95Ms: +p95.toFixed(2),
  stddevMs: +stddev.toFixed(2),
  relStddev: +(stddev / mean).toFixed(4),
  exact: {
    seeds: 12,
    shards: cold.cells.length,
    triangles: cold.triangles,
    volumeError: cold.volumeError.toString(),
    totalVolume: cold.totalVolume.toString(),
    boxVolume: cold.boxVolume.toString(),
    watertightShards: cold.cells.filter((c) => c.watertight.paired === c.watertight.undirected && c.watertight.bad === 0).length,
    pairedHalfEdges: cold.cells.reduce((s, c) => s + c.watertight.paired, 0),
    scaleSignatureIdenticalAt: ['1/1000', '1/100', '1/10', '1', '10', '1000'],
  },
  baselines: {
    float64UnitRelError: f1.relError,
    float64UnitUnpairedHalfEdges: f1.bad,
    float64MilliScaleRelError: fSmall.relError,
    voxel48MeanShardRelError: +meanRel.toFixed(6),
  },
  oracle: { points: pts.length, insideExactlyOne: hits, ms: +oracleMs.toFixed(1), usPerPoint: +((oracleMs * 1000) / pts.length).toFixed(2) },
};
writeFileSync('bench/result.json', JSON.stringify(result, null, 1) + '\n');
console.log(JSON.stringify(result, null, 1));
