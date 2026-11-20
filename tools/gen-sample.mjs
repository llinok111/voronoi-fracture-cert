// Deterministic sample generator: exact Voronoi fracture scenes for the browser.
// Usage: node tools/gen-sample.mjs [outPath]
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fracture, seedPattern, toIndexedGeometry, Frac } from '../src/core.mjs';

const out = process.argv[2] || 'data/fracture.json';

const SCENES = [
  { name: 'box-12-jitter', pattern: 'random', count: 12, S: '1' },
  { name: 'slab-8', pattern: 'slab', count: 8, S: '2' },
  { name: 'grid-8', pattern: 'grid', count: 8, S: '1/2' },
];

function fracToStr(f) { return f.toString(); }

const scenes = SCENES.map((sc) => {
  const seeds = seedPattern(sc.pattern, sc.count);
  const S = sc.S.includes('/')
    ? new Frac(BigInt(sc.S.split('/')[0]), BigInt(sc.S.split('/')[1]))
    : new Frac(BigInt(sc.S), 1n);
  const f = fracture({ seeds, S });
  return {
    name: sc.name,
    boxEdge: fracToStr(S),
    seeds: seeds.map((p) => p.map(fracToStr)),
    cells: f.cells.map((c) => ({
      seed: c.seed.map(fracToStr),
      volume: fracToStr(c.volume),
      positions: c.vertices.flatMap((v) => v.map((x) => x.toNumber())),
      indices: toIndexedGeometry(c).indices,
      watertight: c.watertight.paired === c.watertight.undirected && c.watertight.bad === 0,
      faces: c.faces.length,
    })),
    summary: {
      shards: f.cells.length,
      triangles: f.triangles,
      volumeError: fracToStr(f.volumeError),
      totalVolume: fracToStr(f.totalVolume),
      boxVolume: fracToStr(f.boxVolume),
      watertightShards: f.cells.filter((c) => c.watertight.paired === c.watertight.undirected && c.watertight.bad === 0).length,
    },
  };
});

const payload = { generator: 'tools/gen-sample.mjs', core: 'src/core.mjs', scenes };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(payload, null, 1) + '\n');
console.log('wrote', out, JSON.stringify(scenes.map((s) => [s.name, s.summary.shards, s.summary.volumeError])));
