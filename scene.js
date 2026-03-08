import * as THREE from 'three';
import { FontLoader   } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { GLTFLoader   } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { LineSegments2       } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial        } from 'three/addons/lines/LineMaterial.js';

// ── TUNABLE DEFAULTS ──────────────────────────────────────────────────────────
// Used for playground reset and as initial values for index.html.
// NUM_FISH and BND are not here — they require a scene restart to change.
export const DEFAULTS = {
  SEP_R:      7.5,   // separation radius
  ALI_R:      6.5,   // alignment radius
  COH_R:     10.0,   // cohesion radius
  W_SEP:      5.0,   // separation weight
  W_ALI:      1.5,   // alignment weight
  W_COH:      1.2,   // cohesion weight
  TURN_TANG:  4.0,   // blue tang max turn rate (rad/s)
  TURN_TF:    5.0,   // triggerfish max turn rate (rad/s)
  DAMP_Y:     0.20,  // vertical acceleration damping
  DAMP_Z:     0.50,  // depth acceleration damping
  SIM_SPEED:    1.0,   // simulation time-scale multiplier
  SHOW_FISH:    true,  // show fish models
  SHOW_SPHERES: false, // show separation radius wireframe spheres
  SHOW_LINES:   false, // show inter-boid distance lines (red/yellow/green)
  SHOW_TITLE:   true,  // show floating 3D title
};

// ── INIT ──────────────────────────────────────────────────────────────────────
// container: DOM element to append the canvas to (usually document.body)
// params:    object with tunable values — mutated in place by sliders each frame
export function initScene(container, params, { title = "Steve's Site" } = {}) {

// ── LOADING OVERLAY ───────────────────────────────────────────────────────────
let _loadedCount = 0;
function checkAllLoaded() {
  if (++_loadedCount >= 2) {
    const el = document.getElementById('loader');
    if (el) {
      el.classList.add('fade-out');
      setTimeout(() => el.remove(), 950);
    }
  }
}

// ── RENDERER ──────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping         = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace    = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

// ── SCENE — tropical teal-blue water ─────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x001e2a);
scene.fog = new THREE.FogExp2(0x003344, 0.022);

// ── CAMERA ────────────────────────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 0, 38);

// ── LIGHTS ────────────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0x0d3d4a, 5.5));

const sun = new THREE.DirectionalLight(0xc0eeff, 4.0);
sun.position.set(8, 30, 10);
scene.add(sun);

const waveLight1 = new THREE.PointLight(0x00ddee, 7.5, 45);
const waveLight2 = new THREE.PointLight(0x0099bb, 5.5, 35);
scene.add(waveLight1, waveLight2);

// ── WAVE-REFRACTION LIGHT SHAFTS ─────────────────────────────────────────────
const SHAFT_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SHAFT_FRAG = /* glsl */`
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float r    = abs(vUv.x * 2.0 - 1.0);
    float edge = pow(1.0 - r, 2.5);
    float fade = smoothstep(0.0, 0.85, vUv.y);
    float alpha = edge * fade * uOpacity;
    gl_FragColor = vec4(vec3(0.20, 0.87, 1.0) * alpha, alpha);
  }
`;
const shafts = [];
for (let i = 0; i < 16; i++) {
  const height = 70 + Math.random() * 20;
  const width  = 2.5 + Math.random() * 6.0;
  const opacityUnif = { value: 0 };
  const group = new THREE.Group();
  for (let p = 0; p < 2; p++) {
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.ShaderMaterial({
        vertexShader: SHAFT_VERT, fragmentShader: SHAFT_FRAG,
        uniforms: { uOpacity: opacityUnif },
        transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      }),
    );
    plane.rotation.y = p * Math.PI * 0.5;
    group.add(plane);
  }
  group.position.set(
    (Math.random() - 0.5) * 44,
    35 - height * 0.5 + Math.random() * 6,
    (Math.random() - 0.5) * 16,
  );
  group.rotation.z = (Math.random() - 0.5) * 0.20;
  group.rotation.x = (Math.random() - 0.5) * 0.08;
  group.userData.base       = 0.10 + Math.random() * 0.12;
  group.userData.phase      = Math.random() * Math.PI * 2;
  group.userData.speed      = 0.22 + Math.random() * 0.28;
  group.userData.drift      = 0.18 + Math.random() * 0.14;
  group.userData.initX      = group.position.x;
  group.userData.driftP     = Math.random() * Math.PI * 2;
  group.userData.opacityUnif = opacityUnif;
  scene.add(group);
  shafts.push(group);
}

// ── FLOATING PARTICLES (marine snow) ─────────────────────────────────────────
{
  const N = 420, p = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    p[i*3]   = (Math.random() - 0.5) * 80;
    p[i*3+1] = (Math.random() - 0.5) * 32;
    p[i*3+2] = (Math.random() - 0.5) * 24;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({
    color: 0x66eeff, size: 0.05, transparent: true, opacity: 0.30, depthWrite: false,
  })));
}

// ── SHARED CAUSTIC GLSL ───────────────────────────────────────────────────────
const causticUniforms = { uTime: { value: 0 } };

const CAUSTIC_GLSL = /* glsl */`
  vec2 c_hash(vec2 p) {
    return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453);
  }
  float c_voro(vec2 x, float t) {
    vec2 n=floor(x), f=fract(x); float m=8.0;
    for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
      vec2 g=vec2(i,j);
      vec2 o=0.5+0.45*sin(t+6.28318*c_hash(n+g));
      m=min(m,length(g+o-f));
    }
    return m;
  }
  float caustics(vec2 p, float t){
    float c1=c_voro(p*2.8,             t*0.48);
    float c2=c_voro(p*4.3+vec2(1.7,3.3), t*0.65);
    return clamp(
      pow(1.0-smoothstep(0.0,0.22,c1-0.28),3.0)+
      pow(1.0-smoothstep(0.0,0.22,c2-0.28),2.0)*0.42,
      0.0,1.0);
  }
`;

// ── PROCEDURAL BLUE TANG FALLBACK ────────────────────────────────────────────
const blueTangMat = new THREE.MeshStandardMaterial({
  color: 0x1a6fa8, roughness: 0.45, metalness: 0.12,
});
const tailMat = new THREE.MeshStandardMaterial({
  color: 0xe8c020, roughness: 0.50, metalness: 0.05,
});
const finMat = new THREE.MeshStandardMaterial({
  color: 0x0d4a72, roughness: 0.60, metalness: 0.0,
  transparent: true, opacity: 0.80, side: THREE.DoubleSide,
});
const eyeMat = new THREE.MeshStandardMaterial({ color: 0x060606, roughness: 0.2 });

function createProceduralBlueTang() {
  const g = new THREE.Group();

  const bodyGeo = new THREE.SphereGeometry(1, 20, 14);
  bodyGeo.applyMatrix4(new THREE.Matrix4().makeScale(1.30, 0.88, 0.36));
  bodyGeo.computeVertexNormals();
  g.add(new THREE.Mesh(bodyGeo, blueTangMat));

  const tailGroup = new THREE.Group();
  tailGroup.position.x = -1.22;
  [1, -1].forEach(s => {
    const sh = new THREE.Shape();
    sh.moveTo(0, 0);
    sh.lineTo(-0.85, 0.07 * s);
    sh.bezierCurveTo(-0.70, 0.48 * s, -0.38, 0.68 * s, -0.08, 0.78 * s);
    sh.closePath();
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.04, bevelEnabled: false });
    geo.computeVertexNormals();
    tailGroup.add(new THREE.Mesh(geo, tailMat));
  });
  g.add(tailGroup);
  g.userData.tailGroup = tailGroup;

  const dorsalSh = new THREE.Shape();
  dorsalSh.moveTo(-0.55, 0); dorsalSh.lineTo(0.48, 0);
  dorsalSh.bezierCurveTo(0.28, 0.48, -0.18, 0.68, -0.55, 0);
  const dorsal = new THREE.Mesh(
    new THREE.ExtrudeGeometry(dorsalSh, { depth: 0.03, bevelEnabled: false }),
    finMat,
  );
  dorsal.position.set(0, 0.85, -0.015);
  g.add(dorsal);

  const analSh = new THREE.Shape();
  analSh.moveTo(-0.28, 0); analSh.lineTo(0.28, 0);
  analSh.bezierCurveTo(0.10, -0.38, -0.18, -0.48, -0.28, 0);
  const anal = new THREE.Mesh(
    new THREE.ExtrudeGeometry(analSh, { depth: 0.03, bevelEnabled: false }),
    finMat,
  );
  anal.position.set(-0.08, -0.83, -0.015);
  g.add(anal);

  const pectSh = new THREE.Shape();
  pectSh.moveTo(0, 0); pectSh.lineTo(0.58, -0.10);
  pectSh.bezierCurveTo(0.68, 0.18, 0.38, 0.42, 0, 0.28);
  pectSh.closePath();
  [0.34, -0.34].forEach(z => {
    const geo = new THREE.ExtrudeGeometry(pectSh, { depth: 0.025, bevelEnabled: false });
    geo.computeVertexNormals();
    const fin = new THREE.Mesh(geo, finMat);
    fin.position.set(0.52, -0.04, z);
    fin.rotation.y = z > 0 ? 0.28 : -0.28;
    g.add(fin);
  });

  const eGeo = new THREE.SphereGeometry(0.058, 8, 6);
  [1, -1].forEach(s => {
    const eye = new THREE.Mesh(eGeo, eyeMat);
    eye.position.set(0.90, 0.24, 0.30 * s);
    g.add(eye);
  });

  g.scale.setScalar(0.72);
  return g;
}

// ── BOIDS — SCHOOLING ─────────────────────────────────────────────────────────
const NUM_FISH  = 10;
const BND       = { x: 13, y: 6, z: 5 };
const MAX_SPEED = 3.0, MIN_SPEED = 1.5, MAX_FORCE = 0.22;
const TF_FLEE_R = 9.0;
const TF_W_FLEE = 4.5;

const schoolCenter = new THREE.Vector3(0, 0, 0);
const schoolTarget = new THREE.Vector3(0, 0, 0);
let schoolDriftTimer = 0;

let FISH_FORWARD = new THREE.Vector3(1, 0, 0);

const MODEL_ROLL = new THREE.Quaternion()
  .setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(-3));
const TF_ROLL = new THREE.Quaternion()
  .setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(180));

// Pre-allocated temps
const _fwd     = new THREE.Vector3();
const _m4      = new THREE.Matrix4();
const _qTarget = new THREE.Quaternion();
const _origin  = new THREE.Vector3(0, 0, 0);
const _worldUp = new THREE.Vector3(0, 1, 0);
const _tmp     = new THREE.Vector3();
const _aliSum  = new THREE.Vector3();
const _cohSum  = new THREE.Vector3();
const _flee    = new THREE.Vector3();
const _sideUp  = new THREE.Vector3(1, 0, 0);
const _blendUp = new THREE.Vector3();

const _markerGeo = new THREE.SphereGeometry(0.45, 12, 8);
const _markerMat = new THREE.MeshStandardMaterial({ color: 0x7dd4e8, roughness: 0.35, metalness: 0.15 });

class Boid {
  constructor() {
    this.pos = new THREE.Vector3(
      (Math.random() - 0.5) * BND.x,
      (Math.random() - 0.5) * BND.y,
      (Math.random() - 0.5) * BND.z,
    );
    const ang = Math.random() * Math.PI * 2;
    const spd = MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED);
    this.vel  = new THREE.Vector3(Math.cos(ang) * spd, (Math.random() - 0.5) * 0.3, Math.sin(ang) * spd * 0.4);
    this.vel.clampLength(MIN_SPEED, MAX_SPEED);
    this.acc  = new THREE.Vector3();
    this.ownQ    = new THREE.Quaternion();
    this.targetQ = new THREE.Quaternion();
    this.mesh  = createProceduralBlueTang();
    this.mesh.userData.phase = Math.random() * Math.PI * 2;
    this.mesh.visible = false;
    scene.add(this.mesh);

    this.marker = new THREE.Mesh(_markerGeo, _markerMat);
    this.marker.visible = false;
    scene.add(this.marker);
  }

  steer(desired) {
    return desired.normalize().multiplyScalar(MAX_SPEED).sub(this.vel).clampLength(0, MAX_FORCE);
  }
  separate(boids) {
    const s = new THREE.Vector3(); let n = 0;
    for (const b of boids) {
      if (b === this) continue;
      const d = this.pos.distanceTo(b.pos);
      if (d > 0 && d < params.SEP_R) {
        s.add(_tmp.subVectors(this.pos, b.pos).normalize().divideScalar(d));
        n++;
      }
    }
    return n ? this.steer(s.divideScalar(n)) : s;
  }
  align(boids) {
    const s = _aliSum.set(0,0,0); let n = 0;
    for (const b of boids) if (b !== this && this.pos.distanceTo(b.pos) < params.ALI_R) { s.add(b.vel); n++; }
    return n ? this.steer(s.divideScalar(n)) : s;
  }
  cohere(boids) {
    const s = _cohSum.set(0,0,0); let n = 0;
    for (const b of boids) if (b !== this && this.pos.distanceTo(b.pos) < params.COH_R) { s.add(b.pos); n++; }
    return n ? this.steer(s.divideScalar(n).sub(this.pos)) : s;
  }
  seekCenter() {
    const desired = new THREE.Vector3().subVectors(schoolCenter, this.pos);
    const d = desired.length();
    if (d < 2.5) return new THREE.Vector3();
    return this.steer(desired).multiplyScalar(0.55);
  }
  boundary() {
    const f = new THREE.Vector3(), k = 0.18, margin = 4;
    const push = (v, b) => v > b-margin ? -k*(v-(b-margin))/margin : v < -b+margin ? k*(-b+margin-v)/margin : 0;
    f.x = push(this.pos.x, BND.x);
    f.y = push(this.pos.y, BND.y);
    f.z = push(this.pos.z, BND.z);
    return f;
  }
  flee() {
    if (!tf.active || !tf.mesh) return _flee.set(0, 0, 0);
    const d = this.pos.distanceTo(tf.pos);
    if (d > TF_FLEE_R) return _flee.set(0, 0, 0);
    return _flee.subVectors(this.pos, tf.pos).normalize()
      .multiplyScalar((1.0 - d / TF_FLEE_R) * MAX_SPEED);
  }

  update(boids, dt, elapsed) {
    this.acc.set(0, 0, 0)
      .addScaledVector(this.separate(boids), params.W_SEP)
      .addScaledVector(this.align(boids),    params.W_ALI)
      .addScaledVector(this.cohere(boids),   params.W_COH)
      .add(this.seekCenter())
      .add(this.boundary())
      .addScaledVector(this.flee(), TF_W_FLEE);
    this.acc.y *= params.DAMP_Y;
    this.acc.z *= params.DAMP_Z;

    this.vel.addScaledVector(this.acc, dt).clampLength(MIN_SPEED, MAX_SPEED);
    this.pos.addScaledVector(this.vel, dt);

    this.mesh.position.copy(this.pos);
    this.mesh.position.y += 0.10 * Math.sin(elapsed * 2.4 + this.mesh.userData.phase);

    if (this.vel.lengthSq() > 0.2) {
      _fwd.copy(this.vel).normalize();
      const t = THREE.MathUtils.smoothstep(Math.abs(_fwd.y), 0.5, 0.95);
      _blendUp.lerpVectors(_worldUp, _sideUp, t).normalize();
      _m4.lookAt(_origin, _fwd, _blendUp);
      _qTarget.setFromRotationMatrix(_m4).multiply(MODEL_ROLL);
      const targetAlpha = THREE.MathUtils.lerp(0.95, 0.04, t);
      this.targetQ.slerp(_qTarget, targetAlpha);
      this.ownQ.rotateTowards(this.targetQ, dt * params.TURN_TANG * (1 - t * 0.90));
      this.mesh.quaternion.copy(this.ownQ);
    }

    if (this.mesh.userData.tailGroup) {
      const spd = this.vel.length() / MAX_SPEED;
      this.mesh.userData.tailGroup.rotation.z =
        Math.sin(elapsed * 3.4 + this.mesh.userData.phase) * 0.26 * (0.5 + spd * 0.5);
    }
  }
}

const boids = Array.from({ length: NUM_FISH }, () => new Boid());

// ── SEPARATION SPHERES ────────────────────────────────────────────────────────
const _sphereWireGeo = new THREE.WireframeGeometry(new THREE.SphereGeometry(1, 12, 8));
const _sphereMat = new THREE.LineBasicMaterial({ color: 0x7dd4e8, transparent: true, opacity: 0.25 });
const sepSpheres = boids.map(() => {
  const s = new THREE.LineSegments(_sphereWireGeo, _sphereMat);
  s.visible = false;
  scene.add(s);
  return s;
});

// ── INTER-BOID DISTANCE LINES ─────────────────────────────────────────────────
// tang-tang pairs + tang-triggerfish pairs
const MAX_PAIRS   = NUM_FISH * (NUM_FISH - 1) / 2 + NUM_FISH;
const _linePosArr = new Float32Array(MAX_PAIRS * 6); // x1y1z1 x2y2z2 per segment
const _lineColArr = new Float32Array(MAX_PAIRS * 6); // r1g1b1 r2g2b2 per segment
const _linesGeo   = new LineSegmentsGeometry();
_linesGeo.setPositions(_linePosArr);
_linesGeo.setColors(_lineColArr);
const _linesMat = new LineMaterial({
  vertexColors: true,
  linewidth: 3,          // pixels — actual thick lines
  transparent: true,
  opacity: 0.85,
  resolution: new THREE.Vector2(innerWidth, innerHeight),
});
// Strip fog and tone mapping from the shader — property flags aren't reliable
// for LineMaterial; this is the only bulletproof approach.
_linesMat.onBeforeCompile = (shader) => {
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <tonemapping_fragment>', '')
    .replace('#include <fog_fragment>',         '');
};
const linesObj = new LineSegments2(_linesGeo, _linesMat);
linesObj.frustumCulled = false;
linesObj.visible = false;
scene.add(linesObj);

// ── TRIGGERFISH — SOLO TRAVERSAL ─────────────────────────────────────────────
const tf = {
  mesh:     null,
  mixer:    null,
  pos:      new THREE.Vector3(0, -100, 0),
  vel:      new THREE.Vector3(1, 0, 0),
  ownQ:     new THREE.Quaternion(),
  targetQ:  new THREE.Quaternion(),
  active:   false,
  timer:    8 + Math.random() * 4,
  startPos: new THREE.Vector3(),
  endPos:   new THREE.Vector3(),
  ctrlPos:  new THREE.Vector3(),
  t:        0,
  duration: 1,
  marker:   null,
};
const _tfMarkerMat = new THREE.MeshStandardMaterial({ color: 0xe8a020, roughness: 0.35, metalness: 0.15 });
tf.marker = new THREE.Mesh(_markerGeo, _tfMarkerMat);
tf.marker.visible = false;
scene.add(tf.marker);

function startTriggerPass() {
  const fromLeft = Math.random() < 0.5;
  tf.startPos.set(
    fromLeft ? -42 : 42,
    (Math.random() - 0.5) * 8,
    (Math.random() - 0.5) * 28,
  );
  tf.endPos.set(
    fromLeft ? 42 : -42,
    (Math.random() - 0.5) * 8,
    (Math.random() - 0.5) * 28,
  );
  tf.ctrlPos.set(
    0,
    (tf.startPos.y + tf.endPos.y) * 0.5 + (Math.random() - 0.5) * 5,
    (tf.startPos.z + tf.endPos.z) * 0.5 + (Math.random() - 0.5) * 24,
  );
  const pathLen = tf.startPos.distanceTo(tf.ctrlPos) + tf.ctrlPos.distanceTo(tf.endPos);
  tf.duration = pathLen / 1.7;
  tf.t = 0;
  tf.active = true;
  tf.pos.copy(tf.startPos);
  if (tf.mesh) tf.mesh.position.copy(tf.startPos);
}

// ── GLB MODEL LOADERS ─────────────────────────────────────────────────────────
const texLoader = new THREE.TextureLoader();
const aoTex = texLoader.load('./Blue_Tang_Fish_AO.png');
const mrTex = texLoader.load('./Blue_Tang_Fish_Metallic_Roughness.png');
aoTex.colorSpace = mrTex.colorSpace = THREE.LinearSRGBColorSpace;

new GLTFLoader().load('./blue_tang.glb', (gltf) => {
  const template = gltf.scene;

  const box  = new THREE.Box3().setFromObject(template);
  const size = box.getSize(new THREE.Vector3());
  const sc   = 1.8 / Math.max(size.x, size.y, size.z);
  const ctr  = box.getCenter(new THREE.Vector3());
  template.scale.setScalar(sc);
  template.position.sub(ctr.multiplyScalar(sc));

  FISH_FORWARD = new THREE.Vector3(0, 0, -1);

  const localBox = new THREE.Box3();
  template.traverse(child => {
    if (child.isMesh && child.geometry) {
      child.geometry.computeBoundingBox();
      const gb = child.geometry.boundingBox;
      if (gb && !gb.isEmpty()) localBox.union(gb);
    }
  });
  const bMin = localBox.isEmpty() ? -1 : localBox.min.z;
  const bMax = localBox.isEmpty() ?  1 : localBox.max.z;

  for (const boid of boids) {
    const phase = boid.mesh.userData.phase;
    scene.remove(boid.mesh);

    const clone = SkeletonUtils.clone(template);
    clone.userData.phase = phase;
    clone.traverse(child => {
      child.frustumCulled = false;
      child.visible = true;
      if (!child.isMesh) return;

      if (child.geometry?.attributes.uv && !child.geometry.attributes.uv1)
        child.geometry.setAttribute('uv1', child.geometry.attributes.uv);

      const wasArray  = Array.isArray(child.material);
      const mats      = wasArray ? child.material : [child.material];
      const phaseUnif = { value: phase };
      const newMats   = mats.map(mat => {
        if (!mat) return mat;
        const m = mat.clone();
        m.aoMap = aoTex; m.aoMapIntensity = 0.85;
        m.roughnessMap = mrTex; m.metalnessMap = mrTex;
        m.needsUpdate = true;
        m.onBeforeCompile = shader => {
          shader.uniforms.uSwimTime  = causticUniforms.uTime;
          shader.uniforms.uSwimPhase = phaseUnif;
          shader.uniforms.uBMin      = { value: bMin };
          shader.uniforms.uBMax      = { value: bMax };
          shader.vertexShader = shader.vertexShader
            .replace('void main() {',
              `uniform float uSwimTime, uSwimPhase, uBMin, uBMax;
void main() {`)
            .replace('#include <begin_vertex>',
              `#include <begin_vertex>
  float _u = clamp((transformed.z - uBMin) / max(uBMax - uBMin, 0.001), 0.0, 1.0);
  transformed.x += sin(uSwimTime * 2.4 + uSwimPhase + _u * 3.14159) * 0.42 * _u * _u;`);
        };
        return m;
      });
      child.material = wasArray ? newMats : newMats[0];
    });

    boid.mesh = clone;
    boid.mesh.userData.ready = true;
    scene.add(clone);
  }

  checkAllLoaded();
}, undefined, err => { checkAllLoaded(); console.warn('Blue Tang GLB not loaded:', err); });

new GLTFLoader().load('./orangestripe_triggerfish.glb', (gltf) => {
  const mesh = gltf.scene;

  const box  = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  const sc   = 2.2 / Math.max(size.x, size.y, size.z);
  const ctr  = box.getCenter(new THREE.Vector3());
  mesh.scale.setScalar(sc);
  mesh.position.sub(ctr.multiplyScalar(sc));

  mesh.traverse(child => {
    child.frustumCulled = false;
    child.visible = true;
    if (!child.isMesh) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    mats.forEach(m => {
      if (!m) return;
      if (m.transparent || m.alphaTest > 0) {
        m.alphaTest   = 0.4;
        m.transparent = false;
        m.depthWrite  = true;
      }
    });
  });

  tf.mixer = new THREE.AnimationMixer(mesh);
  const swimClip = THREE.AnimationClip.findByName(gltf.animations, 'Idle_swim');
  if (swimClip) {
    const action = tf.mixer.clipAction(swimClip);
    action.timeScale = 0.75;
    action.play();
  }

  tf.mesh = mesh;
  mesh.position.set(0, -100, 0);
  scene.add(mesh);
  checkAllLoaded();
}, undefined, err => { checkAllLoaded(); console.warn('Triggerfish GLB not loaded:', err); });

// ── "STEVE'S SITE" TEXT — caustic shader ─────────────────────────────────────
const textUniforms = {
  uTime:   causticUniforms.uTime,
  uSunDir: { value: sun.position.clone().normalize() },
  uCamPos: { value: camera.position.clone() },
};
const textMat = new THREE.ShaderMaterial({
  uniforms: textUniforms,
  transparent: true, side: THREE.DoubleSide,
  vertexShader: /* glsl */`
    varying vec3 vNormal, vWorldPos;
    void main(){
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      vNormal   = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */`
    uniform float uTime; uniform vec3 uSunDir, uCamPos;
    varying vec3 vNormal, vWorldPos;
    ${CAUSTIC_GLSL}
    void main(){
      vec3 N = normalize(vNormal), L = normalize(uSunDir), V = normalize(uCamPos - vWorldPos);
      vec3 H = normalize(L + V);
      float diff = max(dot(N,L), 0.0);
      float spec = pow(max(dot(N,H), 0.0), 80.0);
      float c    = caustics(vWorldPos.xy * 0.36 + vWorldPos.z * 0.07, uTime);
      vec3 col = vec3(0.65,0.95,1.00) * (0.30 + diff * 0.70)
               + vec3(0.25,0.78,1.00) * spec * 0.55
               + vec3(0.08,0.60,0.90) * c   * 0.52;
      gl_FragColor = vec4(col, 0.90);
    }`,
});

const titleMeshes = [];
new FontLoader().load(
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/fonts/helvetiker_bold.typeface.json',
  (font) => {
    const lines = title.split('\n');
    const lineSpacing = 3.2;
    const topY = 5.8 + ((lines.length - 1) * lineSpacing) / 2;
    lines.forEach((line, i) => {
      const geo = new TextGeometry(line, {
        font, size: 2.6, height: 0.42, curveSegments: 10,
        bevelEnabled: true, bevelThickness: 0.09, bevelSize: 0.045, bevelSegments: 4,
      });
      geo.computeBoundingBox();
      geo.translate(-(geo.boundingBox.max.x - geo.boundingBox.min.x) / 2, 0, 0);
      const mesh = new THREE.Mesh(geo, textMat);
      mesh.position.set(0, topY - i * lineSpacing, -1.5);
      scene.add(mesh);
      titleMeshes.push(mesh);
    });
  }
);

// ── RESIZE ────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  _linesMat.resolution.set(innerWidth, innerHeight);
});

// ── ANIMATE ───────────────────────────────────────────────────────────────────
let lastTs = 0;

function animate(ts) {
  requestAnimationFrame(animate);
  const elapsed = ts * 0.001;
  const rawDt   = lastTs > 0 ? Math.min((ts - lastTs) * 0.001, 0.05) : 0.016;
  const dt      = rawDt * params.SIM_SPEED;
  lastTs = ts;

  causticUniforms.uTime.value = elapsed;

  schoolDriftTimer -= dt;
  if (schoolDriftTimer <= 0) {
    schoolTarget.set(
      (Math.random() - 0.5) * BND.x * 0.65,
      (Math.random() - 0.5) * BND.y * 0.55,
      (Math.random() - 0.5) * BND.z * 0.50,
    );
    schoolDriftTimer = 7 + Math.random() * 9;
  }
  schoolCenter.lerp(schoolTarget, dt * 0.10);

  for (const s of shafts) {
    const t = elapsed * s.userData.speed + s.userData.phase;
    s.userData.opacityUnif.value = s.userData.base * (0.45 + 0.55 * Math.abs(Math.sin(t)));
    s.position.x = s.userData.initX + Math.sin(elapsed * 0.20 + s.userData.driftP) * s.userData.drift * 14;
  }

  waveLight1.position.set(
    Math.sin(elapsed * 0.29 + 0.0) * 13,
    12 + Math.sin(elapsed * 0.17 + 0.0) * 4,
    Math.cos(elapsed * 0.23 + 0.0) * 7,
  );
  waveLight2.position.set(
    Math.cos(elapsed * 0.25 + 2.1) * 11,
    9  + Math.sin(elapsed * 0.21 + 2.1) * 5,
    Math.sin(elapsed * 0.18 + 1.3) * 9,
  );

  camera.position.y = Math.sin(elapsed * 0.11) * 0.45;
  camera.position.x = Math.sin(elapsed * 0.07) * 0.25;

  if (tf.mixer) tf.mixer.update(dt);
  if (tf.mesh) {
    if (!tf.active) {
      tf.timer -= dt;
      if (tf.timer <= 0) startTriggerPass();
    } else {
      tf.t = Math.min(tf.t + dt / tf.duration, 1.0);
      const mt = 1.0 - tf.t;
      tf.pos.set(
        mt*mt*tf.startPos.x + 2*mt*tf.t*tf.ctrlPos.x + tf.t*tf.t*tf.endPos.x,
        mt*mt*tf.startPos.y + 2*mt*tf.t*tf.ctrlPos.y + tf.t*tf.t*tf.endPos.y,
        mt*mt*tf.startPos.z + 2*mt*tf.t*tf.ctrlPos.z + tf.t*tf.t*tf.endPos.z,
      );
      tf.vel.set(
        2*mt*(tf.ctrlPos.x - tf.startPos.x) + 2*tf.t*(tf.endPos.x - tf.ctrlPos.x),
        2*mt*(tf.ctrlPos.y - tf.startPos.y) + 2*tf.t*(tf.endPos.y - tf.ctrlPos.y),
        2*mt*(tf.ctrlPos.z - tf.startPos.z) + 2*tf.t*(tf.endPos.z - tf.ctrlPos.z),
      );
      tf.mesh.position.copy(tf.pos);
      if (tf.vel.lengthSq() > 0.01) {
        _fwd.copy(tf.vel).normalize();
        const t = THREE.MathUtils.smoothstep(Math.abs(_fwd.y), 0.5, 0.95);
        _blendUp.lerpVectors(_worldUp, _sideUp, t).normalize();
        _m4.lookAt(_origin, _fwd, _blendUp);
        _qTarget.setFromRotationMatrix(_m4).multiply(TF_ROLL);
        const targetAlpha = THREE.MathUtils.lerp(0.95, 0.04, t);
        tf.targetQ.slerp(_qTarget, targetAlpha);
        tf.ownQ.rotateTowards(tf.targetQ, dt * params.TURN_TF * (1 - t * 0.90));
        tf.mesh.quaternion.copy(tf.ownQ);
      }
      if (tf.t >= 1.0) {
        tf.active = false;
        tf.timer  = 8 + Math.random() * 4;
        tf.mesh.position.set(0, -100, 0);
      }
    }
  }

  for (const b of boids) b.update(boids, dt, elapsed);

  const showTitle = params.SHOW_TITLE !== false;
  for (const m of titleMeshes) m.visible = showTitle;

  const showFish = params.SHOW_FISH !== false;
  for (const b of boids) {
    if (b.mesh.userData.ready) b.mesh.visible = showFish;
    b.marker.visible = !showFish;
    b.marker.position.copy(b.pos);
  }
  if (tf.mesh) tf.mesh.visible = showFish;
  tf.marker.visible = !showFish && tf.active;
  if (tf.marker.visible) tf.marker.position.copy(tf.pos);

  const showSpheres = params.SHOW_SPHERES === true;
  for (let i = 0; i < boids.length; i++) {
    sepSpheres[i].visible = showSpheres;
    if (showSpheres) {
      sepSpheres[i].position.copy(boids[i].pos);
      sepSpheres[i].scale.setScalar(params.SEP_R);
    }
  }

  // ── INTER-BOID LINES ──────────────────────────────────────────────────────
  const showLines = params.SHOW_LINES === true;
  linesObj.visible = showLines;
  if (showLines) {
    const maxR = Math.max(params.SEP_R, params.ALI_R, params.COH_R);
    let pi = 0; // position index (floats), pairs rendered
    let pairs = 0;
    // tang ↔ tang lines
    for (let i = 0; i < boids.length; i++) {
      for (let j = i + 1; j < boids.length; j++) {
        const d = boids[i].pos.distanceTo(boids[j].pos);
        if (d >= maxR) continue;
        _linePosArr[pi]   = boids[i].pos.x; _linePosArr[pi+1] = boids[i].pos.y; _linePosArr[pi+2] = boids[i].pos.z;
        _linePosArr[pi+3] = boids[j].pos.x; _linePosArr[pi+4] = boids[j].pos.y; _linePosArr[pi+5] = boids[j].pos.z;
        // color: red inside SEP_R, yellow inside ALI_R, green inside COH_R
        let r, g, b;
        if (d < params.SEP_R)      { r = 1.0; g = 0.0;  b = 0.0;  } // red — separation
        else if (d < params.ALI_R) { r = 1.0; g = 0.9;  b = 0.0;  } // yellow — alignment
        else                       { r = 0.0; g = 0.85; b = 0.15; } // green — cohesion
        const ci = pairs * 6;
        _lineColArr[ci]   = r; _lineColArr[ci+1] = g; _lineColArr[ci+2] = b;
        _lineColArr[ci+3] = r; _lineColArr[ci+4] = g; _lineColArr[ci+5] = b;
        pi += 6;
        pairs++;
      }
    }
    // tang → triggerfish flee lines (orange)
    if (tf.active && tf.mesh) {
      for (let i = 0; i < boids.length; i++) {
        const d = boids[i].pos.distanceTo(tf.pos);
        if (d >= TF_FLEE_R) continue;
        _linePosArr[pi]   = boids[i].pos.x; _linePosArr[pi+1] = boids[i].pos.y; _linePosArr[pi+2] = boids[i].pos.z;
        _linePosArr[pi+3] = tf.pos.x;        _linePosArr[pi+4] = tf.pos.y;        _linePosArr[pi+5] = tf.pos.z;
        const ci = pairs * 6;
        _lineColArr[ci]   = 1.0; _lineColArr[ci+1] = 0.15; _lineColArr[ci+2] = 0.0; // orange
        _lineColArr[ci+3] = 1.0; _lineColArr[ci+4] = 0.15; _lineColArr[ci+5] = 0.0;
        pi += 6;
        pairs++;
      }
    }
    _linesGeo.instanceCount = pairs;
    _linesGeo.attributes.instanceStart.data.needsUpdate = true;
    _linesGeo.attributes.instanceEnd.data.needsUpdate   = true;
    if (_linesGeo.attributes.instanceColorStart) {
      _linesGeo.attributes.instanceColorStart.data.needsUpdate = true;
      _linesGeo.attributes.instanceColorEnd.data.needsUpdate   = true;
    }
  }

  renderer.render(scene, camera);
}
requestAnimationFrame(animate);

} // end initScene
