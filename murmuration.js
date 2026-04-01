import * as THREE from 'three';

// ── Fixed constants ──────────────────────────────────────────────────
const SEP_DIST    = 1.5;
const BND         = { x: 100, y: 70, z: 80 };
const BND_MARGIN  = 20;
const BND_K       = 0.25;
const MAX_BIRDS   = 6000;
const HASH_CELL   = 10;

// ── Tunable defaults ─────────────────────────────────────────────────
export const DEFAULTS = {
  COUNT:     3000,
  N_SEP:     7,
  N_ALI_COH: 14,
  W_SEP:     3.0,
  W_ALI:     4.0,
  W_COH:     3.0,
  SIM_SPEED: 1.0,
  MAX_SPEED: 15.0,
  MAX_FORCE: 0.5,
  FRONT_BIAS: 1.0,  // 1.0 = no bias; >1 = weight forward neighbors more for alignment
  PERSONAL_SPACE: 2.0, // metric separation radius — all birds within this distance get pushed away
  MIN_SPEED_RATIO: 0.53, // min speed as fraction of MAX_SPEED — stall speed
  EDGE_ALI: 0, // extra alignment for boundary birds; 0 = off (current behavior)
  // WIND: true,  — removed from UI; see wind section below
  HOMING: 0.75,
  DENSITY_RADIUS: 5.0,  // search radius for neighbor count
  DENSITY_LO: 3,         // count mapped to blue (sparse)
  DENSITY_HI: 25,        // count mapped to red (dense)
  W_SPEED_SEP: 0,        // speed braking from personal space violations; 0 = off
  DV_THRESHOLD: 0.75,    // speed-change threshold for velocity coloring
  PRED_ENABLED:  false,
  PRED_SPEED_PCT: 130,   // hawk speed as % of MAX_SPEED
  PRED_FORCE:    5.0,    // hawk steering force / agility
  ESCAPE_RADIUS:     8,    // world-unit radius around hawk that triggers escape
  ESCAPE_SPEED_PCT:  140,  // target escape speed as % of MAX_SPEED
  ESCAPE_ACCEL_MULT: 2.0,  // multiplier on MAX_FORCE during escape
  ESCAPE_BLEND:      0.5,  // blend-back time (seconds) after exiting escape radius
  CANCEL_SEP:        true, // boid-boid separation is cancelled during escape
};

// ── Spatial hash ─────────────────────────────────────────────────────
class SpatialHash {
  constructor() { this.map = new Map(); }

  clear() { this.map.clear(); }

  _key(cx, cy, cz) {
    return ((cx + 512) * 1048576) + ((cy + 512) * 1024) + (cz + 512);
  }

  insert(i, x, y, z) {
    const cx = Math.floor(x / HASH_CELL), cy = Math.floor(y / HASH_CELL), cz = Math.floor(z / HASH_CELL);
    const k = this._key(cx, cy, cz);
    let bucket = this.map.get(k);
    if (!bucket) { bucket = []; this.map.set(k, bucket); }
    bucket.push(i);
  }

  // Pre-allocated scratch arrays to avoid GC pressure
  _candIdx = new Int32Array(512);
  _candD2  = new Float32Array(512);
  _nCand   = 0; // exposed so callers can iterate all candidates for metric checks

  countInRadius(selfIdx, x, y, z, r2, px, py, pz) {
    const cx = Math.floor(x / HASH_CELL), cy = Math.floor(y / HASH_CELL), cz = Math.floor(z / HASH_CELL);
    let n = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = this.map.get(this._key(cx + dx, cy + dy, cz + dz));
          if (bucket) {
            for (let j = 0; j < bucket.length; j++) {
              const idx = bucket[j];
              if (idx === selfIdx) continue;
              const ex = px[idx] - x, ey = py[idx] - y, ez = pz[idx] - z;
              if (ex * ex + ey * ey + ez * ez < r2) n++;
            }
          }
        }
      }
    }
    return n;
  }

  findNearest(selfIdx, x, y, z, N, px, py, pz, out) {
    const cx = Math.floor(x / HASH_CELL), cy = Math.floor(y / HASH_CELL), cz = Math.floor(z / HASH_CELL);
    const candIdx = this._candIdx, candD2 = this._candD2;
    let nCand = 0;
    // collect candidates from 3x3x3 neighborhood
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = this.map.get(this._key(cx + dx, cy + dy, cz + dz));
          if (bucket) {
            for (let j = 0; j < bucket.length; j++) {
              const idx = bucket[j];
              if (idx === selfIdx) continue;
              const ex = px[idx] - x, ey = py[idx] - y, ez = pz[idx] - z;
              if (nCand < 512) {
                candIdx[nCand] = idx;
                candD2[nCand] = ex * ex + ey * ey + ez * ez;
                nCand++;
              }
            }
          }
        }
      }
    }
    this._nCand = nCand; // store for metric personal-space checks
    // insertion sort for small N — find N smallest
    const len = Math.min(N, nCand);
    for (let i = 0; i < len; i++) {
      let minK = i;
      for (let k = i + 1; k < nCand; k++) {
        if (candD2[k] < candD2[minK]) minK = k;
      }
      if (minK !== i) {
        // swap
        let tmp = candIdx[i]; candIdx[i] = candIdx[minK]; candIdx[minK] = tmp;
        let tmpD = candD2[i]; candD2[i] = candD2[minK]; candD2[minK] = tmpD;
      }
      out[i] = candIdx[i];
    }
    return len;
  }
}

// ── Steer helper (scalar, writes to _steer output) ──────────────────
const _steer = new Float32Array(3);
function steerScalar(desX, desY, desZ, cvx, cvy, cvz, maxSpd, maxFrc) {
  const mag = Math.sqrt(desX * desX + desY * desY + desZ * desZ);
  if (mag < 1e-6) { _steer[0] = 0; _steer[1] = 0; _steer[2] = 0; return; }
  const s = maxSpd / mag;
  _steer[0] = desX * s - cvx; _steer[1] = desY * s - cvy; _steer[2] = desZ * s - cvz;
  const fm = Math.sqrt(_steer[0] * _steer[0] + _steer[1] * _steer[1] + _steer[2] * _steer[2]);
  if (fm > maxFrc) {
    const c = maxFrc / fm;
    _steer[0] *= c; _steer[1] *= c; _steer[2] *= c;
  }
}

// ── Main init ────────────────────────────────────────────────────────
export function initScene(container, params) {
  // ── Renderer ───────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  // ── Scene ──────────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a2e);
  scene.fog = new THREE.FogExp2(0x0a0a2e, 0.0015);

  // ── Camera ─────────────────────────────────────────────────────────
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.position.set(0, 0, 180);

  // Second camera for split-mode boid's-eye half
  const chaseCam = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 500);

  // ── Panel-open state (for split viewport math) ────────────────────
  let panelOpen = true;

  function setPanelOpen(isOpen) { panelOpen = isOpen; }

  function getSplitViewports() {
    const w = window.innerWidth, h = window.innerHeight;
    const panelW = panelOpen ? 252 : 0; // 240px panel + 12px margin
    const leftW = Math.floor((w - panelW) / 2);
    const rightW = w - panelW - leftW;
    return { leftW, rightW, h, panelW };
  }

  window.addEventListener('resize', () => {
    if (cameraMode === 'split' || cameraMode === 'hawksplit') {
      const vp = getSplitViewports();
      camera.aspect = vp.leftW / vp.h;
      camera.updateProjectionMatrix();
      chaseCam.aspect = vp.rightW / vp.h;
      chaseCam.updateProjectionMatrix();
    } else {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    }
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ── SoA boid data ──────────────────────────────────────────────────
  let px = new Float32Array(MAX_BIRDS);
  let py = new Float32Array(MAX_BIRDS);
  let pz = new Float32Array(MAX_BIRDS);
  let vx = new Float32Array(MAX_BIRDS);
  let vy = new Float32Array(MAX_BIRDS);
  let vz = new Float32Array(MAX_BIRDS);
  let avgND = new Float32Array(MAX_BIRDS); // per-bird density count (smoothed)
  let prevSpd = new Float32Array(MAX_BIRDS); // per-bird speed from last frame
  let count = 0;

  // ── Predator state ────────────────────────────────────────────────
  const pred = {
    active: false,
    x: 0, y: 0, z: 0,
    vx: 0, vy: 0, vz: 0,
  };

  // ── Per-bird escape fade ────────────────────────────────────────
  let escFade = new Float32Array(MAX_BIRDS);

  function reinit(n) {
    count = n;
    avgND.fill(0);
    prevSpd.fill(0);
    escFade.fill(0);
    // Spawn in a tight sphere so the neighbor graph starts connected.
    // Radius scales with cube root of count to keep density roughly constant.
    const spawnR = Math.cbrt(n) * 0.6;
    for (let i = 0; i < n; i++) {
      // uniform distribution inside a sphere
      const u = Math.random(), cosTheta = 2 * Math.random() - 1, sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
      const phi = Math.random() * Math.PI * 2;
      const r = spawnR * Math.cbrt(u);
      px[i] = r * sinTheta * Math.cos(phi);
      py[i] = r * sinTheta * Math.sin(phi);
      pz[i] = r * cosTheta;
    }
    // Common heading with small per-bird perturbation — looks like
    // joining an already-flying flock rather than an explosion.
    const hTheta = Math.random() * Math.PI * 2;
    const hPhi   = Math.acos(2 * Math.random() - 1);
    const baseVx = Math.sin(hPhi) * Math.cos(hTheta);
    const baseVy = Math.sin(hPhi) * Math.sin(hTheta);
    const baseVz = Math.cos(hPhi);
    const JITTER = 0.3;
    for (let i = 0; i < n; i++) {
      const minS = params.MAX_SPEED * 0.53;
      const spd = minS + Math.random() * (params.MAX_SPEED - minS) * 0.3;
      vx[i] = (baseVx + (Math.random() - 0.5) * JITTER) * spd;
      vy[i] = (baseVy + (Math.random() - 0.5) * JITTER) * spd;
      vz[i] = (baseVz + (Math.random() - 0.5) * JITTER) * spd;
    }
    // reset predator
    pred.active = false;
    if (predMesh) predMesh.visible = false;
    if (escSphere) escSphere.visible = false;

    if (instMesh) {
      instMesh.count = count;
      for (let i = 0; i < n; i++) instMesh.setColorAt(i, _defaultColor);
      if (instMesh.instanceColor) instMesh.instanceColor.needsUpdate = true;
      prevHighlight = -1;
    }
  }

  // ── Ground plane (fixed in world space — reveals flock movement) ────
  const GROUND_Y = -(BND.y - BND_MARGIN + 5); // just below soft boundary start
  {
    const SIZE = 2000, DIVS = 50;
    const canvas = document.createElement('canvas');
    canvas.width = DIVS; canvas.height = DIVS;
    const ctx = canvas.getContext('2d');
    for (let r = 0; r < DIVS; r++) {
      for (let c = 0; c < DIVS; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? '#12123a' : '#0e0e30';
        ctx.fillRect(c, r, 1, 1);
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(SIZE, SIZE),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = GROUND_Y;
    scene.add(plane);
  }

  // ── InstancedMesh ──────────────────────────────────────────────────
  const geo = new THREE.IcosahedronGeometry(0.15, 0);
  const mat = new THREE.MeshBasicMaterial({ color: 0xcccccc });
  const instMesh = new THREE.InstancedMesh(geo, mat, MAX_BIRDS);
  instMesh.count = 0;
  instMesh.frustumCulled = false; // instances are spread across scene; default culling uses base geometry's tiny bounding sphere
  scene.add(instMesh);

  const _mat4 = new THREE.Matrix4();
  const _defaultColor   = new THREE.Color(0xcccccc);
  const _highlightColor = new THREE.Color(0xf5d84a);
  const _savedColor     = new THREE.Color();
  let prevHighlight = -1;

  // ── Wireframe overlay for tracked boid in boid's-eye view ─────────
  // Slightly larger than the 0.15 boid so the boid's depth hides back edges
  const wireGeo = new THREE.IcosahedronGeometry(0.19, 0);
  const wireMat = new THREE.MeshBasicMaterial({
    color: 0xf5d84a, wireframe: true, wireframeLinewidth: 2, depthTest: true
  });
  const wireMesh = new THREE.Mesh(wireGeo, wireMat);
  wireMesh.visible = false;
  wireMesh.renderOrder = 999;
  scene.add(wireMesh);

  // ── Predator mesh ──────────────────────────────────────────────────
  const predGeo = new THREE.ConeGeometry(0.18, 0.5, 8);
  predGeo.rotateX(Math.PI / 2); // point along +Z
  const predMat = new THREE.MeshBasicMaterial({ color: 0xff2200 });
  const predMesh = new THREE.Mesh(predGeo, predMat);
  predMesh.visible = false;
  scene.add(predMesh);
  const _predLookTarget = new THREE.Vector3();

  // ── Escape radius sphere ─────────────────────────────────────────
  const escSphereGeo = new THREE.SphereGeometry(1, 16, 12); // unit sphere, scaled per frame
  const escSphereMat = new THREE.MeshBasicMaterial({
    color: 0xff0000, wireframe: true, transparent: true, opacity: 0.15,
  });
  const escSphere = new THREE.Mesh(escSphereGeo, escSphereMat);
  escSphere.visible = false;
  scene.add(escSphere);

  // ── Escape sphere visibility preference ──────────────────────────
  let _escSphereWanted = false;

  // ── Predator functions ────────────────────────────────────────────
  function activatePredator() {
    // Spawn on sphere biased upward, aimed at centroid
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 0.6); // bias toward upper hemisphere
    const r = 130;
    pred.x = centX + r * Math.sin(phi) * Math.cos(theta);
    pred.y = centY + r * Math.cos(phi); // biased upward
    pred.z = centZ + r * Math.sin(phi) * Math.sin(theta);
    // Initial velocity aimed at centroid
    const dx = centX - pred.x, dy = centY - pred.y, dz = centZ - pred.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const spd = params.MAX_SPEED * params.PRED_SPEED_PCT / 100;
    pred.vx = dx / d * spd; pred.vy = dy / d * spd; pred.vz = dz / d * spd;
    pred.active = true;
    predMesh.visible = true;
  }

  function deactivatePredator() {
    pred.active = false;
    predMesh.visible = false;
    if (escSphere) escSphere.visible = false;
  }

  function updatePredator(dt) {
    if (!params.PRED_ENABLED) {
      if (pred.active) deactivatePredator();
      return;
    }
    if (!pred.active) {
      activatePredator();
      return;
    }
    const mSpd = params.MAX_SPEED * params.PRED_SPEED_PCT / 100;
    const minSpd = mSpd * 0.5;

    // Always steer toward densest bird
    let targetX = centX, targetY = centY, targetZ = centZ;
    let bestND = -1;
    for (let i = 0; i < count; i++) {
      if (avgND[i] > bestND) { bestND = avgND[i]; targetX = px[i]; targetY = py[i]; targetZ = pz[i]; }
    }
    const dx = targetX - pred.x, dy = targetY - pred.y, dz = targetZ - pred.z;
    const mag = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (mag > 1e-6) {
      const s = mSpd / mag;
      const desVx = dx * s, desVy = dy * s, desVz = dz * s;
      let sx = desVx - pred.vx, sy = desVy - pred.vy, sz = desVz - pred.vz;
      const fm = Math.sqrt(sx * sx + sy * sy + sz * sz);
      if (fm > params.PRED_FORCE) {
        const c = params.PRED_FORCE / fm;
        sx *= c; sy *= c; sz *= c;
      }
      pred.vx += sx * dt; pred.vy += sy * dt; pred.vz += sz * dt;
    }

    // Clamp speed
    let spd = Math.sqrt(pred.vx * pred.vx + pred.vy * pred.vy + pred.vz * pred.vz);
    if (spd > mSpd) { const s = mSpd / spd; pred.vx *= s; pred.vy *= s; pred.vz *= s; spd = mSpd; }
    else if (spd < minSpd && spd > 1e-6) { const s = minSpd / spd; pred.vx *= s; pred.vy *= s; pred.vz *= s; }

    // Integrate position
    pred.x += pred.vx * dt; pred.y += pred.vy * dt; pred.z += pred.vz * dt;

    // Hard floor — same constraint as boids
    if (pred.y < GROUND_Y) {
      pred.y = GROUND_Y;
      if (pred.vy < 0) pred.vy = 0;
    }

    // Re-entry guard: if hawk drifts too far from flock, teleport back to entry sphere
    {
      const rx = pred.x - centX, ry = pred.y - centY, rz = pred.z - centZ;
      if (rx * rx + ry * ry + rz * rz > 250 * 250) {
        activatePredator();
        return;
      }
    }

    // Update mesh
    predMesh.position.set(pred.x, pred.y, pred.z);
    _predLookTarget.set(pred.x + pred.vx, pred.y + pred.vy, pred.z + pred.vz);
    predMesh.lookAt(_predLookTarget);

    // Update escape radius sphere
    if (_escSphereWanted) {
      escSphere.visible = true;
      escSphere.position.set(pred.x, pred.y, pred.z);
      const r = params.ESCAPE_RADIUS;
      escSphere.scale.set(r, r, r);
    }
  }

  const _densityColor = new THREE.Color();
  const _escapeColor  = new THREE.Color(1.0, 0.12, 0.05); // bright red for escape radius

  function updateDensityColors() {
    const lo = params.DENSITY_LO, hi = params.DENSITY_HI;
    const range = hi - lo || 1;
    for (let i = 0; i < count; i++) {
      // t=0 → sparse (blue), t=1 → dense (red)
      const t = Math.min(Math.max((avgND[i] - lo) / range, 0), 1);
      let r, g, b;
      if (t < 0.5) {
        const u = t * 2;
        r = 0.35 + u * 0.65;
        g = 0.55 + u * 0.45;
        b = 1.0 - u * 0.3;
      } else {
        const u = (t - 0.5) * 2;
        r = 1.0;
        g = 1.0 - u * 0.85;
        b = 0.7 - u * 0.65;
      }
      _densityColor.setRGB(r, g, b);
      instMesh.setColorAt(i, _densityColor);
    }
  }

  const _velColor = new THREE.Color();

  function updateVelocityColors() {
    const thresh = params.DV_THRESHOLD || 0.3;
    for (let i = 0; i < count; i++) {
      const spd = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]);
      const dv = spd - prevSpd[i];
      prevSpd[i] = spd;
      // t: -1 = braking, 0 = neutral, +1 = accelerating
      const t = Math.max(-1, Math.min(1, dv / thresh));
      let r, g, b;
      if (t < 0) {
        const u = -t;
        r = 0.7 + u * 0.3;
        g = 0.85 - u * 0.7;
        b = 1.0 - u * 0.95;
      } else {
        const u = t;
        r = 0.7 - u * 0.6;
        g = 0.85 + u * 0.05;
        b = 1.0 - u * 0.8;
      }
      _velColor.setRGB(r, g, b);
      instMesh.setColorAt(i, _velColor);
    }
  }

  let colorMode = 'none'; // 'none' | 'density' | 'velocity'
  function setColorMode(mode) { colorMode = mode; }

  const _scaleMat = new THREE.Matrix4();
  const HIGHLIGHT_SCALE = 3;

  function setTrackedBoidScale(scaled) {
    if (trackedBoid >= count) return;
    _mat4.makeTranslation(px[trackedBoid], py[trackedBoid], pz[trackedBoid]);
    if (scaled) {
      _scaleMat.makeScale(HIGHLIGHT_SCALE, HIGHLIGHT_SCALE, HIGHLIGHT_SCALE);
      _mat4.multiply(_scaleMat);
    }
    instMesh.setMatrixAt(trackedBoid, _mat4);
    instMesh.instanceMatrix.needsUpdate = true;
  }

  function updateInstances() {
    const scaleTracked = cameraMode === 'orbit' || cameraMode === 'split' || cameraMode === 'hawksplit';
    for (let i = 0; i < count; i++) {
      _mat4.makeTranslation(px[i], py[i], pz[i]);
      if (i === trackedBoid && scaleTracked) {
        _scaleMat.makeScale(HIGHLIGHT_SCALE, HIGHLIGHT_SCALE, HIGHLIGHT_SCALE);
        _mat4.multiply(_scaleMat);
      }
      instMesh.setMatrixAt(i, _mat4);
    }
    instMesh.instanceMatrix.needsUpdate = true;
  }

  // ── Spatial hash ───────────────────────────────────────────────────
  const hash = new SpatialHash();

  // ── Flock centroid ─────────────────────────────────────────────────
  // Computed from actual bird positions each frame — birds steer toward
  // the real center of mass, keeping the neighbor graph connected.
  let centX = 0, centY = 0, centZ = 0;

  function updateCentroid() {
    let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < count; i++) { sx += px[i]; sy += py[i]; sz += pz[i]; }
    const inv = 1 / (count || 1);
    centX = sx * inv; centY = sy * inv; centZ = sz * inv;
  }

  // ── Wind drift (disabled) ─────────────────────────────────────────
  // Wind was the original mechanism for net flock momentum — a uniform
  // global force applied to all birds. It was replaced by emergent
  // local-rule dynamics that achieve the same effect without a global
  // force. Preserved here in case it's useful for comparison or future
  // experimentation.
  //
  // let windX = 0, windY = 0, windZ = 0;
  // let windTX = 0, windTY = 0, windTZ = 0;
  // let windTimer = 0;
  // const WIND_STR = 0.25;
  //
  // function updateWind(dt) {
  //   windTimer -= dt;
  //   if (windTimer <= 0) {
  //     const theta = Math.random() * Math.PI * 2;
  //     const phi = Math.acos(2 * Math.random() - 1);
  //     windTX = Math.sin(phi) * Math.cos(theta) * WIND_STR;
  //     windTY = Math.sin(phi) * Math.sin(theta) * WIND_STR * 0.4;
  //     windTZ = Math.cos(phi) * WIND_STR;
  //     windTimer = 5 + Math.random() * 7;
  //   }
  //   const t = dt * 0.15;
  //   windX += (windTX - windX) * t;
  //   windY += (windTY - windY) * t;
  //   windZ += (windTZ - windZ) * t;
  // }

  // ── Boid update ────────────────────────────────────────────────────
  const _neighbors = new Int32Array(32);

  function updateBoids(dt) {
    // rebuild hash
    hash.clear();
    for (let i = 0; i < count; i++) hash.insert(i, px[i], py[i], pz[i]);

    // ── Escape fade update (before flocking forces) ──────────────────
    if (pred.active) {
      const escR = params.ESCAPE_RADIUS;
      const escR2 = escR * escR;
      const blendTime = Math.max(0.01, params.ESCAPE_BLEND);
      for (let i = 0; i < count; i++) {
        const edx = px[i] - pred.x, edy = py[i] - pred.y, edz = pz[i] - pred.z;
        const d2 = edx * edx + edy * edy + edz * edz;
        if (d2 < escR2) {
          escFade[i] = 1.0; // full panic
        } else {
          escFade[i] = Math.max(0, escFade[i] - dt / blendTime);
        }
      }
    } else {
      // Decay all escape fades when hawk inactive
      const blendTime = Math.max(0.01, params.ESCAPE_BLEND);
      for (let i = 0; i < count; i++) {
        if (escFade[i] > 0) escFade[i] = Math.max(0, escFade[i] - dt / blendTime);
      }
    }

    // ── Density count pass (pre-update — all positions are consistent) ──
    {
      const dr2 = params.DENSITY_RADIUS * params.DENSITY_RADIUS;
      for (let i = 0; i < count; i++) {
        const dc = hash.countInRadius(i, px[i], py[i], pz[i], dr2, px, py, pz);
        if (avgND[i] === 0) { avgND[i] = dc; }
        else {
          const k = dc < avgND[i] ? 0.3 : 0.1; // fast drop, slow rise
          avgND[i] = avgND[i] * (1 - k) + dc * k;
        }
      }
    }

    // Query the larger of the two neighbor counts; separation uses a subset
    const Nmax = Math.max(params.N_SEP, params.N_ALI_COH);
    const Nsep = params.N_SEP;
    const mSpd = params.MAX_SPEED, mFrc = params.MAX_FORCE;
    const minSpd = mSpd * params.MIN_SPEED_RATIO;

    for (let i = 0; i < count; i++) {
      const nLen = hash.findNearest(i, px[i], py[i], pz[i], Nmax, px, py, pz, _neighbors);
      if (nLen === 0) continue;

      const ef = escFade[i]; // escape factor for this boid

      // ── Separation (uses closest N_SEP neighbors) ─────────────────
      // Also track avg neighbor distance as a density proxy for centroid pull
      let sepAx = 0, sepAy = 0, sepAz = 0;
      let avgDist = 0;
      let ncX = 0, ncY = 0, ncZ = 0; // neighbor centroid accumulator
      const sepLen = Math.min(Nsep, nLen);
      {
        let sepX = 0, sepY = 0, sepZ = 0, sepCnt = 0;
        for (let j = 0; j < nLen; j++) {
          const ni = _neighbors[j];
          ncX += px[ni]; ncY += py[ni]; ncZ += pz[ni];
          const dx = px[i] - px[ni], dy = py[i] - py[ni], dz = pz[i] - pz[ni];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          avgDist += d;
          if (j < sepLen && d > 0 && d < SEP_DIST) {
            const inv = 1 / d;
            sepX += dx * inv; sepY += dy * inv; sepZ += dz * inv;
            sepCnt++;
          }
        }
        avgDist /= nLen;
        if (sepCnt > 0) {
          sepX /= sepCnt; sepY /= sepCnt; sepZ /= sepCnt;
          steerScalar(sepX, sepY, sepZ, vx[i], vy[i], vz[i], mSpd, mFrc);
          sepAx = _steer[0] * params.W_SEP; sepAy = _steer[1] * params.W_SEP; sepAz = _steer[2] * params.W_SEP;
        }
      }
      // Boundary detection: how far the neighbor centroid is offset from this bird
      ncX /= nLen; ncY /= nLen; ncZ /= nLen;
      const edX = ncX - px[i], edY = ncY - py[i], edZ = ncZ - pz[i];
      const edgeMag = Math.sqrt(edX * edX + edY * edY + edZ * edZ);
      const edgeSignal = avgDist > 0.01 ? Math.min(edgeMag / avgDist, 1) : 0;

      // ── Metric personal space (all nearby birds, not just topological N) ──
      const psR = params.PERSONAL_SPACE;
      let speedBrake = 0;
      if (psR > 0) {
        const psR2 = psR * psR;
        let psX = 0, psY = 0, psZ = 0, psCnt = 0;
        const nCand = hash._nCand;
        const candIdx = hash._candIdx, candD2 = hash._candD2;
        for (let j = 0; j < nCand; j++) {
          const cd2 = candD2[j];
          if (cd2 > 0 && cd2 < psR2) {
            const ci = candIdx[j];
            const dx = px[i] - px[ci], dy = py[i] - py[ci], dz = pz[i] - pz[ci];
            const d = Math.sqrt(cd2);
            const inv = 1 / d;
            psX += dx * inv; psY += dy * inv; psZ += dz * inv;
            psCnt++;
            const penetration = (psR - d) / psR;
            if (penetration > speedBrake) speedBrake = penetration;
          }
        }
        if (psCnt > 0) {
          psX /= psCnt; psY /= psCnt; psZ /= psCnt;
          steerScalar(psX, psY, psZ, vx[i], vy[i], vz[i], mSpd, mFrc);
          sepAx += _steer[0] * params.W_SEP; sepAy += _steer[1] * params.W_SEP; sepAz += _steer[2] * params.W_SEP;
        }
      }

      // ── Alignment (front/back hemisphere weighting) ─────────────────
      let aliAx = 0, aliAy = 0, aliAz = 0;
      {
        let aliX = 0, aliY = 0, aliZ = 0, aliW = 0;
        const fb = params.FRONT_BIAS;
        for (let j = 0; j < nLen; j++) {
          const ni = _neighbors[j];
          const dot = vx[i] * (px[ni] - px[i]) + vy[i] * (py[ni] - py[i]) + vz[i] * (pz[ni] - pz[i]);
          const w = dot > 0 ? fb : 1;
          aliX += vx[ni] * w; aliY += vy[ni] * w; aliZ += vz[ni] * w;
          aliW += w;
        }
        if (aliW > 0) { aliX /= aliW; aliY /= aliW; aliZ /= aliW; }
        steerScalar(aliX, aliY, aliZ, vx[i], vy[i], vz[i], mSpd, mFrc);
        const effectiveAli = params.W_ALI * (1 + edgeSignal * params.EDGE_ALI);
        aliAx = _steer[0] * effectiveAli; aliAy = _steer[1] * effectiveAli; aliAz = _steer[2] * effectiveAli;
      }

      // ── Cohesion (same front/back weighting) ──────────────────────
      let cohAx = 0, cohAy = 0, cohAz = 0;
      {
        let cohX = 0, cohY = 0, cohZ = 0, cohW = 0;
        const fb = params.FRONT_BIAS;
        for (let j = 0; j < nLen; j++) {
          const ni = _neighbors[j];
          const dot = vx[i] * (px[ni] - px[i]) + vy[i] * (py[ni] - py[i]) + vz[i] * (pz[ni] - pz[i]);
          const w = dot > 0 ? fb : 1;
          cohX += px[ni] * w; cohY += py[ni] * w; cohZ += pz[ni] * w;
          cohW += w;
        }
        if (cohW > 0) { cohX /= cohW; cohY /= cohW; cohZ /= cohW; }
        cohX -= px[i]; cohY -= py[i]; cohZ -= pz[i];
        steerScalar(cohX, cohY, cohZ, vx[i], vy[i], vz[i], mSpd, mFrc);
        cohAx = _steer[0] * params.W_COH; cohAy = _steer[1] * params.W_COH; cohAz = _steer[2] * params.W_COH;
      }

      // ── Combine flocking forces (escape-aware) ─────────────────────
      let ax, ay, az;
      let effectiveMaxSpd = mSpd, effectiveMinSpd = minSpd;

      if (ef > 0) {
        // Compute escape steering (direction away from predator)
        const edx = px[i] - pred.x, edy = py[i] - pred.y, edz = pz[i] - pred.z;
        const escMaxSpd = mSpd * params.ESCAPE_SPEED_PCT / 100;
        const escMaxFrc = mFrc * params.ESCAPE_ACCEL_MULT;
        steerScalar(edx, edy, edz, vx[i], vy[i], vz[i], escMaxSpd, escMaxFrc);
        const escAx = _steer[0], escAy = _steer[1], escAz = _steer[2];

        if (ef >= 1.0) {
          // Full escape: escape replaces cohesion + alignment
          if (params.CANCEL_SEP) {
            ax = escAx; ay = escAy; az = escAz;
          } else {
            ax = sepAx + escAx; ay = sepAy + escAy; az = sepAz + escAz;
          }
        } else {
          // Blend phase: lerp between normal flocking and escape
          const normalAx = sepAx + aliAx + cohAx;
          const normalAy = sepAy + aliAy + cohAy;
          const normalAz = sepAz + aliAz + cohAz;
          let escFullAx, escFullAy, escFullAz;
          if (params.CANCEL_SEP) {
            escFullAx = escAx; escFullAy = escAy; escFullAz = escAz;
          } else {
            escFullAx = sepAx + escAx; escFullAy = sepAy + escAy; escFullAz = sepAz + escAz;
          }
          ax = normalAx + (escFullAx - normalAx) * ef;
          ay = normalAy + (escFullAy - normalAy) * ef;
          az = normalAz + (escFullAz - normalAz) * ef;
        }

        // Boost effective max speed during escape
        effectiveMaxSpd = mSpd + (mSpd * params.ESCAPE_SPEED_PCT / 100 - mSpd) * ef;
        effectiveMinSpd = minSpd; // keep same min
      } else {
        // Normal flocking (no escape)
        ax = sepAx + aliAx + cohAx;
        ay = sepAy + aliAy + cohAy;
        az = sepAz + aliAz + cohAz;
      }

      // ── Seek flock centroid (adaptive: isolated birds pull harder) ──
      {
        const dx = centX - px[i], dy = centY - py[i], dz = centZ - pz[i];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > 2.5) {
          const isolation = Math.min(Math.max((avgDist - 2) / 6, 0), 1);
          const pullW = 0.05 + isolation * params.HOMING;
          const inv = pullW / dist;
          ax += dx * inv; ay += dy * inv; az += dz * inv;
        }
      }

      // ── Boundary ───────────────────────────────────────────────────
      const bx = BND.x - BND_MARGIN, by = BND.y - BND_MARGIN, bz = BND.z - BND_MARGIN;
      if (px[i] > bx)       ax -= BND_K * ((px[i] - bx) / BND_MARGIN) * ((px[i] - bx) / BND_MARGIN);
      else if (px[i] < -bx) ax += BND_K * (((-bx) - px[i]) / BND_MARGIN) * (((-bx) - px[i]) / BND_MARGIN);
      if (py[i] > by)       ay -= BND_K * ((py[i] - by) / BND_MARGIN) * ((py[i] - by) / BND_MARGIN);
      if (pz[i] > bz)       az -= BND_K * ((pz[i] - bz) / BND_MARGIN) * ((pz[i] - bz) / BND_MARGIN);
      else if (pz[i] < -bz) az += BND_K * (((-bz) - pz[i]) / BND_MARGIN) * (((-bz) - pz[i]) / BND_MARGIN);

      // ── Ground floor (keep birds above the checkerboard) ─────────
      const GND_MARGIN = BND_MARGIN * 2; // 40 units — start turning early
      if (py[i] < GROUND_Y + GND_MARGIN) {
        const depth = (GROUND_Y + GND_MARGIN - py[i]) / GND_MARGIN;
        const groundK = BND_K * (mSpd / 15) * 3;
        ay += groundK * depth * depth;
        if (vy[i] < 0) {
          ay -= vy[i] * depth * 0.5;
        }
      }

      // ── Integrate ──────────────────────────────────────────────────
      vx[i] += ax * dt; vy[i] += ay * dt; vz[i] += az * dt;

      // clamp speed (escape-aware limits)
      let spd = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]);
      if (spd > effectiveMaxSpd)                   { const s = effectiveMaxSpd / spd; vx[i] *= s; vy[i] *= s; vz[i] *= s; }
      else if (spd < effectiveMinSpd && spd > 1e-6) { const s = effectiveMinSpd / spd; vx[i] *= s; vy[i] *= s; vz[i] *= s; }

      // ── Speed braking from personal space violations ──────────────
      if (speedBrake > 0 && params.W_SPEED_SEP > 0) {
        const scale = Math.max(0.01, 1 - params.W_SPEED_SEP * speedBrake);
        vx[i] *= scale; vy[i] *= scale; vz[i] *= scale;
      }

      px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;

      // Hard floor — safety net
      if (py[i] < GROUND_Y) {
        py[i] = GROUND_Y;
        if (vy[i] < 0) vy[i] = 0;
      }
    }
  }

  // ── Camera mode ──────────────────────────────────────────────────
  let cameraMode = 'orbit';   // 'orbit' | 'boidseye' | 'split' | 'hawkeye' | 'hawksplit'
  let trackedBoid = 0;

  function pickNewBoid() {
    trackedBoid = Math.floor(Math.random() * count);
  }

  function setCameraMode(mode) {
    const prev = cameraMode;
    cameraMode = mode;
    if (mode === 'boidseye') {
      pickNewBoid();
    } else if (mode === 'split') {
      if (prev !== 'boidseye' || trackedBoid >= count) pickNewBoid();
    }
    if (mode === 'split' || mode === 'hawksplit') {
      const vp = getSplitViewports();
      camera.aspect = vp.leftW / vp.h;
      camera.updateProjectionMatrix();
      chaseCam.aspect = vp.rightW / vp.h;
      chaseCam.updateProjectionMatrix();
    } else {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    }
  }

  // ── Hawk's-eye camera positioning ─────────────────────────────────
  function positionHawkCam(cam) {
    const pvx = pred.vx, pvy = pred.vy, pvz = pred.vz;
    const spd = Math.sqrt(pvx * pvx + pvy * pvy + pvz * pvz);
    const inv = spd > 1e-6 ? 1 / spd : 0;
    const nx = pvx * inv, ny = pvy * inv, nz = pvz * inv;
    cam.position.x = pred.x - nx * 3;
    cam.position.y = pred.y - ny * 3 + 0.5;
    cam.position.z = pred.z - nz * 3;
    cam.lookAt(pred.x + nx * 8, pred.y + ny * 8, pred.z + nz * 8);
  }

  // ── Camera positioning helpers ──────────────────────────────────────
  function positionOrbitCam(cam) {
    const orbitR = 20 + Math.cbrt(count) * 3;
    const orbitSpeed = 0.03;
    cam.position.x = centX + Math.sin(elapsed * orbitSpeed) * orbitR;
    cam.position.z = centZ + Math.cos(elapsed * orbitSpeed) * orbitR;
    cam.position.y = centY + Math.sin(elapsed * 0.05) * 8;
    if (cam.position.y < GROUND_Y + 5) cam.position.y = GROUND_Y + 5;
    cam.lookAt(centX, centY, centZ);
  }

  function positionChaseCam(cam) {
    const bi = trackedBoid;
    const bvx = vx[bi], bvy = vy[bi], bvz = vz[bi];
    const spd = Math.sqrt(bvx * bvx + bvy * bvy + bvz * bvz);
    const inv = spd > 1e-6 ? 1 / spd : 0;
    const nx = bvx * inv, ny = bvy * inv, nz = bvz * inv;
    cam.position.x = px[bi] - nx * 1.5;
    cam.position.y = py[bi] - ny * 1.5 + 0.3;
    cam.position.z = pz[bi] - nz * 1.5;
    cam.lookAt(px[bi] + nx * 5, py[bi] + ny * 5, pz[bi] + nz * 5);
  }

  // ── Animate ────────────────────────────────────────────────────────
  const clock = new THREE.Clock();
  let elapsed = 0;

  reinit(params.COUNT);
  updateInstances();

  function animate() {
    requestAnimationFrame(animate);

    let rawDt = clock.getDelta();
    if (rawDt > 0.05) rawDt = 0.05;
    const dt = rawDt * params.SIM_SPEED;
    elapsed += rawDt;

    // flock centroid (O(n), used by seek-center force)
    updateCentroid();

    // predator (must run after centroid, before boids)
    updatePredator(dt);

    // wind drift (disabled)
    // updateWind(dt);

    // boid sim
    updateBoids(dt);

    // write instance matrices
    updateInstances();

    // per-bird coloring
    if (colorMode === 'velocity') {
      updateVelocityColors(); // also updates prevSpd
    } else if (colorMode === 'density') {
      updateDensityColors();
    } else {
      for (let i = 0; i < count; i++) instMesh.setColorAt(i, _defaultColor);
    }
    // keep prevSpd current even when not displaying velocity colors
    if (colorMode !== 'velocity') {
      for (let i = 0; i < count; i++) {
        prevSpd[i] = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]);
      }
    }

    // Override: bright red for boids currently inside the escape radius
    if (pred.active && _escSphereWanted) {
      for (let i = 0; i < count; i++) {
        if (escFade[i] >= 1.0) instMesh.setColorAt(i, _escapeColor);
      }
    }

    // ── Tracked boid helpers ─────────────────────────────────────────
    if (trackedBoid >= count) pickNewBoid();

    // Save tracked boid's coloring-pass color before any yellow override
    if (trackedBoid < count && instMesh.instanceColor) {
      instMesh.getColorAt(trackedBoid, _savedColor);
    }

    if (cameraMode === 'split' || cameraMode === 'hawksplit') {
      // ── SPLIT MODE — two render passes ────────────────────────────
      const vp = getSplitViewports();
      const isHawkSplit = cameraMode === 'hawksplit';

      renderer.autoClear = false;
      renderer.setScissorTest(true);

      // PASS 1 — Left half (Orbit)
      // Yellow tracked boid, no wireframe
      if (trackedBoid < count) {
        instMesh.setColorAt(trackedBoid, _highlightColor);
        if (instMesh.instanceColor) instMesh.instanceColor.needsUpdate = true;
      }
      wireMesh.visible = false;

      positionOrbitCam(camera);

      renderer.setViewport(0, 0, vp.leftW, vp.h);
      renderer.setScissor(0, 0, vp.leftW, vp.h);
      renderer.clear();
      renderer.render(scene, camera);

      // PASS 2 — Right half (Boid's Eye or Hawk's Eye)
      if (!isHawkSplit && trackedBoid < count) {
        // Boid's eye right half
        if (colorMode !== 'none') {
          instMesh.setColorAt(trackedBoid, _savedColor);
          wireMesh.position.set(px[trackedBoid], py[trackedBoid], pz[trackedBoid]);
          wireMesh.visible = true;
        } else {
          instMesh.setColorAt(trackedBoid, _highlightColor);
          wireMesh.visible = false;
        }
        setTrackedBoidScale(false);
        if (instMesh.instanceColor) instMesh.instanceColor.needsUpdate = true;
      }

      if (isHawkSplit && pred.active) {
        positionHawkCam(chaseCam);
      } else {
        positionChaseCam(chaseCam);
      }

      renderer.setViewport(vp.leftW, 0, vp.rightW, vp.h);
      renderer.setScissor(vp.leftW, 0, vp.rightW, vp.h);
      renderer.clear();
      renderer.render(scene, chaseCam);

      // Cleanup — restore for next frame
      if (trackedBoid < count) {
        setTrackedBoidScale(true);
      }
      wireMesh.visible = false;
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
      renderer.autoClear = true;

    } else {
      // ── NON-SPLIT — single render pass ────────────────────────────
      // highlight tracked boid
      if (trackedBoid < count) {
        if (cameraMode === 'boidseye' && colorMode !== 'none') {
          wireMesh.position.set(px[trackedBoid], py[trackedBoid], pz[trackedBoid]);
          wireMesh.visible = true;
        } else {
          instMesh.setColorAt(trackedBoid, _highlightColor);
          wireMesh.visible = false;
        }
        prevHighlight = trackedBoid;
      }
      if (instMesh.instanceColor) instMesh.instanceColor.needsUpdate = true;

      if (cameraMode === 'boidseye') {
        positionChaseCam(camera);
      } else if (cameraMode === 'hawkeye' && pred.active) {
        positionHawkCam(camera);
      } else {
        positionOrbitCam(camera);
      }

      renderer.render(scene, camera);
    }
  }

  animate();

  // public API
  function setEscSphereVisible(v) {
    _escSphereWanted = v;
    escSphere.visible = v && pred.active;
  }

  return { reinit, setCameraMode, pickNewBoid, setColorMode, setPanelOpen, pred, setEscSphereVisible, activatePredator, deactivatePredator };
}
