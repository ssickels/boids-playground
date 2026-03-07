# Boids Playground

An interactive underwater boids simulation built with [Three.js](https://threejs.org/). Watch a school of fish exhibit emergent flocking behavior driven by three simple rules — separation, alignment, and cohesion — while a triggerfish sweeps through and scatters the school.

A real-time parameter panel lets you tune all boid behavior values while the simulation runs.

**Live demo:** [stevessite.com/playground.html](https://stevessite.com/playground.html)

---

## What it looks like

- 10 blue tangs schooling with boids logic
- Triggerfish passes through every ~10 seconds on a randomized bezier curve, causing the school to scatter
- Light shafts, caustic lighting, marine snow particles
- Slider panel (upper right) with 10 tunable parameters in real time

---

## Running locally

Requires a local web server (browser ES modules block file:// requests):

```bash
cd boids-playground
python3 -m http.server 8080
# open http://localhost:8080
```

Without the GLB model files (see below), you'll see the **procedural fallback fish** — blue disc-shaped geometry for the tangs, and no triggerfish. All boids behavior and the slider panel work identically.

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
| Vertical damping | `DAMP_Y` | 0.30 | 0–1 | Reduces vertical acceleration (lower = more vertical scatter) |
| Depth damping | `DAMP_Z` | 0.50 | 0–1 | Reduces depth (z-axis) acceleration |

---

## Installing the GLB models (optional, for full visuals)

The 3D fish models are **paid assets** and are not included in this repo. Without them, a procedural fallback renders in place of the blue tang, and the triggerfish simply does not appear.

To install the full models:

1. **Blue Tang** — purchase from Fab.com:
   - Search for *"Blue Tang Fish"* by the creator **Istvan Szabo** (or similar — the model used here includes AO + metallic/roughness PBR maps)
   - Download as `.glb`
   - Place `blue_tang.glb` in the repo root
   - Also place the accompanying PBR textures: `Blue_Tang_Fish_AO.png` and `Blue_Tang_Fish_Metallic_Roughness.png`

2. **Orangestripe Triggerfish** — purchase from Fab.com:
   - Search for *"Orangestripe Triggerfish"* — the model requires an `Idle_swim` animation clip
   - Download as `.glb`
   - Place `orangestripe_triggerfish.glb` in the repo root

Then run the local server again — the GLB models will load automatically.

---

## Architecture

| File | Purpose |
|---|---|
| `scene.js` | Shared Three.js animation module. Exports `DEFAULTS` and `initScene(container, params)`. The `params` object is read every frame, so slider changes take effect instantly. |
| `index.html` | Playground page — imports `scene.js`, wires up the slider panel |
| `nav.js` | Self-contained navigation bar (no dependencies) |
| `theme.css` | Site color palette |

The `scene.js` module is also used by the homepage (`stevessite.com`) with default params and no slider panel.

---

## License

MIT — feel free to use the boids code and scene setup. The GLB models are not included and have their own commercial licenses.
