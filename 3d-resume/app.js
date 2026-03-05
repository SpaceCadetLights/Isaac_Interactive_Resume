import * as THREE from 'three';
import * as DATA from './data.js';

/* ==========================================================
   TUNING — tweak these constants to trade quality for FPS.

   Performance notes:
   - If FPS drops, lower ambientCount first (pure eye candy).
   - Then reduce mainParticles for your quality tier.
   - nebulaLayers are cheap (4 fullscreen frags) but disable on low.
   - Constellation lines rebuild every constellationInterval frames;
     raise that number or set maxLines to 0 to disable.
   - Bloom is High-only and loaded lazily; it adds one extra
     fullscreen pass — disable by setting bloomStrength to 0.
   ========================================================== */
const TUNING = {
  starLayers: [
    { count: { high: 450, medium: 300, low: 140 }, depth: 220, speed: 0.12, size: 3.0, opacity: 0.45 },
    { count: { high: 320, medium: 200, low: 90  }, depth: 130, speed: 0.30, size: 4.5, opacity: 0.55 },
    { count: { high: 200, medium: 120, low: 50  }, depth: 55,  speed: 0.65, size: 6.0, opacity: 0.65 },
  ],
  mainParticles:  { high: 2500, medium: 1500, low: 700 },
  ambientCount:   { high: 500,  medium: 250,  low: 0   },
  nebulaLayers:   { high: 3,    medium: 2,    low: 0   },
  nebulaSize: 65,
  nebulaOpacity: 0.065,
  bloomStrength: 0.3,
  bloomRadius: 0.45,
  bloomThreshold: 0.65,
  cameraLerp: 0.045,
  breathAmp:  { x: 0.10, y: 0.07 },
  breathFreq: { x: 0.28, y: 0.19 },
  phaseShift: 1.6,
  constellationMaxLines: 120,
  constellationDist: 4.8,
  constellationInterval: 14,
  dpr: { high: 2, medium: 1.5, low: 1 },
};

/* ==========================================================
   SHADERS
   ========================================================== */
const STAR_VS = /* glsl */ `
uniform float uTime;
uniform float uVel;
attribute float aSize;
attribute float aPhase;
varying float vAlpha;
varying float vStretchFactor;
void main(){
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  float dist = -mv.z;
  float twinkle = sin(uTime*2.5 + aPhase*6.283)*0.18 + 0.82;
  vAlpha = smoothstep(260.0,12.0,dist) * twinkle;
  vStretchFactor = 1.0 + abs(uVel)*6.0;
  gl_PointSize = aSize * (1.0/max(dist,1.0)) * vStretchFactor;
  gl_PointSize = clamp(gl_PointSize, 0.4, 32.0);
  gl_Position = projectionMatrix * mv;
}`;

const STAR_FS = /* glsl */ `
varying float vAlpha;
varying float vStretchFactor;
void main(){
  vec2 uv = gl_PointCoord - 0.5;
  uv.x *= vStretchFactor;
  float d = length(uv);
  if(d>0.5) discard;
  float a = smoothstep(0.5,0.0,d);
  a *= a * vAlpha;
  gl_FragColor = vec4(0.92,0.96,1.0, a);
}`;

const PARTICLE_VS = /* glsl */ `
uniform float uTime;
attribute float aSize;
attribute vec3 aColor;
attribute float aPhase;
varying vec3 vColor;
varying float vAlpha;
varying float vPhase;
void main(){
  vColor = aColor;
  vPhase = aPhase;
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  float dist = -mv.z;
  vAlpha  = smoothstep(110.0,5.0,dist)*0.85;
  vAlpha *= smoothstep(0.5,5.0,dist);
  float twinkle = sin(uTime*1.3 + aPhase*6.283)*0.12 + 0.88;
  vAlpha *= twinkle;
  gl_PointSize = aSize * (280.0/max(dist,1.0));
  gl_PointSize = clamp(gl_PointSize, 0.5, 48.0);
  gl_Position = projectionMatrix * mv;
}`;

const PARTICLE_FS = /* glsl */ `
uniform float uTime;
varying vec3 vColor;
varying float vAlpha;
varying float vPhase;
void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if(d>0.5) discard;
  float glow = smoothstep(0.5,0.0,d);
  float core = smoothstep(0.10,0.0,d)*0.35;
  float alpha = (glow*0.52 + core) * vAlpha;
  vec3 col = vColor;
  float shift = sin(vPhase*6.283 + uTime*0.3)*0.09;
  col += vec3(shift, -shift*0.55, shift*0.75);
  col = clamp(col, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}`;

const NEBULA_VS = /* glsl */ `
varying vec2 vUv;
void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;

const NEBULA_FS = /* glsl */ `
uniform float uTime;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform float uOpacity;
varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p);
  f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
float fbm(vec2 p){
  float v=0.0, a=0.5;
  for(int i=0;i<4;i++){ v+=noise(p)*a; p=p*2.1+0.15; a*=0.45; }
  return v;
}
void main(){
  vec2 uv = vUv + vec2(uTime*0.006, uTime*0.004);
  float n1=fbm(uv*2.5), n2=fbm(uv*1.7+3.7);
  vec3 col = mix(uColor1,uColor2,n1);
  float edge = smoothstep(0.0,0.28,vUv.x)*smoothstep(1.0,0.72,vUv.x)
              *smoothstep(0.0,0.28,vUv.y)*smoothstep(1.0,0.72,vUv.y);
  gl_FragColor = vec4(col, n1*n2*edge*uOpacity);
}`;

/* ==========================================================
   GLOBALS
   ========================================================== */
const { gsap, ScrollTrigger } = window;
gsap.registerPlugin(ScrollTrigger);

const IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;
const PREFERS_REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let reducedMotion = PREFERS_REDUCED;
let qualityLevel = IS_MOBILE ? 'low' : 'high';
const NUM_CHAPTERS = 6;

let scrollProgress = 0;
let scrollVelocity = 0;
let lastScrollProgress = 0;
let currentRoll = 0;
const camState = { x: 0, y: 0, z: 50, roll: 0 };

let scene, camera, renderer, clock;
let particles, particleGeo, particlePositions, particleBaseColors;
let starLayers = [];
let ambientParticles;
let nebulaPlanes = [];
let constellationLines;
let constellationFrame = 0;
let composer = null;
let formationTargets = [];
let time = 0;

/* ==========================================================
   WEBGL CHECK
   ========================================================== */
function supportsWebGL() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); }
  catch { return false; }
}

/* ==========================================================
   SCENE
   ========================================================== */
function initScene() {
  const canvas = document.getElementById('bg-canvas');
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.position.set(0, 0, 50);
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: !IS_MOBILE });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, TUNING.dpr[qualityLevel]));
  clock = new THREE.Clock();
}

/* ==========================================================
   LAYERED STARFIELD (3 parallax layers, custom shader)
   ========================================================== */
function createStarfield() {
  const q = qualityLevel;
  TUNING.starLayers.forEach(cfg => {
    const count = cfg.count[q] || cfg.count.low;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 320;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 320;
      pos[i * 3 + 2] = -Math.random() * cfg.depth - 15;
      sizes[i] = cfg.size * (0.5 + Math.random());
      phases[i] = Math.random();
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uVel: { value: 0 } },
      vertexShader: STAR_VS,
      fragmentShader: STAR_FS,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.userData.speed = cfg.speed;
    scene.add(pts);
    starLayers.push(pts);
  });
}

function updateStarfield(t, vel) {
  starLayers.forEach((layer, idx) => {
    layer.material.uniforms.uTime.value = t;
    layer.material.uniforms.uVel.value = vel;
    layer.position.z = scrollProgress * layer.userData.speed * 55;
    if (!reducedMotion) {
      layer.rotation.y = t * 0.0008 * (idx + 1);
      layer.rotation.x = t * 0.0004 * (idx + 1);
    }
  });
}

/* ==========================================================
   FORMATION GENERATORS (unchanged)
   ========================================================== */
function genSphereCloud(count) {
  const p = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const phi = Math.acos(2 * Math.random() - 1);
    const theta = Math.random() * Math.PI * 2;
    const r = 8 + Math.random() * 18;
    p[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    p[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    p[i * 3 + 2] = r * Math.cos(phi);
  }
  return p;
}
function genRectGrid(count) {
  const p = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    p[i * 3] = (Math.random() - 0.5) * 16;
    p[i * 3 + 1] = (Math.random() - 0.5) * 10 + 2;
    p[i * 3 + 2] = (Math.random() - 0.5) * 3;
  }
  return p;
}
function genCascade(count) {
  const p = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const t = i / count;
    p[i * 3] = (Math.random() - 0.5) * 12 + 4;
    p[i * 3 + 1] = (t - 0.5) * 16 + (Math.random() - 0.5) * 2;
    p[i * 3 + 2] = (Math.random() - 0.5) * 4;
  }
  return p;
}
function genConstellation(count) {
  const cats = 10, golden = 2.399963;
  const p = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const cat = i % cats;
    const phi = Math.acos(1 - 2 * (cat + 0.5) / cats);
    const theta = cat * golden;
    const cx = 15 * Math.sin(phi) * Math.cos(theta) - 2;
    const cy = 15 * Math.cos(phi) + 2;
    const cz = 15 * Math.sin(phi) * Math.sin(theta);
    p[i * 3] = cx + (Math.random() - 0.5) * 5;
    p[i * 3 + 1] = cy + (Math.random() - 0.5) * 5;
    p[i * 3 + 2] = cz + (Math.random() - 0.5) * 5;
  }
  return p;
}
function genFlowPath(count) {
  const p = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const t = i / count;
    p[i * 3] = (t - 0.5) * 35 + 6;
    p[i * 3 + 1] = Math.sin(t * Math.PI * 3) * 5 + (Math.random() - 0.5) * 1.5 - 1;
    p[i * 3 + 2] = Math.cos(t * Math.PI * 2) * 3 + (Math.random() - 0.5) * 1.5;
  }
  return p;
}
function genTwinIslands(count) {
  const p = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const second = i >= count / 2;
    const cx = second ? 10 : -10;
    const r = 4 + Math.random() * 4;
    const phi = Math.random() * Math.PI * 2;
    const theta = Math.random() * Math.PI;
    p[i * 3] = cx + r * Math.sin(theta) * Math.cos(phi);
    p[i * 3 + 1] = r * Math.sin(theta) * Math.sin(phi);
    p[i * 3 + 2] = r * Math.cos(theta);
  }
  return p;
}
const FORMATION_FNS = [genSphereCloud, genRectGrid, genCascade, genConstellation, genFlowPath, genTwinIslands];

/* ==========================================================
   MAIN PARTICLE SYSTEM (custom shader)
   ========================================================== */
const PALETTE = [
  new THREE.Color('#7CF7FF'),
  new THREE.Color('#B48CFF'),
  new THREE.Color('#FF7AE5'),
  new THREE.Color('#7CFF9A'),
  new THREE.Color('#A8CCFF'),
];

function createParticles(count) {
  particleGeo = new THREE.BufferGeometry();
  particlePositions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  particleBaseColors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);

  for (let ch = 0; ch < NUM_CHAPTERS; ch++) formationTargets.push(FORMATION_FNS[ch](count));
  particlePositions.set(formationTargets[0]);

  for (let i = 0; i < count; i++) {
    const c = PALETTE[i % PALETTE.length];
    particleBaseColors[i * 3]     = c.r;
    particleBaseColors[i * 3 + 1] = c.g;
    particleBaseColors[i * 3 + 2] = c.b;
    sizes[i] = (IS_MOBILE ? 4.0 : 5.5) * (0.6 + Math.random() * 0.8);
    phases[i] = Math.random();
  }
  colors.set(particleBaseColors);

  particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  particleGeo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  particleGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  particleGeo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: PARTICLE_VS,
    fragmentShader: PARTICLE_FS,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  particles = new THREE.Points(particleGeo, mat);
  scene.add(particles);
}

/* ==========================================================
   AMBIENT DRIFT PARTICLES (depth / nebula dust)
   ========================================================== */
function createAmbientParticles(count) {
  if (!count) return;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const cols = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3]     = (Math.random() - 0.5) * 90;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 90;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 90;
    const c = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    cols[i * 3] = c.r * 0.45; cols[i * 3 + 1] = c.g * 0.45; cols[i * 3 + 2] = c.b * 0.45;
    sizes[i] = 3.0 + Math.random() * 4.0;
    phases[i] = Math.random();
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(cols, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: PARTICLE_VS,
    fragmentShader: PARTICLE_FS,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  ambientParticles = new THREE.Points(geo, mat);
  scene.add(ambientParticles);
}

/* ==========================================================
   NEBULA VOLUME PLANES (FBM noise shaders)
   ========================================================== */
const NEBULA_COLORS = [
  [new THREE.Color('#0f2a4a'), new THREE.Color('#2a1250')],
  [new THREE.Color('#0a2838'), new THREE.Color('#351848')],
  [new THREE.Color('#1a1040'), new THREE.Color('#0a3038')],
];

function createNebulaPlanes() {
  const count = TUNING.nebulaLayers[qualityLevel] || 0;
  for (let i = 0; i < count; i++) {
    const geo = new THREE.PlaneGeometry(TUNING.nebulaSize, TUNING.nebulaSize);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor1: { value: NEBULA_COLORS[i % NEBULA_COLORS.length][0] },
        uColor2: { value: NEBULA_COLORS[i % NEBULA_COLORS.length][1] },
        uOpacity: { value: TUNING.nebulaOpacity },
      },
      vertexShader: NEBULA_VS,
      fragmentShader: NEBULA_FS,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((Math.random() - 0.5) * 25, (Math.random() - 0.5) * 25, -35 - i * 22);
    mesh.rotation.set(Math.random() * 0.4, Math.random() * 0.4, Math.random() * Math.PI);
    scene.add(mesh);
    nebulaPlanes.push(mesh);
  }
}

/* ==========================================================
   CONSTELLATION LINES (high quality only)
   ========================================================== */
function createConstellationLines() {
  if (qualityLevel !== 'high') return;
  const max = TUNING.constellationMaxLines;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 6), 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0x7CF7FF,
    transparent: true,
    opacity: 0.07,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  constellationLines = new THREE.LineSegments(geo, mat);
  scene.add(constellationLines);
}

function updateConstellationLines() {
  if (!constellationLines || !particles) return;
  constellationFrame++;
  if (constellationFrame % TUNING.constellationInterval !== 0) return;

  const buf = constellationLines.geometry.attributes.position.array;
  const pp = particleGeo.attributes.position.array;
  const count = particlePositions.length / 3;
  const maxD2 = TUNING.constellationDist * TUNING.constellationDist;
  const step = Math.max(1, Math.floor(count / 70));
  let li = 0;
  const max = TUNING.constellationMaxLines;

  for (let i = 0; i < count && li < max; i += step) {
    const ax = pp[i * 3], ay = pp[i * 3 + 1], az = pp[i * 3 + 2];
    for (let j = i + step; j < count && li < max; j += step) {
      const dx = pp[j * 3] - ax, dy = pp[j * 3 + 1] - ay, dz = pp[j * 3 + 2] - az;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < maxD2 && d2 > 0.25) {
        const b = li * 6;
        buf[b] = ax; buf[b + 1] = ay; buf[b + 2] = az;
        buf[b + 3] = pp[j * 3]; buf[b + 4] = pp[j * 3 + 1]; buf[b + 5] = pp[j * 3 + 2];
        li++;
      }
    }
  }
  for (let i = li * 6; i < buf.length; i++) buf[i] = 0;
  constellationLines.geometry.attributes.position.needsUpdate = true;
  constellationLines.geometry.setDrawRange(0, li * 2);
}

/* ==========================================================
   POST-PROCESSING (bloom, high quality only, lazy-loaded)
   ========================================================== */
async function initPostProcessing() {
  if (qualityLevel !== 'high' || TUNING.bloomStrength <= 0) return;
  try {
    const [ecm, rpm, ubm] = await Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'),
      import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/UnrealBloomPass.js'),
    ]);
    composer = new ecm.EffectComposer(renderer);
    composer.addPass(new rpm.RenderPass(scene, camera));
    composer.addPass(new ubm.UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      TUNING.bloomStrength, TUNING.bloomRadius, TUNING.bloomThreshold,
    ));
  } catch (e) {
    console.warn('Bloom unavailable:', e.message);
  }
}

/* ==========================================================
   PARTICLE UPDATE (morph + phase-shift + noise)
   ========================================================== */
function updateParticles(t, dt) {
  if (reducedMotion || !particles) return;
  particles.material.uniforms.uTime.value = t;
  const count = particlePositions.length / 3;
  const raw = scrollProgress * (NUM_CHAPTERS - 1);
  const from = Math.min(NUM_CHAPTERS - 1, Math.floor(raw));
  const to = Math.min(NUM_CHAPTERS - 1, from + 1);
  const blend = raw - from;

  const fa = formationTargets[from];
  const ta = formationTargets[to];
  const lerpSpeed = Math.min(1, 2.8 * dt);
  const expansion = Math.sin(blend * Math.PI) * TUNING.phaseShift;

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    const tx = fa[i3]     + (ta[i3]     - fa[i3])     * blend;
    const ty = fa[i3 + 1] + (ta[i3 + 1] - fa[i3 + 1]) * blend;
    const tz = fa[i3 + 2] + (ta[i3 + 2] - fa[i3 + 2]) * blend;

    particlePositions[i3]     += (tx - particlePositions[i3])     * lerpSpeed;
    particlePositions[i3 + 1] += (ty - particlePositions[i3 + 1]) * lerpSpeed;
    particlePositions[i3 + 2] += (tz - particlePositions[i3 + 2]) * lerpSpeed;

    if (expansion > 0.02) {
      const dx = particlePositions[i3], dy = particlePositions[i3 + 1], dz = particlePositions[i3 + 2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01;
      const e = expansion / dist;
      particlePositions[i3]     += dx * e * 0.15;
      particlePositions[i3 + 1] += dy * e * 0.15;
      particlePositions[i3 + 2] += dz * e * 0.15;
    }

    const ns = 0.055;
    particlePositions[i3]     += Math.sin(t * 0.5 + i * 0.037) * ns;
    particlePositions[i3 + 1] += Math.cos(t * 0.4 + i * 0.029) * ns;
    particlePositions[i3 + 2] += Math.sin(t * 0.3 + i * 0.043) * ns;
  }
  particleGeo.attributes.position.needsUpdate = true;
}

/* ==========================================================
   CAMERA SYSTEM (damped rig + breathing + roll)
   ========================================================== */
function updateCamera(t) {
  const cl = TUNING.cameraLerp;
  camera.position.x += (camState.x - camera.position.x) * cl;
  camera.position.y += (camState.y - camera.position.y) * cl;
  camera.position.z += (camState.z - camera.position.z) * cl;

  if (!reducedMotion) {
    camera.position.x += Math.sin(t * TUNING.breathFreq.x) * TUNING.breathAmp.x;
    camera.position.y += Math.cos(t * TUNING.breathFreq.y) * TUNING.breathAmp.y;
  }

  camera.lookAt(0, 0, 0);

  if (!reducedMotion) {
    currentRoll += (camState.roll - currentRoll) * cl;
    camera.rotation.z = currentRoll;
  }
}

/* ==========================================================
   SCROLL ENGINE (GSAP)
   ========================================================== */
function setupScroll() {
  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: '#content',
      start: 'top top',
      end: 'bottom bottom',
      scrub: 2,
      onUpdate: self => { scrollProgress = self.progress; },
    },
  });

  if (!reducedMotion) {
    tl.to(camState, { x: 0,  y: 1.5, z: 38, roll:  0.012, duration: 1, ease: 'none' })
      .to(camState, { x: 3,  y:-0.5, z: 32, roll: -0.015, duration: 1, ease: 'none' })
      .to(camState, { x:-2,  y: 2,   z: 42, roll:  0.010, duration: 1, ease: 'none' })
      .to(camState, { x: 4,  y:-1,   z: 35, roll: -0.008, duration: 1, ease: 'none' })
      .to(camState, { x: 0,  y: 0,   z: 48, roll:  0,     duration: 1, ease: 'none' });
  }

  if (reducedMotion) return;

  gsap.to('.scroll-hint', {
    scrollTrigger: { trigger: '#ch-hero', start: 'top top', end: '30% top', scrub: true },
    opacity: 0,
  });

  document.querySelectorAll('.chapter').forEach(section => {
    const target = section.querySelector('.hero-inner')
      || section.querySelector('.passions-inner')
      || section.querySelector('.footer-inner')
      || section.querySelector('.glass-panel');
    if (!target) return;
    gsap.from(target, {
      scrollTrigger: { trigger: section, start: 'top 82%', toggleActions: 'play none none reverse' },
      y: 50, opacity: 0, scale: 0.96, duration: 0.9, ease: 'power2.out',
    });
  });
}

/* ==========================================================
   HTML HELPERS
   ========================================================== */
function esc(str) { const d = document.createElement('div'); d.textContent = str || ''; return d.innerHTML; }
function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

/* ==========================================================
   UI RENDERING (unchanged)
   ========================================================== */
function renderHero() {
  $('#hero-name').textContent = DATA.profile.name;
  $('#hero-headline').textContent = DATA.profile.headline;
  $('#hero-summary').textContent = DATA.profile.summary;
  $('#hero-chips').innerHTML = DATA.hero.chips.map(c => `<span class="chip">${esc(c)}</span>`).join('');
}

function renderSummary() {
  $('#summary-mvv').innerHTML = `
    <div class="mvv-block"><div class="mvv-label">Mission</div><p>${esc(DATA.mvv.mission)}</p></div>
    <div class="mvv-block"><div class="mvv-label">Vision</div><p>${esc(DATA.mvv.vision)}</p></div>
    <div class="mvv-block"><div class="mvv-label">Values</div><p>${DATA.mvv.values.map(v => '\u2022 ' + esc(v)).join('<br>')}</p></div>
  `;
  $('#summary-kpis').innerHTML = `
    <div class="kpi-group"><div class="kpi-label">Primary Domains</div><div class="kpi-chips">${DATA.hero.primaryDomains.map(d => `<span class="kpi-chip">${esc(d)}</span>`).join('')}</div></div>
    <div class="kpi-group"><div class="kpi-label">Focus</div><div class="kpi-chips">${DATA.hero.focus.map(f => `<span class="kpi-chip">${esc(f)}</span>`).join('')}</div></div>
    <div class="kpi-group"><div class="kpi-label">Style</div><div class="kpi-chips">${DATA.hero.style.map(s => `<span class="kpi-chip">${esc(s)}</span>`).join('')}</div></div>
  `;
}

function renderJobs() {
  const el = $('#jobs-list');
  const reversed = DATA.jobs.slice().reverse();
  el.innerHTML = `
    <h3 class="sub-heading">Work History</h3>
    ${reversed.map((j, i) => `
      <div class="job-card" tabindex="0" role="button" data-type="job" data-idx="${i}">
        <div class="job-header"><div class="job-title">${esc(j.title)}</div><div class="job-dates">${esc(j.dates)}</div></div>
        <div class="job-preview">${esc(j.details.slice(0, 2).join(' \u2022 '))}</div>
        <div class="job-tags">${j.tags.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>
      </div>`).join('')}
    <h3 class="sub-heading" style="margin-top:20px">Education</h3>
    ${DATA.education.map((e, i) => `
      <div class="job-card" tabindex="0" role="button" data-type="edu" data-idx="${i}">
        <div class="job-header"><div class="job-title">${esc(e.title)}</div><div class="job-dates">${esc(e.dates)}</div></div>
        <div class="job-preview">${esc(e.details.join(' \u2022 '))}</div>
        <div class="job-tags">${e.tags.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>
      </div>`).join('')}
  `;
  $$('.job-card', el).forEach(card => {
    const handler = () => {
      const type = card.dataset.type;
      const idx = parseInt(card.dataset.idx, 10);
      const item = type === 'job' ? DATA.jobs.slice().reverse()[idx] : DATA.education[idx];
      openModal(item.title, item.dates, item.details.map(d => '\u2022 ' + d).join('\n'));
    };
    card.addEventListener('click', handler);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
  });
}

function renderSkillNode(node, depth) {
  const cls = depth === 0 ? 'skill-l1' : depth === 1 ? 'skill-l2' : 'skill-l3';
  const open = depth === 0 ? ' open' : '';
  const items = (node.items || []).length ? `<ul class="skill-bullets">${node.items.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : '';
  const kids = (node.children || []).map(ch => renderSkillNode(ch, depth + 1)).join('');
  if (!items && !kids) return '';
  return `<details class="skill-node ${cls}"${open}><summary><span>${esc(node.title)}</span><span class="skill-caret"></span></summary><div class="skill-body">${items}${kids}</div></details>`;
}

function renderSkills() { $('#skills-tree').innerHTML = DATA.skillsTree.map(n => renderSkillNode(n, 0)).join(''); }

function renderTimeline() {
  const sorted = DATA.timeline.slice().sort((a, b) => a.date.localeCompare(b.date));
  const el = $('#timeline-list');
  el.innerHTML = sorted.map((entry, i) => `
    <div class="timeline-entry" tabindex="0" role="button" data-idx="${i}">
      <div class="timeline-dot"></div>
      <div class="timeline-content">
        <div class="timeline-date">${esc(entry.date)}</div>
        <div class="timeline-title">${esc(entry.title)}</div>
        <span class="timeline-type">${esc(entry.type)}</span>
        <div class="job-tags" style="margin-top:6px">${(entry.tags || []).map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>
      </div>
    </div>`).join('');
  $$('.timeline-entry', el).forEach(row => {
    const handler = () => {
      const entry = sorted[parseInt(row.dataset.idx, 10)];
      openModal(entry.title, `${entry.date} \u2022 ${entry.type}`, entry.details || '');
    };
    row.addEventListener('click', handler);
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
  });
}

function renderPassions() {
  $('#passions-list').innerHTML = `<div class="passions-grid">${DATA.passions.map(p => `<div class="passion-bubble">${esc(p)}</div>`).join('')}</div>`;
  $('#caps-list').innerHTML = DATA.capabilities.map(g => `
    <div class="cap-group"><h3 class="cap-group-title">${esc(g.group)}</h3><ul class="cap-items">${g.items.map(it => `<li>${esc(it)}</li>`).join('')}</ul></div>
  `).join('');
}

function renderFooter() {
  const site = $('#footer-site'); site.href = DATA.profile.site; site.textContent = DATA.profile.site.replace('https://', '');
  const email = $('#footer-email'); email.href = `mailto:${DATA.profile.email}`; email.textContent = DATA.profile.email;
}

/* ==========================================================
   MODAL
   ========================================================== */
function openModal(title, meta, body) {
  $('#modal-title').textContent = title;
  $('#modal-meta').textContent = meta;
  $('#modal-body').textContent = body;
  $('#detail-modal').showModal();
}

function setupModal() {
  $('#modal-close').addEventListener('click', () => $('#detail-modal').close());
  $('#detail-modal').addEventListener('click', e => { if (e.target === $('#detail-modal')) $('#detail-modal').close(); });
}

/* ==========================================================
   SKILLS SEARCH
   ========================================================== */
function setupSearch() {
  const input = $('#skills-search');
  if (!input) return;
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => filterSkills(input.value.toLowerCase().trim()), 180);
  });
}

function filterSkills(query) {
  const nodes = $$('#skills-tree .skill-node');
  if (!query) {
    nodes.forEach(n => { n.style.display = ''; n.open = n.classList.contains('skill-l1'); });
    resetParticleColors();
    return;
  }
  nodes.forEach(n => { n.style.display = 'none'; n.open = false; });
  nodes.filter(n => (n.textContent || '').toLowerCase().includes(query)).forEach(n => {
    n.style.display = ''; n.open = true;
    let p = n.parentElement;
    while (p && p.id !== 'skills-tree') { if (p.tagName === 'DETAILS') { p.style.display = ''; p.open = true; } p = p.parentElement; }
  });
  highlightParticles(true);
}

function highlightParticles(active) {
  if (!particles || reducedMotion) return;
  const colors = particleGeo.attributes.aColor.array;
  const count = colors.length / 3;
  for (let i = 0; i < count; i++) {
    const factor = active ? (Math.random() > 0.65 ? 1.4 : 0.25) : 1;
    colors[i * 3]     = Math.min(1, particleBaseColors[i * 3]     * factor);
    colors[i * 3 + 1] = Math.min(1, particleBaseColors[i * 3 + 1] * factor);
    colors[i * 3 + 2] = Math.min(1, particleBaseColors[i * 3 + 2] * factor);
  }
  particleGeo.attributes.aColor.needsUpdate = true;
}

function resetParticleColors() {
  if (!particles) return;
  particleGeo.attributes.aColor.array.set(particleBaseColors);
  particleGeo.attributes.aColor.needsUpdate = true;
}

/* ==========================================================
   CONTROLS (enhanced with visibility toggles)
   ========================================================== */
function setupControls() {
  const motionBtn = $('#btn-motion'), motionIcon = $('#motion-icon');
  const qualityBtn = $('#btn-quality'), qualityIcon = $('#quality-icon');
  const levels = ['high', 'medium', 'low'];

  function syncMotion() {
    document.body.classList.toggle('reduced-motion', reducedMotion);
    motionIcon.textContent = reducedMotion ? '\u25CC' : '\u29BF';
    motionBtn.title = reducedMotion ? 'Enable Motion' : 'Reduce Motion';
  }

  function syncQuality() {
    const icons = { high: '\u25C6', medium: '\u25C7', low: '\u25CB' };
    qualityIcon.textContent = icons[qualityLevel] || '\u25C6';
    qualityBtn.title = `Quality: ${qualityLevel}`;
    if (renderer) renderer.setPixelRatio(Math.min(window.devicePixelRatio, TUNING.dpr[qualityLevel]));
    nebulaPlanes.forEach(p => { p.visible = qualityLevel !== 'low'; });
    if (constellationLines) constellationLines.visible = qualityLevel === 'high';
    if (ambientParticles) ambientParticles.visible = qualityLevel !== 'low';
  }

  syncMotion(); syncQuality();
  motionBtn.addEventListener('click', () => { reducedMotion = !reducedMotion; syncMotion(); });
  qualityBtn.addEventListener('click', () => { const i = levels.indexOf(qualityLevel); qualityLevel = levels[(i + 1) % levels.length]; syncQuality(); });
}

/* ==========================================================
   RESIZE
   ========================================================== */
function onResize() {
  if (!renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (composer) composer.setSize(window.innerWidth, window.innerHeight);
}

/* ==========================================================
   ANIMATION LOOP
   ========================================================== */
let frameCount = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  time += dt;
  frameCount++;

  const rawVel = (scrollProgress - lastScrollProgress) / Math.max(dt, 0.016);
  scrollVelocity += (rawVel - scrollVelocity) * 0.08;
  lastScrollProgress = scrollProgress;

  updateCamera(time);
  updateParticles(time, dt);
  updateStarfield(time, scrollVelocity);

  if (ambientParticles && !reducedMotion) {
    ambientParticles.material.uniforms.uTime.value = time;
    ambientParticles.rotation.y = time * 0.004;
    ambientParticles.rotation.x = Math.sin(time * 0.003) * 0.015;
  }

  nebulaPlanes.forEach(m => { m.material.uniforms.uTime.value = time; });

  if (!reducedMotion) updateConstellationLines();

  if (frameCount % 6 === 0) {
    document.documentElement.style.setProperty('--scroll-progress', scrollProgress.toFixed(3));
  }

  if (composer) composer.render();
  else renderer.render(scene, camera);
}

/* ==========================================================
   INIT
   ========================================================== */
async function init() {
  if (!supportsWebGL()) {
    $('#fallback').classList.add('active');
    $('#content').style.display = 'none';
    $('#controls').style.display = 'none';
    return;
  }

  initScene();
  createStarfield();
  createParticles(TUNING.mainParticles[qualityLevel]);
  createAmbientParticles(TUNING.ambientCount[qualityLevel]);
  createNebulaPlanes();
  createConstellationLines();

  await initPostProcessing();

  renderHero(); renderSummary(); renderJobs(); renderSkills();
  renderTimeline(); renderPassions(); renderFooter();

  setupScroll(); setupSearch(); setupControls(); setupModal();
  window.addEventListener('resize', onResize);
  animate();
}

function handleInitError(err) {
  console.error('3D Resume init failed:', err);
  const fb = document.getElementById('fallback');
  if (fb) fb.classList.add('active');
  const ct = document.getElementById('content');
  if (ct) ct.style.display = 'none';
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => init().catch(handleInitError));
} else {
  init().catch(handleInitError);
}
