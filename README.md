# Boids Playground

An interactive fish schooling simulation built with [Three.js](https://threejs.org/). Watch a school of Blue Tang fish exhibit emergent flocking behavior driven by three simple rules — separation, alignment, and cohesion — while an Orangestripe Triggerfish sweeps through on a Bézier path.

A real-time slider panel lets you tune all boid behavior values while the simulation runs.

**Live demo:** [stevessite.com/playground.html](https://stevessite.com/playground.html)

---

## Pages

| Page | Description |
|---|---|
| [Playground](https://stevessite.com/playground.html) | Interactive simulation with slider panel |
| [About Boids](https://stevessite.com/boids-about.html) | Plain-English explainer: the three rules + slider reference |
| [Under the Hood](https://stevessite.com/boids-impl.html) | Implementation details: orientation math and the vertical singularity fix |

---

## Running locally

Requires a local web server (browser ES modules block `file://` requests):

```bash
cd boids-playground
python3 -m http.server 8000
# open http://localhost:8000/playground.html
```

Without the GLB model files (see below), you'll see placeholder geometry for the fish. All boids behavior and the slider panel work identically.

---

## Slider parameters

| Label | Variable | Default | Range | Description |
|---|---|---|---|---|
| Separation radius | `SEP_R` | 7.5 | 1–20 | Fish closer than this push each other away |
| Alignment radius | `ALI_R` | 6.5 | 1–20 | Fish within this range match each other's velocity |
| Cohesion radius | `COH_R` | 10.0 | 1–25 | Fish within this range steer toward the group center |
| Separation strength | `W_SEP` | 5.0 | 0–15 | Weight of separation force |
| Alignment strength | `W_ALI` | 1.5 | 0–8 | Weight of alignment force |
| Cohesion strength | `W_COH` | 1.2 | 0–8 | Weight of cohesion force |
| Tang turn rate | `TURN_TANG` | 4.0 | 0.5–12 | How quickly blue tangs rotate toward target heading (rad/s) |
| Triggerfish turn rate | `TURN_TF` | 5.0 | 0.5–15 | How quickly the triggerfish rotates along its path (rad/s) |
| Vertical damping | `DAMP_Y` | 0.20 | 0–1 | Reduces vertical acceleration (lower = more vertical scatter) |
| Depth damping | `DAMP_Z` | 0.50 | 0–1 | Reduces depth (z-axis) acceleration |

---

## 3D model assets (not included)

The fish models are **paid assets** and are not included in this repo. Without them, placeholder geometry renders in their place.

To use the full models, purchase from the artist and place files in the repo root:

- `blue_tang.glb` + `Blue_Tang_Fish_AO.png` + `Blue_Tang_Fish_Metallic_Roughness.png`
- `orangestripe_triggerfish.glb`

**Artist:** [Nyi Nyi Tun](https://www.fab.com/sellers/Nyi%20Nyi%20Tun) on Fab.com

- [Blue Tang Surgeon Fish](https://www.fab.com/listings/2203de0a-a1f4-4a7a-8a98-34dc4d68a39e)
- [Orangestripe Triggerfish](https://www.fab.com/listings/b5bff737-7450-4362-8be9-93079bdf6588)

---

## Files

| File | Purpose |
|---|---|
| `playground.html` | Main entry point — slider panel UI, wires up `scene.js` |
| `scene.js` | Three.js animation module. Exports `initScene(container, params)` and `DEFAULTS`. The `params` object is read every frame, so slider changes take effect instantly. |
| `boids-nav.js` | Self-contained nav bar with hamburger menu + Playground / About Boids / Under the Hood tabs |
| `boids-about.html` | About page — the three rules and slider reference |
| `boids-impl.html` | Implementation page — orientation math, singularity fix |
| `theme.css` | Ocean color palette (shared across stevessite.com) |

`scene.js` is also used by the stevessite.com homepage with default params and no slider panel.

---

## Related

- [stevessite.com](https://stevessite.com) — live site
- [steves-site](https://github.com/ssickels/steves-site) — main site repo (private — contains paid .glb assets)
- [Investment Strategy Simulator](https://github.com/ssickels/investment-dashboard) — another project on the same site

---

## License

MIT — the boids code and scene setup are free to use. The 3D fish models are not included and have their own commercial licenses.
