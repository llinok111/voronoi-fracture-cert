// Baseline B: voxel nearest-seed carving (resolution limited). A common fast path
// for pre-fracturing in engines: assign each voxel to its nearest seed, sum volumes.
export function voxelFracture({ seeds, S, res = 48 }) {
  const h = S / res;
  const counts = new Array(seeds.length).fill(0);
  for (let i = 0; i < res; i++) for (let j = 0; j < res; j++) for (let k = 0; k < res; k++) {
    const x = (i + 0.5) * h, y = (j + 0.5) * h, z = (k + 0.5) * h;
    let best = -1, bd = Infinity;
    for (let s = 0; s < seeds.length; s++) {
      const p = seeds[s];
      const dx = x - p[0] * S, dy = y - p[1] * S, dz = z - p[2] * S;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bd) { bd = d; best = s; }
    }
    counts[best]++;
  }
  const cellVolume = h * h * h;
  const total = res * res * res * cellVolume;
  const volumes = counts.map((c) => c * cellVolume);
  return { volumes, total, boxVolume: S * S * S, relError: (total - S * S * S) / (S * S * S),
    empty: counts.filter((c) => c === 0).length, planarFaces: 0 };
}
