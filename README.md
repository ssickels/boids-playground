# Boids Playgrounds

Two interactive flocking simulations built with [Three.js](https://threejs.org/) — fish schooling and starling murmurations. Both are driven by Craig Reynolds' boids algorithm (separation, alignment, cohesion), but the murmuration sim extends the core rules significantly to handle thousands of birds with emergent large-scale dynamics.

**Live demos:** [stevessite.com](https://stevessite.com)

---

## Fish Schooling

![Preview of the Boids Playground](https://stevessite.com/boids_playground_preview.jpg)

A school of Blue Tang fish exhibits emergent flocking behavior while an Orangestripe Triggerfish sweeps through on a Bézier path. Classic metric-radius boids with a real-time slider panel.

| Page | Description |
|---|---|
| [Playground](https://stevessite.com/playground.html) | Interactive simulation with slider panel |
| [How It Works](https://stevessite.com/boids-explain.html) | Visual explainer: the three rules with animated demos |
| [About](https://stevessite.com/boids-about.html) | Plain-English overview and slider reference |
| [Dev Notes](https://stevessite.com/boids-impl.html) | Implementation details: orientation math and the vertical singularity fix |

### Fish files

| File | Purpose |
|---|---|
| `scene.js` | Three.js fish simulation — exports `initScene(container, params)` and `DEFAULTS` |
| `playground.html` | Playground page — slider panel UI, wires up `scene.js` |
| `boids-explain.html` | How It Works — animated 2D demos of each rule |
| `boids-about.html` | About page — the three rules and slider reference |
| `boids-impl.html` | Dev Notes — orientation math, singularity fix |
| `boids-nav.js` | Navigation bar with fish-section tabs |

---

## Starling Murmurations

![Preview of the Boids Playground](https://stevessite.com/murmuration_preview.jpg)

A murmuration of 3,000+ starlings sweeping across a twilight sky. Extends the classic boids algorithm with topological neighbors (nearest-N instead of fixed radius), split neighbor counts, adaptive centroid homing, front-bias hemisphere weighting, and a velocity-aware ground plane. A density-waves extension adds speed braking (birds slow when neighbors crowd their personal space), producing compression cascades analogous to phantom traffic jams. Two diagnostic color modes — density (neighbor count) and velocity (speed change per frame) — make these waves visible in real time. The simulation grew out of the fish schooling playground but shares no code with it.

| Page | Description |
|---|---|
| [Playground](https://stevessite.com/murmuration.html) | Interactive simulation with slider panel |
| [Density Waves](https://stevessite.com/murmuration-waves.html) | How speed braking creates compression waves, with connections to traffic flow and active matter |
| [How It Works](https://stevessite.com/murmuration-about.html) | Algorithm deep dive: all seven forces, spatial hashing, initial conditions |
| [About](https://stevessite.com/murmuration-intro.html) | What this is, why so many sliders, key parameters |

### Murmuration files

| File | Purpose |
|---|---|
| `murmuration.js` | Simulation engine — spatial hash, boid forces, density/velocity coloring, Three.js instanced rendering |
| `murmuration.html` | Playground page — slider panel, presets, density waves controls, splash screen |
| `murmuration-waves.html` | Density Waves — speed braking mechanics, visualization modes, connections to traffic flow |
| `murmuration-about.html` | How It Works — detailed explanation of extensions to the boids algorithm |
| `murmuration-intro.html` | About page — casual first-person overview |
| `murmuration-nav.js` | Navigation bar with murmuration-section tabs |
| `murmuration-theme.css` | Purple palette (CSS variable overrides on top of `theme.css`) |

---

## Shared files

| File | Purpose |
|---|---|
| `theme.css` | Base site theme — teal palette, typography, component styles (shared across stevessite.com) |
| `nav.js` | Generic site navigation (used by homepage) |

---

## Running locally

Requires a local web server (browser ES modules block `file://` requests):

```bash
cd boids-playgrounds
python3 -m http.server 8000
# Fish:          http://localhost:8000/playground.html
# Murmurations:  http://localhost:8000/murmuration.html
```

---

## 3D model assets (not included)

The fish models are **paid assets** and are not included in this repo. Without them, placeholder geometry renders in their place. The murmuration sim uses procedural geometry (icosahedrons) and has no external model dependencies.

**Artist:** [Nyi Nyi Tun](https://www.fab.com/sellers/Nyi%20Nyi%20Tun) on Fab.com
- [Blue Tang Surgeon Fish](https://www.fab.com/listings/2203de0a-a1f4-4a7a-8a98-34dc4d68a39e)
- [Orangestripe Triggerfish](https://www.fab.com/listings/b5bff737-7450-4362-8be9-93079bdf6588)

---

## Related

- [stevessite.com](https://stevessite.com) — live site
- [steves-site](https://github.com/ssickels/steves-site) — main site repo
- [Investment Strategy Simulator](https://github.com/ssickels/investment-dashboard) — another project on the same site

---

## License

MIT — the boids code and scene setup are free to use. The 3D fish models are not included and have their own commercial licenses.
