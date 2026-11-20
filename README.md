# voronoi-fracture-cert

**Shatter a box into exact Voronoi shards whose volumes sum to the box volume with relative error `0` (a BigInt fraction, not a float), where a float64 sequential-clipping baseline drifts by `2.22e-16` at unit scale and `36.85%` at `S=1e-3`, and a 48³ voxel-carve baseline misplaces `0.107%` of each shard's volume on average.**

Upstream: none

`src/core.mjs` is pure rational geometry: no three.js, no DOM, no tolerances. Every vertex is a `BigInt` fraction, every shard is the exact intersection of 6 box planes and 11 bisector planes, and the certificate (`sum(volume) == S³`, watertightness, convexity, disjointness, 60k-point partition) is recomputed by the same module in node and in the browser.

## Run it

```bash
node tools/gen-sample.mjs   # deterministic sample data -> data/fracture.json
node bench/verify.mjs       # 22 assertions, exit 0 only if all pass
node bench/bench.mjs        # writes bench/result.json, prints the evidence
python3 -m http.server 4173 # then open http://localhost:4173
```

No install step, no `node_modules`: the page pulls three.js `0.169.0` from jsDelivr through an importmap.

## Evidence (from `bench/result.json`, node v24.19.0, 4-core box)

| Metric | Exact core | float64 clipping baseline | 48³ voxel baseline |
|---|---|---|---|
| Relative volume error, `S=1` | **0** (`0/1`) | `-2.22e-16` | total by construction |
| Relative volume error, `S=1e-3` | **0** | `3.685e-1` (36.85%) | — |
| Mean per-shard volume error | **0** | — | `1.07e-3` (0.107%) |
| Watertight shards | **12/12**, 270 paired half-edges | 88 unpaired half-edges | no planar faces at all |

- 12 shards, 312 triangles, 114 faces, 180 vertices; every vertex satisfies all 17 defining planes exactly (A9).
- 66/66 shard pairs separated by their exact bisector certificate (A12).
- 60,000 rational points: `60000` inside exactly one shard, `0` double-assigned, `0` missed; exact nearest-seed oracle agrees `60000/60000` (A13/A14).
- Exact scale equivariance: the normalized shard-volume signature (1,962-char fraction string) is **byte-identical** across `S ∈ {1e-3, 1e-2, 1e-1, 1, 10, 1e3}` (A11) — five decades, zero tolerance.
- Determinism: two independent generator runs produce the same `sha256 50d2cefd2789aa9d…` (A1); the committed `data/fracture.json` matches it (A2).

Timing (5 samples + cold start, full 12-seed fracture incl. all certificates):
cold `590.2 ms`, median `520.8 ms`, min `509.7 ms`, p95 `526.9 ms`, stddev `5.6 ms` → **relStddev 1.08%**.
The containment oracle costs `310 µs/point` (20,000 points, 12 cells × 17 planes, exact `BigInt` dot products) — this is the price of exactness, stated rather than hidden.

## 本轮创新

**B 档.** 台账里 `offsetcert-lab` 做的是精确有理**平面偏移**，`rangecert`/`range` 系做区间证书，没有一条把**破碎分区**本身做成可逐位复算的证书。这里的新东西是三件此前没同时出现过的事：(1) 用「三平面交点枚举 + 精确半边配对」代替迭代裁剪，使碎片体积守恒在**六个数量级**上都是精确 `0` 而不是 `1e-16`；(2) 把体积守恒、水密、凸性、两两分离、60k 点单归属合成**一个可在浏览器里重算**的证书，页面按钮跑的就是 node 里那份 `core.mjs`；(3) 首次把碎片尺度的**精确等变**（signature 逐字节相同）当作可判定断言，而不是浮点容差下的近似。

## Known limitations

- **Convex box domain only.** Seeds must lie inside an axis-aligned box; concave stock and seeds outside the box are not supported yet.
- **Exactness is only as strong as the inputs.** Seeds come from `k/1000` integers, so all plane coefficients are dyadic; arbitrary float seeds are accepted but their decimal text is what gets rationalized (`Frac.of`), so answers are exact for the rationalized input, not for the original float.
- **BigInt denominators grow** with the number of seeds; 12 seeds is ~0.5 s per fracture on this 4-core box, 24 seeds is several seconds. Rendering converts fractions to `float64` (`Frac.toNumber`, 40 significant bits) — display only, never part of a certificate.
- **No tolerance is used anywhere in `src/core.mjs`.** The two baselines do use tolerances and they are disclosed: `baseline/float-clip.mjs` uses `EPS = 1e-9` (absolute) plus a `1e-7·S` cap-plane dedupe, which is exactly why it degrades at `S=1e-3`; `baseline/voxel-carve.mjs` uses `res = 48`.
- **The float baseline's 88 unpaired half-edges** are a real output of that code under a `1e-12` vertex-weld audit, not an injected defect; it is reported as measured.
- Self-collision, non-convex cells, and shard physics are out of scope: this is a fracture certificate, not a rigid-body solver.

## Layout

```
index.html             importmap + panel; three.js 0.169.0 pinned
main.js                rendering + orbit + explode slider + in-browser recompute
src/core.mjs           exact rational fracture, watertight/convexity/disjointness audits
tools/gen-sample.mjs   deterministic scenes -> data/fracture.json
baseline/float-clip.mjs    float64 sequential clipping, EPS = 1e-9
baseline/voxel-carve.mjs   48^3 nearest-seed carving
bench/verify.mjs       22 assertions
bench/bench.mjs        cold start + 5 samples + oracle timing -> bench/result.json
```

MIT © 2026 llinok111.
