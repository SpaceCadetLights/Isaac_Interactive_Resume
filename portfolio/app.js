import * as THREE from 'three';
import * as SEED from './data.js';
import { getDataPackPath, siteUrl, isGitHubPagesRepo, REPO_NAME } from '../shared/site-paths.js';
import { getApiBaseUrl, fetchPublicProjects, applyCmsProjects } from '../shared/cms-config.js';

/* ==========================================================
   TUNING
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
  nebulaOpacity: 0.09,
  bloomStrength: 0.3,
  bloomRadius: 0.45,
  bloomThreshold: 0.65,
  cameraLerp: 0.045,
  breathAmp:  { x: 0.10, y: 0.07 },
  breathFreq: { x: 0.28, y: 0.19 },
  phaseShift: 0.7,
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
vec3 hsv2rgb(vec3 c){
  vec4 K = vec4(1.0,2.0/3.0,1.0/3.0,3.0);
  vec3 p = abs(fract(c.xxx+K.xyz)*6.0-K.www);
  return c.z * mix(K.xxx, clamp(p-K.xxx,0.0,1.0), c.y);
}
void main(){
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  float dist = -mv.z;
  vec4 proj = projectionMatrix * mv;
  gl_Position = proj;
  vec2 sUV = proj.xy / proj.w * 0.5 + 0.5;
  float hue = sUV.x*0.45 + sUV.y*0.35 + uTime*0.018;
  vColor = hsv2rgb(vec3(hue, 0.45, 0.97)) * aColor;
  vAlpha  = smoothstep(110.0,5.0,dist)*0.85;
  vAlpha *= smoothstep(0.5,5.0,dist);
  float twinkle = sin(uTime*1.3 + aPhase*6.283)*0.12 + 0.88;
  vAlpha *= twinkle;
  gl_PointSize = aSize * (280.0/max(dist,1.0));
  gl_PointSize = clamp(gl_PointSize, 0.5, 48.0);
}`;

const PARTICLE_FS = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if(d>0.5) discard;
  float core = smoothstep(0.06, 0.0, d) * 0.75;
  float mid  = smoothstep(0.20, 0.02, d) * 0.25;
  float halo = smoothstep(0.5, 0.18, d) * 0.08;
  float alpha = (core + mid + halo) * vAlpha;
  gl_FragColor = vec4(vColor, alpha);
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
   DATA RESOLUTION
   Priority order:
   1. External file ../data/resume_pack.json  (fetched async at startup)
   2. Shared localStorage key  sc_profile_pack_v1  (written by either page)
   3. Hardcoded data.js seed values
   ========================================================== */
const LS_KEY = 'sc_profile_pack_v1';

function tokenize(str) {
  if (Array.isArray(str)) return str.length ? str : null;
  const arr = (str || '').split(/\s*[•·|,]\s*|\s+\+\s+/).map(s => s.trim()).filter(Boolean);
  return arr.length ? arr : null;
}

function parseHeadingLine(line) {
  const m = line.match(/^(#{1,6})\s+(.*)$/);
  if (!m) return null;
  return { level: m[1].length, text: m[2].trim() };
}

function parseSkillsMarkdownToTree(md) {
  const lines = (md || '').replace(/\t/g, '  ').split(/\r?\n/);
  const root = { title: 'Root', level: 0, bullets: [], children: [] };
  const stack = [root];
  const introNode = { title: 'Overview', level: 1, bullets: [], children: [] };
  root.children.push(introNode);
  stack.push(introNode);
  function current() { return stack[stack.length - 1]; }
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\s+$/, '');
    if (/^[-_—]{8,}$/.test(line.trim())) continue;
    const h = parseHeadingLine(line.trim());
    const b = line.match(/^\s*[-*]\s+(.*)$/);
    if (h && h.level <= 3) {
      while (stack.length > h.level) stack.pop();
      const node = { title: h.text, level: h.level, bullets: [], children: [] };
      stack[stack.length - 1].children.push(node);
      stack.push(node);
      continue;
    }
    if (b) {
      let text = b[1].trim();
      while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !parseHeadingLine(lines[i + 1].trim()) && !/^\s*[-*]\s+/.test(lines[i + 1])) {
        i++;
        text += ' ' + lines[i].trim();
      }
      current().bullets.push(text.replace(/\s+/g, ' ').trim());
    }
  }
  if (!introNode.bullets.length && !introNode.children.length) root.children.shift();
  return root.children;
}

function packToData(pack) {
  if (!pack) return null;
  const r = (pack.resume) || {};
  const h = r.hero || {};
  const projects = Array.isArray(pack.projects) ? pack.projects : [];
  const projectById = {};
  projects.forEach(p => {
    projectById[p.id] = p;
    if (p.slug) projectById[p.slug] = p;
  });
  return {
    config: pack.config || {},
    projects,
    projectById,
    profile: { ...SEED.profile, ...(r.profile || {}) },
    hero: {
      primaryDomains: tokenize(h.primary_domains || h.primaryDomains) || SEED.hero.primaryDomains,
      focus:  tokenize(h.focus)  || SEED.hero.focus,
      style:  tokenize(h.style)  || SEED.hero.style,
      chips:  Array.isArray(h.chips) ? h.chips : SEED.hero.chips,
    },
    mvv: { ...SEED.mvv, ...(r.mvv || {}) },
    jobs: Array.isArray(r.jobs) ? r.jobs : SEED.jobs,
    education: Array.isArray(r.education) ? r.education : SEED.education,
    passions: Array.isArray(r.passions) ? r.passions : SEED.passions,
    capabilities: Array.isArray(r.capabilities) ? r.capabilities : SEED.capabilities,
    timeline: Array.isArray(pack.timeline) ? pack.timeline : SEED.timeline,
    skillsTree: pack.skills_markdown
      ? parseSkillsMarkdownToTree(pack.skills_markdown)
      : SEED.skillsTree,
  };
}

function resolveFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return packToData(JSON.parse(raw));
  } catch (e) {}
  return null;
}

async function fetchExternalData() {
  try {
    const r = await fetch(getDataPackPath(), { cache: 'no-store' });
    if (!r.ok) return null;
    return packToData(await r.json());
  } catch (e) {
    return null;
  }
}

/* Mutable DATA — re-assigned after external fetch or on import */
let DATA = resolveFromLocalStorage() || {
  config: {},
  projects: [],
  projectById: {},
  profile:      SEED.profile,
  hero:         SEED.hero,
  mvv:          SEED.mvv,
  jobs:         SEED.jobs,
  education:    SEED.education,
  passions:     SEED.passions,
  capabilities: SEED.capabilities,
  timeline:     SEED.timeline,
  skillsTree:   SEED.skillsTree,
};

/* ==========================================================
   MEDIA + PROJECT HELPERS
   ========================================================== */
const GAL_PAGE_SIZE = 30;
let _discCategory = 'all';
let _projCategory = 'all';
let _galAllItems = [];
let _galVisibleCount = GAL_PAGE_SIZE;
let _galTagFilter = 'all';
let _heroReelTimer = null;
let _heroReelIdx = 0;

function resolveMediaUrl(src) {
  if (!src) return '';
  if (/^https?:\/\//i.test(src)) return src;
  const base = (DATA.config && DATA.config.mediaBaseUrl) ? String(DATA.config.mediaBaseUrl).replace(/\/$/, '') : '';
  const path = src.replace(/^\//, '');
  if (base) return `${base}/${path}`;
  if (isGitHubPagesRepo()) return `/${REPO_NAME}/${path}`;
  return `../${path}`;
}

function getProject(id) {
  return id ? DATA.projectById[id] : null;
}

function getEntryMedia(entry) {
  if (!entry) return [];
  if (entry.projectId) {
    const p = getProject(entry.projectId);
    if (p && Array.isArray(p.media)) return p.media;
  }
  return entry.media || [];
}

function getProjectLinks(project) {
  const links = [...(project.links || [])];
  const mediaLinks = (project.media || []).filter(m => m.type === 'link');
  mediaLinks.forEach(ml => {
    if (!links.some(l => l.url === ml.url)) links.push({ url: ml.url, label: ml.label || ml.url });
  });
  return links;
}

function countMediaPics(media) {
  return (media || []).filter(m => m.type === 'image' || m.type === 'video').length;
}

function projectHeroSrc(project) {
  if (!project || !project.hero || !project.hero.src) return '';
  return resolveMediaUrl(project.hero.src);
}

function galleryContextFromEntry(entry) {
  if (entry && entry.id && DATA.projectById[entry.id]) {
    const p = entry;
    return {
      title: p.title,
      date: p.date || '',
      type: p.category || 'Project',
      tags: p.tags || [],
      details: p.details || p.summary || '',
      media: p.media || [],
      links: getProjectLinks(p),
      timelineRef: p.timelineRef,
      projectId: p.id,
    };
  }
  const project = entry.projectId ? getProject(entry.projectId) : null;
  if (project) {
    return {
      title: project.title,
      date: entry.date || project.date || '',
      type: entry.type || project.category || 'Project',
      tags: project.tags || entry.tags || [],
      details: project.details || entry.details || project.summary || '',
      media: getEntryMedia(entry),
      links: getProjectLinks(project),
      timelineRef: project.timelineRef || entry.id,
      projectId: project.id,
    };
  }
  return {
    title: entry.title,
    date: entry.date || '',
    type: entry.type || 'Milestone',
    tags: entry.tags || [],
    details: entry.details || '',
    media: entry.media || [],
    links: (entry.media || []).filter(m => m.type === 'link').map(m => ({ url: m.url, label: m.label })),
    timelineRef: entry.id,
    projectId: null,
  };
}

function setupSiteSwitcher(active) {
  const nav = document.getElementById('site-switcher');
  if (!nav) return;
  const map = {
    portfolio: siteUrl('portfolio/'),
    '3d-resume': siteUrl('3d-resume/'),
    standard: siteUrl('interactive_resume_spacecadets_v6_singlefile.html'),
  };
  nav.querySelectorAll('.site-switch-link').forEach(a => {
    const key = a.dataset.site;
    if (map[key]) a.href = map[key];
    a.removeAttribute('aria-current');
    if (key === active) a.setAttribute('aria-current', 'page');
  });
}

function updateOgMeta(project) {
  const title = project ? `${project.title} · Isaac Norris` : 'Isaac Norris · Portfolio';
  const desc = project ? (project.summary || project.subtitle || '') : (DATA.profile.summary || '');
  const ogTitle = document.getElementById('og-title');
  const ogDesc = document.getElementById('og-description');
  const metaDesc = document.getElementById('meta-description');
  const ogImage = document.getElementById('og-image');
  if (ogTitle) ogTitle.setAttribute('content', title);
  if (ogDesc) ogDesc.setAttribute('content', desc);
  if (metaDesc) metaDesc.setAttribute('content', desc);
  if (ogImage && project && project.hero && project.hero.src) {
    ogImage.setAttribute('content', resolveMediaUrl(project.hero.src));
  }
}

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

let tlZoom    = 0.40;
let fitZoom   = 0.40;   /* updated after first layout measurement; used by significance thresholds */
const TL_ZOOM_MIN  = 0.10;
const TL_ZOOM_MAX  = 2.0;
const TL_ZOOM_STEP = 0.05;
let currentTimelineItems = [];
let _sigRerenderTimer = null;

/* ==========================================================
   COLOR THEMES
   ========================================================== */
const COLOR_THEME_KEY = 'sc_color_theme';

/* Nebula radial positions — shared across all themes */
const _NP = [
  '380px 280px at 14% 10%', '320px 260px at 84% 8%', '280px 220px at 72% 78%',
  '260px 200px at 22% 82%', '200px 180px at 50% 45%',
  '1400px 900px at 18% 20%', '1200px 850px at 82% 30%',
  '1000px 900px at 50% 78%', '1600px 1000px at 50% 50%',
];
const _NE = [44,42,40,38,36,60,56,58,65]; /* transparent % per layer */

const THEMES = {
  aurora: {
    label: 'Aurora',
    vars: { '--cyan':'#7CF7FF', '--purple':'#B48CFF', '--pink':'#FF7AE5', '--green':'#7CFF9A' },
    /* Very gentle — barely-there colour wisps over a deep-space base */
    tint: ['rgba(130,95,220,0.05)','rgba(70,120,230,0.04)','rgba(140,80,220,0.04)',
           'rgba(65,105,220,0.03)','rgba(160,110,220,0.03)',
           'rgba(60,35,145,0.06)','rgba(32,55,165,0.05)','rgba(85,40,160,0.04)','rgba(44,22,110,0.04)'],
    bgGrad: 'linear-gradient(155deg,#0b0720 0%,#0d0f30 30%,#09092200%,#0c0824 100%)',
  },
  galactic: {
    label: 'Galactic',
    vars: { '--cyan':'#00E8C4', '--purple':'#8A60FF', '--pink':'#E060C0', '--green':'#40F8B0' },
    /* Near-black base — the colour comes from the animated CSS aurora overlay */
    tint: ['rgba(0,200,160,0.03)','rgba(80,40,200,0.03)','rgba(0,150,210,0.02)',
           'rgba(160,50,150,0.02)','rgba(0,180,150,0.02)',
           'rgba(4,5,18,0.09)','rgba(4,5,18,0.08)','rgba(4,5,18,0.07)','rgba(4,5,18,0.06)'],
    bgGrad: 'linear-gradient(155deg,#04040e 0%,#05050f 30%,#03030c 60%,#04040e 100%)',
  },
  ocean: {
    label: 'Ocean',
    vars: { '--cyan':'#06E6D0', '--purple':'#4193F5', '--pink':'#00C8E8', '--green':'#2ED4A0' },
    tint: ['rgba(6,230,208,0.12)','rgba(65,147,245,0.11)','rgba(0,200,232,0.09)',
           'rgba(46,212,160,0.07)','rgba(14,165,233,0.07)',
           'rgba(2,45,95,0.13)','rgba(4,72,125,0.11)','rgba(0,90,115,0.10)','rgba(2,35,75,0.08)'],
    bgGrad: 'linear-gradient(155deg,#030d16 0%,#041220 30%,#050f1a 60%,#060e18 100%)',
  },
  emerald: {
    label: 'Emerald',
    vars: { '--cyan':'#2ECC8D', '--purple':'#1AAB6B', '--pink':'#66F5B0', '--green':'#C0FAD8' },
    tint: ['rgba(46,204,141,0.12)','rgba(26,171,107,0.11)','rgba(102,245,176,0.09)',
           'rgba(5,150,105,0.08)','rgba(52,211,153,0.07)',
           'rgba(0,55,28,0.13)','rgba(0,75,45,0.11)','rgba(0,55,38,0.10)','rgba(0,38,22,0.08)'],
    bgGrad: 'linear-gradient(155deg,#030e06 0%,#061409 30%,#040e07 60%,#050e08 100%)',
  },
  solar: {
    label: 'Solar',
    vars: { '--cyan':'#FBCC2F', '--purple':'#F97316', '--pink':'#FC8A42', '--green':'#FBB824' },
    tint: ['rgba(251,204,47,0.12)','rgba(249,115,22,0.13)','rgba(252,138,66,0.09)',
           'rgba(251,184,36,0.08)','rgba(253,186,116,0.07)',
           'rgba(96,28,0,0.13)','rgba(115,38,0,0.11)','rgba(96,24,0,0.10)','rgba(78,18,0,0.08)'],
    bgGrad: 'linear-gradient(155deg,#110600 0%,#1a0800 30%,#120600 60%,#140700 100%)',
  },
  midnight: {
    label: 'Midnight',
    vars: { '--cyan':'#A0AEBB', '--purple':'#C4CDD8', '--pink':'#DDEAF3', '--green':'#EEF3F8' },
    tint: ['rgba(148,163,184,0.09)','rgba(100,116,139,0.09)','rgba(148,163,184,0.07)',
           'rgba(100,116,139,0.06)','rgba(148,163,184,0.05)',
           'rgba(28,28,48,0.13)','rgba(18,18,38,0.11)','rgba(24,24,44,0.10)','rgba(14,14,30,0.08)'],
    bgGrad: 'linear-gradient(155deg,#04040a 0%,#060610 30%,#050508 60%,#05050c 100%)',
  },
};

function buildNebulaBackground(name) {
  const t = THEMES[name] || THEMES.aurora;
  const radials = t.tint.map((c, i) =>
    `radial-gradient(${_NP[i]}, ${c}, transparent ${_NE[i]}%)`
  ).join(',\n    ');
  return `${radials},\n    ${t.bgGrad}`;
}

function applyColorTheme(name) {
  const t = THEMES[name] || THEMES.aurora;
  const root = document.documentElement;
  root.dataset.colorTheme = name;
  /* Apply accent CSS vars inline so they override :root defaults */
  Object.entries(t.vars).forEach(([k, v]) => root.style.setProperty(k, v));
  /* Update nebula background */
  const nebulaEl = document.getElementById('nebula-bg');
  if (nebulaEl) nebulaEl.style.background = buildNebulaBackground(name);
  /* Persist */
  try { localStorage.setItem(COLOR_THEME_KEY, name); } catch(_) {}
  /* Sync active swatch highlight */
  document.querySelectorAll('.theme-swatch').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === name);
  });
}

function loadColorTheme() {
  try { return localStorage.getItem(COLOR_THEME_KEY) || 'galactic'; } catch(_) { return 'galactic'; }
}

function setupThemes() {
  document.querySelectorAll('.theme-swatch').forEach(btn => {
    btn.addEventListener('click', () => applyColorTheme(btn.dataset.theme));
  });
  /* sync active state (theme was already applied early in init) */
  const saved = loadColorTheme();
  document.querySelectorAll('.theme-swatch').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === saved);
  });
}

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
   STARFIELD
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
   FORMATION GENERATORS
   ========================================================== */
function genSphereCloud(count) {
  const p = new Float32Array(count * 3);
  const rings = 8, R = 24;
  for (let i = 0; i < count; i++) {
    const ring = i % rings;
    const idx = Math.floor(i / rings);
    const total = Math.floor(count / rings);
    const t = (idx / total) * Math.PI * 2;
    const inclination = (ring / rings) * Math.PI;
    const offset = ring * 0.55;
    const x = R * Math.cos(t + offset);
    const yz = R * Math.sin(t + offset);
    p[i * 3]     = x + (Math.random() - 0.5) * 0.25;
    p[i * 3 + 1] = yz * Math.cos(inclination) + (Math.random() - 0.5) * 0.25;
    p[i * 3 + 2] = yz * Math.sin(inclination) + (Math.random() - 0.5) * 0.25;
  }
  return p;
}
function genFlowerOfLife(count) {
  const p = new Float32Array(count * 3);
  const R = 11;
  const centers = [[0, 0]];
  for (let k = 0; k < 6; k++) centers.push([R * Math.cos(k * Math.PI / 3), R * Math.sin(k * Math.PI / 3)]);
  const nC = centers.length;
  for (let i = 0; i < count; i++) {
    const ci = i % nC;
    const idx = Math.floor(i / nC);
    const total = Math.floor(count / nC);
    const t = (idx / total) * Math.PI * 2;
    p[i * 3]     = centers[ci][0] + R * Math.cos(t) + (Math.random() - 0.5) * 0.2;
    p[i * 3 + 1] = centers[ci][1] + R * Math.sin(t) + (Math.random() - 0.5) * 0.2;
    p[i * 3 + 2] = (ci - 3) * 1.8 + Math.sin(t * 3) * 0.6;
  }
  return p;
}
function genTorusKnot(count) {
  const p = new Float32Array(count * 3);
  const P = 2, Q = 3, R = 14, r = 5;
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2 * P;
    const cv = Math.cos(Q * t / P), sv = Math.sin(Q * t / P);
    p[i * 3]     = (R + r * cv) * Math.cos(t) + (Math.random() - 0.5) * 0.2;
    p[i * 3 + 1] = (R + r * cv) * Math.sin(t) + (Math.random() - 0.5) * 0.2;
    p[i * 3 + 2] = r * sv + (Math.random() - 0.5) * 0.2;
  }
  return p;
}
function genReticello(count) {
  const p = new Float32Array(count * 3);
  const strands = 8, amp = 10, len = 40;
  const half = strands / 2;
  for (let i = 0; i < count; i++) {
    const strand = i % strands;
    const t = (i / count) * Math.PI * 2 * 3;
    const progress = (i / count - 0.5) * len;
    const phase = ((strand % half) / half) * Math.PI * 2;
    const dir = strand < half ? 1 : -1;
    p[i * 3]     = progress + (Math.random() - 0.5) * 0.15;
    p[i * 3 + 1] = amp * Math.sin(dir * t + phase) + (Math.random() - 0.5) * 0.15;
    p[i * 3 + 2] = amp * Math.cos(dir * t + phase) + (Math.random() - 0.5) * 0.15;
  }
  return p;
}
function genLissajous(count) {
  const p = new Float32Array(count * 3);
  const A = 16, B = 16, C = 10, a = 3, b = 4, c = 5;
  const d1 = Math.PI / 4, d2 = Math.PI / 3;
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2;
    p[i * 3]     = A * Math.sin(a * t + d1) + (Math.random() - 0.5) * 0.2;
    p[i * 3 + 1] = B * Math.sin(b * t + d2) + (Math.random() - 0.5) * 0.2;
    p[i * 3 + 2] = C * Math.sin(c * t)      + (Math.random() - 0.5) * 0.2;
  }
  return p;
}
function genNautilus(count) {
  const p = new Float32Array(count * 3);
  const arms = 5, growth = 0.18;
  for (let i = 0; i < count; i++) {
    const arm = i % arms;
    const idx = Math.floor(i / arms);
    const total = Math.floor(count / arms);
    const t = (idx / total) * Math.PI * 6;
    const phase = arm * Math.PI * 2 / arms;
    const r = Math.min(2.0 * Math.exp(growth * t), 20);
    p[i * 3]     = r * Math.cos(t + phase) + (Math.random() - 0.5) * 0.25;
    p[i * 3 + 1] = r * Math.sin(t + phase) + (Math.random() - 0.5) * 0.25;
    p[i * 3 + 2] = Math.sin(t * 0.5 + phase) * r * 0.25 + (Math.random() - 0.5) * 0.25;
  }
  return p;
}
const FORMATION_FNS = [genSphereCloud, genFlowerOfLife, genTorusKnot, genReticello, genLissajous, genNautilus];

/* ==========================================================
   PARTICLES
   ========================================================== */
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
    particleBaseColors[i * 3] = 1; particleBaseColors[i * 3 + 1] = 1; particleBaseColors[i * 3 + 2] = 1;
    sizes[i] = (IS_MOBILE ? 3.0 : 4.2) * (0.5 + Math.random() * 0.7);
    phases[i] = Math.random();
  }
  colors.set(particleBaseColors);
  particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  particleGeo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  particleGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  particleGeo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  particles = new THREE.Points(particleGeo, mat);
  scene.add(particles);
}

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
    cols[i * 3] = 0.4; cols[i * 3 + 1] = 0.4; cols[i * 3 + 2] = 0.4;
    sizes[i] = 3.0 + Math.random() * 4.0;
    phases[i] = Math.random();
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(cols, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  ambientParticles = new THREE.Points(geo, mat);
  scene.add(ambientParticles);
}

const NEBULA_COLORS = [
  [new THREE.Color('#1a3868'), new THREE.Color('#3a1a6a')],
  [new THREE.Color('#142e5c'), new THREE.Color('#4a2070')],
  [new THREE.Color('#281858'), new THREE.Color('#143860')],
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
      vertexShader: NEBULA_VS, fragmentShader: NEBULA_FS,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((Math.random() - 0.5) * 25, (Math.random() - 0.5) * 25, -35 - i * 22);
    mesh.rotation.set(Math.random() * 0.4, Math.random() * 0.4, Math.random() * Math.PI);
    scene.add(mesh);
    nebulaPlanes.push(mesh);
  }
}

function createConstellationLines() {
  if (qualityLevel !== 'high') return;
  const max = TUNING.constellationMaxLines;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 6), 3));
  const mat = new THREE.LineBasicMaterial({ color: 0x7CF7FF, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false });
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
  } catch (e) { console.warn('Bloom unavailable:', e.message); }
}

/* ==========================================================
   PARTICLE UPDATE
   ========================================================== */
function updateParticles(t, dt) {
  if (reducedMotion || !particles) return;
  particles.material.uniforms.uTime.value = t;
  const count = particlePositions.length / 3;
  const raw = scrollProgress * (NUM_CHAPTERS - 1);
  const from = Math.min(NUM_CHAPTERS - 1, Math.floor(raw));
  const to = Math.min(NUM_CHAPTERS - 1, from + 1);
  const blend = raw - from;
  const fa = formationTargets[from], ta = formationTargets[to];
  const lerpSpeed = Math.min(1, 2.2 * dt);
  const expansion = Math.sin(blend * Math.PI) * TUNING.phaseShift;
  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    let tx = fa[i3]     + (ta[i3]     - fa[i3])     * blend;
    let ty = fa[i3 + 1] + (ta[i3 + 1] - fa[i3 + 1]) * blend;
    let tz = fa[i3 + 2] + (ta[i3 + 2] - fa[i3 + 2]) * blend;
    if (expansion > 0.02) {
      const dist = Math.sqrt(tx * tx + ty * ty + tz * tz) + 1.5;
      const e = expansion * 0.1;
      tx += (tx / dist) * e; ty += (ty / dist) * e; tz += (tz / dist) * e;
    }
    particlePositions[i3]     += (tx - particlePositions[i3])     * lerpSpeed;
    particlePositions[i3 + 1] += (ty - particlePositions[i3 + 1]) * lerpSpeed;
    particlePositions[i3 + 2] += (tz - particlePositions[i3 + 2]) * lerpSpeed;
    const ns = 0.03;
    particlePositions[i3]     += Math.sin(t * 0.5 + i * 0.037) * ns;
    particlePositions[i3 + 1] += Math.cos(t * 0.4 + i * 0.029) * ns;
    particlePositions[i3 + 2] += Math.sin(t * 0.3 + i * 0.043) * ns;
  }
  particleGeo.attributes.position.needsUpdate = true;
}

/* ==========================================================
   CAMERA
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
   SCROLL ENGINE
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
      .to(camState, { x: 0,  y: 0.5, z: 44, roll:  0.006, duration: 1, ease: 'none' })
      .to(camState, { x: 0,  y: 0,   z: 50, roll:  0,     duration: 1, ease: 'none' });
  }

  /* Scroll hint always fades when scrolling — regardless of reduced-motion */
  gsap.to('.scroll-hint', {
    scrollTrigger: { trigger: '#ch-hero', start: 'top top', end: '25% top', scrub: true },
    opacity: 0,
  });

  if (reducedMotion) return;

  /* Summary panels: slide in from left/right with lens-blur effect */
  gsap.from('#panel-mvv', {
    scrollTrigger: { trigger: '#ch-summary', start: 'top 78%', toggleActions: 'play none none reverse' },
    x: -70, opacity: 0, filter: 'blur(12px)', duration: 0.85, ease: 'power2.out',
  });
  gsap.from('#panel-domains', {
    scrollTrigger: { trigger: '#ch-summary', start: 'top 78%', toggleActions: 'play none none reverse' },
    x: 70, opacity: 0, filter: 'blur(12px)', duration: 0.85, ease: 'power2.out', delay: 0.08,
  });

  /* Generic scroll-in for all other sections */
  document.querySelectorAll('.chapter').forEach(section => {
    if (section.id === 'ch-summary') return; // handled above
    const target = section.querySelector('.hero-inner')
      || section.querySelector('.experience-col')
      || section.querySelector('.passions-inner')
      || section.querySelector('.footer-inner')
      || section.querySelector('.glass-panel');
    if (!target) return;
    gsap.from(target, {
      scrollTrigger: { trigger: section, start: 'top 82%', toggleActions: 'play none none reverse' },
      y: 50, opacity: 0, scale: 0.96, duration: 0.9, ease: 'power2.out',
    });
  });

  /* Contact panel: headline rises up, links stagger in */
  gsap.from('#ch-contact .contact-headline', {
    scrollTrigger: { trigger: '#ch-contact', start: 'top 80%', toggleActions: 'play none none reverse' },
    y: 40, opacity: 0, filter: 'blur(10px)', duration: 1.1, ease: 'power3.out',
  });
  gsap.from('#ch-contact .contact-links .contact-link', {
    scrollTrigger: { trigger: '#ch-contact', start: 'top 72%', toggleActions: 'play none none reverse' },
    y: 24, opacity: 0, duration: 0.6, ease: 'power2.out', stagger: 0.12, delay: 0.25,
  });
}

/* ==========================================================
   SECTION NAV
   ========================================================== */
function setupNav() {
  const nav        = document.getElementById('section-nav');
  const siteSwitcher = document.getElementById('site-switcher');
  const controls   = document.getElementById('controls');
  if (!nav) return;

  const TOP_ELEMS = [siteSwitcher, controls].filter(Boolean);

  /* Ensure top elements start fully visible so autoAlpha can track them */
  gsap.set(TOP_ELEMS, { autoAlpha: 1 });

  ScrollTrigger.create({
    trigger: '#ch-hero',
    start: 'bottom 60%',

    onEnter: () => {
      nav.classList.add('nav-visible');

      if (!reducedMotion) {
        const h = nav.offsetHeight || 56;

        /* Camera-lens blur-in: coalesce from above with a scale squeeze + heavy blur */
        gsap.fromTo(nav,
          { y: -(h + 12), scale: 0.96, opacity: 0, filter: 'blur(28px) brightness(1.4)' },
          { y: 0,         scale: 1,    opacity: 1, filter: 'blur(0px)  brightness(1)',
            duration: 0.75, ease: 'expo.out',
          }
        );

        /* Top-right buttons dissolve out */
        gsap.to(TOP_ELEMS, { autoAlpha: 0, duration: 0.35, ease: 'power2.in' });

      } else {
        gsap.set(nav,       { y: 0, opacity: 1, filter: 'none', scale: 1 });
        gsap.set(TOP_ELEMS, { autoAlpha: 0 });
      }
    },

    onLeaveBack: () => {
      if (!reducedMotion) {
        const h = nav.offsetHeight || 56;

        /* Blur back out, lift upward */
        gsap.to(nav, {
          y: -(h + 12), scale: 0.96, opacity: 0, filter: 'blur(24px) brightness(1.3)',
          duration: 0.45, ease: 'power2.in',
          onComplete: () => nav.classList.remove('nav-visible'),
        });

        /* Top-right buttons fade back in */
        gsap.to(TOP_ELEMS, { autoAlpha: 1, duration: 0.45, ease: 'power2.out' });

      } else {
        gsap.set(nav, { opacity: 0 });
        nav.classList.remove('nav-visible');
        gsap.set(TOP_ELEMS, { autoAlpha: 1 });
      }
    },
  });

  /* Click handlers — smooth scroll to target element */
  nav.querySelectorAll('.snav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const el = document.getElementById(btn.dataset.target);
      scrollToBlock(el);
    });
  });
}

/* Scroll so that el is vertically centered in the usable viewport (below the nav).
   If the element is taller than the usable space, top-align with a small offset instead. */
function scrollToBlock(el) {
  if (!el) return;
  const navH   = (document.getElementById('section-nav')?.offsetHeight || 52) + 12;
  const elH    = el.getBoundingClientRect().height;
  const vpH    = window.innerHeight;
  const usable = vpH - navH;
  /* absolute doc-top of the element */
  const elDocTop = el.getBoundingClientRect().top + window.scrollY;
  let target;
  if (elH + 48 <= usable) {
    /* center in the usable area below the nav bar */
    target = elDocTop - navH - (usable - elH) / 2;
  } else {
    /* too tall to center — top-align with breathing room */
    target = elDocTop - navH - 16;
  }
  window.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
}

/* ==========================================================
   HTML HELPERS
   ========================================================== */
function esc(str) { const d = document.createElement('div'); d.textContent = str || ''; return d.innerHTML; }
function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

/* ==========================================================
   RENDERERS
   ========================================================== */
function renderHero() {
  $('#hero-name').textContent = DATA.profile.name;
  $('#hero-headline').textContent = 'Designer · Engineer · Builder — explore work through light, motion, and hardware.';
  $('#hero-summary').textContent = DATA.profile.summary;
  $('#hero-chips').innerHTML = DATA.hero.chips.map(c => `<span class="chip">${esc(c)}</span>`).join('');
  renderHeroReel();
}

function renderHeroReel() {
  const el = $('#hero-reel');
  if (!el) return;
  if (_heroReelTimer) { clearInterval(_heroReelTimer); _heroReelTimer = null; }
  const featured = (DATA.projects || []).filter(p => p.featured && projectHeroSrc(p));
  if (!featured.length) { el.innerHTML = ''; return; }
  if (PREFERS_REDUCED) {
    el.innerHTML = `<img class="hero-reel-img active" src="${esc(projectHeroSrc(featured[0]))}" alt="">`;
    return;
  }
  el.innerHTML = featured.map((p, i) =>
    `<img class="hero-reel-img${i === 0 ? ' active' : ''}" data-proj-id="${esc(p.id)}" src="${esc(projectHeroSrc(p))}" alt="${esc(p.title)}">`
  ).join('');
  _heroReelIdx = 0;
  el.onclick = () => {
    const active = featured[_heroReelIdx];
    if (active) openGalleryModal(active);
  };
  if (featured.length > 1) {
    _heroReelTimer = setInterval(() => {
      const imgs = el.querySelectorAll('.hero-reel-img');
      imgs[_heroReelIdx]?.classList.remove('active');
      _heroReelIdx = (_heroReelIdx + 1) % featured.length;
      imgs[_heroReelIdx]?.classList.add('active');
    }, 7000);
  }
}

function renderDiscover() {
  const grid = $('#discover-grid');
  if (!grid) return;
  let items = (DATA.projects || []).slice();
  items.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || (b.date || '').localeCompare(a.date || ''));
  if (_discCategory !== 'all') items = items.filter(p => p.category === _discCategory);
  if (!items.length) {
    grid.innerHTML = '<p class="disc-empty">No projects in this category yet.</p>';
    return;
  }
  grid.innerHTML = items.map(p => {
    const n = countMediaPics(p.media);
    const hero = projectHeroSrc(p);
    const thumb = hero
      ? `<img src="${esc(hero)}" alt="" loading="lazy">`
      : '<div class="disc-tile-placeholder"></div>';
    const tag = (p.tags || [])[0] || p.category || 'Project';
    return `<button type="button" class="disc-tile" data-proj-id="${esc(p.id)}" aria-label="Open ${esc(p.title)}">
      ${thumb}
      <div class="disc-tile-body">
        <div class="disc-tile-title">${esc(p.title)}</div>
        <div class="disc-tile-meta">
          <span class="tl-pill">${esc(tag)}</span>
          ${n ? `<span class="tl-media-badge"><span class="tl-media-badge-icon">&#9671;</span>${n}</span>` : ''}
        </div>
      </div>
    </button>`;
  }).join('');
}

function renderProjects(query) {
  const grid = $('#projects-grid');
  if (!grid) return;
  const q = (query || '').toLowerCase().trim();
  let items = (DATA.projects || []).slice();
  if (_projCategory !== 'all') items = items.filter(p => p.category === _projCategory);
  if (q) {
    items = items.filter(p =>
      `${p.title} ${p.subtitle || ''} ${p.summary || ''} ${(p.tags || []).join(' ')}`.toLowerCase().includes(q)
    );
  }
  items.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || (b.date || '').localeCompare(a.date || '') || (a.title || '').localeCompare(b.title || ''));
  if (!items.length) {
    grid.innerHTML = `<p class="proj-empty">No projects match${q ? ` &ldquo;${esc(q)}&rdquo;` : ''}.</p>`;
    return;
  }
  grid.innerHTML = items.map(p => {
    const pics = countMediaPics(p.media);
    const vids = (p.media || []).filter(m => m.type === 'video').length;
    const hero = projectHeroSrc(p);
    const thumb = hero
      ? `<img src="${esc(hero)}" alt="" loading="lazy">`
      : '<div class="proj-card-placeholder"></div>';
    const meta = [pics ? `${pics} photo${pics !== 1 ? 's' : ''}` : '', vids ? `${vids} video${vids !== 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ') || 'Details & links';
    const timelineLink = p.timelineRef
      ? `<a href="${esc(siteUrl('3d-resume/'))}#ch-timeline" class="proj-timeline-link">View on career timeline &#x2197;</a>`
      : '';
    return `<article class="proj-card">
      <button type="button" class="proj-card-hit" data-proj-id="${esc(p.id)}" aria-label="Open ${esc(p.title)}">
        <div class="proj-card-hero">${thumb}</div>
        <div class="proj-card-body">
          <h3 class="proj-card-title">${esc(p.title)}</h3>
          <p class="proj-card-sub">${esc(p.subtitle || '')}</p>
          <div class="proj-card-tags">${(p.tags || []).slice(0, 3).map(t => `<span class="tl-pill">${esc(t)}</span>`).join('')}</div>
          <p class="proj-card-meta">${esc(meta)}</p>
        </div>
      </button>
      ${timelineLink}
    </article>`;
  }).join('');
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

function renderWorkHistory() {
  const el = $('#jobs-list');
  const reversed = DATA.jobs.slice().reverse();
  el.innerHTML = reversed.map((j, i) => `
    <div class="job-card" tabindex="0" role="button" data-type="job" data-idx="${i}">
      <div class="job-header"><div class="job-title">${esc(j.title)}</div><div class="job-dates">${esc(j.dates)}</div></div>
      <div class="job-preview">${esc(j.details.slice(0, 2).join(' \u2022 '))}</div>
      <div class="job-tags">${j.tags.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>
    </div>`).join('');
  $$('.job-card', el).forEach(card => {
    const handler = () => {
      const idx = parseInt(card.dataset.idx, 10);
      const item = DATA.jobs.slice().reverse()[idx];
      openModal(item.title, item.dates, item.details.map(d => '\u2022 ' + d).join('\n'));
    };
    card.addEventListener('click', handler);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
  });
}

function renderEducation() {
  const el = $('#edu-list');
  el.innerHTML = DATA.education.map((e, i) => `
    <div class="job-card" tabindex="0" role="button" data-type="edu" data-idx="${i}">
      <div class="job-header"><div class="job-title">${esc(e.title)}</div><div class="job-dates">${esc(e.dates)}</div></div>
      <div class="job-preview">${esc(e.details.join(' \u2022 '))}</div>
      <div class="job-tags">${e.tags.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>
    </div>`).join('');
  $$('.job-card', el).forEach(card => {
    const handler = () => {
      const idx = parseInt(card.dataset.idx, 10);
      const item = DATA.education[idx];
      openModal(item.title, item.dates, item.details.map(d => '\u2022 ' + d).join('\n'));
    };
    card.addEventListener('click', handler);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
  });
}

function renderSkillNode(node, depth) {
  const cls = depth === 0 ? 'skill-l1' : depth === 1 ? 'skill-l2' : 'skill-l3';
  const open = depth === 0 ? ' open' : '';
  const bullets = node.items || node.bullets || [];
  const items = bullets.length ? `<ul class="skill-bullets">${bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : '';
  const kids = (node.children || []).map(ch => renderSkillNode(ch, depth + 1)).join('');
  if (!items && !kids) return '';
  return `<details class="skill-node ${cls}"${open}><summary><span>${esc(node.title)}</span><span class="skill-caret"></span></summary><div class="skill-body">${items}${kids}</div></details>`;
}

function renderSkills() { $('#skills-tree').innerHTML = DATA.skillsTree.map(n => renderSkillNode(n, 0)).join(''); }

/* ==========================================================
   TIMELINE ZOOM — FIT, LOD, AND APPLY
   ========================================================== */

/* Solve for the zoom where N items exactly fill the container.
   Formula: trackW = z * (328N − 28) + 16  →  z = (containerW − 16) / (328N − 28) */
function computeFitZoom(itemCount) {
  const wrap = document.querySelector('.tl-wrap');
  if (!wrap || itemCount <= 0) return 0.4;
  const w = wrap.clientWidth || wrap.offsetWidth;
  if (!w) return 0.4;
  const divisor = 328 * itemCount - 28;
  if (divisor <= 0) return TL_ZOOM_MIN;
  return Math.max(TL_ZOOM_MIN, Math.min(TL_ZOOM_MAX, (w - 16) / divisor));
}

/* Return the minimum significance required to be visible at the current zoom.
   Thresholds are expressed as a fraction of fitZoom so they scale naturally
   regardless of how many items are on the timeline. */
function getMinSignificance(zoom) {
  if (!fitZoom || fitZoom <= 0) return 1;
  const r = zoom / fitZoom;  /* ratio: 1.0 = "fit" view, < 1.0 = zoomed out further */
  if (r < 0.30) return 5;
  if (r < 0.50) return 4;
  if (r < 0.70) return 3;
  if (r < 0.90) return 2;
  return 1;
}

/* Module-level zoom applier so it can be called from setupTimelineZoom,
   onResize, and anywhere else without scope issues. */
function applyTimelineZoom(v) {
  const prevSig = getMinSignificance(tlZoom);
  tlZoom = Math.max(TL_ZOOM_MIN, Math.min(TL_ZOOM_MAX, v));

  /* Sync controls */
  const range = $('#tl-zoom-range');
  const label = $('#tl-zoom-label');
  if (range) range.value  = Math.round(tlZoom * 100);
  if (label) label.textContent = Math.round(tlZoom * 100) + '%';

  const newSig = getMinSignificance(tlZoom);

  if (newSig !== prevSig) {
    /* Significance threshold crossed — re-render to show/hide items.
       Debounce so rapid dragging doesn't hammer the DOM. */
    clearTimeout(_sigRerenderTimer);
    _sigRerenderTimer = setTimeout(() => {
      renderTimeline($('#timeline-search') ? $('#timeline-search').value : '');
    }, 120);
  } else {
    /* Just update the CSS variable and ruler — no full re-render needed */
    const track = document.querySelector('.tl-track');
    if (track) track.style.setProperty('--tl-zoom', tlZoom.toFixed(3));
    rebuildRuler();
  }
}

/* Build the year ruler HTML — a time-proportional tape-measure bar.
   Left = most recent (maxYear), Right = oldest (minYear), matching track direction.
   Shows year ticks always; month ticks when zoom is high enough. */
function buildRulerHtml(items) {
  if (!items.length) return '';

  /* Track dimensions (mirror CSS .tl-track formula) */
  const cardW    = 300 * tlZoom;
  const gapSize  = 28  * tlZoom;
  const stride   = cardW + gapSize;
  const padStart = 8;
  const N        = items.length;
  const trackW   = N * stride - gapSize + padStart * 2;

  /* Date range: earliest item year → max(latest item year, current year) */
  const itemYears = items
    .map(t => parseInt((t.date || '').slice(0, 4), 10))
    .filter(y => !isNaN(y));
  if (!itemYears.length) return '';

  const minYear  = Math.min(...itemYears);
  const maxYear  = Math.max(Math.max(...itemYears), new Date().getFullYear());
  const yearSpan = maxYear - minYear;
  if (yearSpan <= 0) return '';

  const pxPerYear   = trackW / yearSpan;
  const showMonths  = pxPerYear >= 80;       // show minor month ticks
  const showMoLabels= pxPerYear >= 180;      // show abbreviated month names on quarter ticks

  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  /* x position for an absolute month offset from maxYear (going rightward = older) */
  const totalM = yearSpan * 12;
  const pxPerM = trackW / totalM;

  let html = '';

  for (let i = 0; i <= totalM; i++) {
    const x       = (i * pxPerM).toFixed(1);
    const isYear  = i % 12 === 0;
    const isQtr   = !isYear && i % 3 === 0;

    if (isYear) {
      const year = maxYear - i / 12;
      html += `<div class="tl-tick tl-tick-year" style="left:${x}px" aria-hidden="true">
        <span class="tl-tick-label">${year}</span>
      </div>`;
    } else if (showMonths) {
      /* Month index (0=Jan … 11=Dec) for this position */
      const mIdx  = ((maxYear * 12 - i) % 12 + 12) % 12;
      const label = showMoLabels && isQtr
        ? `<span class="tl-tick-label tl-mo-label">${MONTH_NAMES[mIdx]}</span>`
        : '';
      html += `<div class="tl-tick ${isQtr ? 'tl-tick-qtr' : 'tl-tick-month'}" style="left:${x}px" aria-hidden="true">${label}</div>`;
    }
  }

  return `<div class="tl-ruler" id="tl-ruler" style="width:${trackW.toFixed(0)}px" aria-hidden="true">${html}</div>`;
}

function rebuildRuler() {
  const existing = document.getElementById('tl-ruler');
  if (!existing) return;
  const html = buildRulerHtml(currentTimelineItems);
  if (!html) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  if (tmp.firstElementChild) existing.replaceWith(tmp.firstElementChild);
}

function renderTimeline(query) {
  const q = (query || '').toLowerCase().trim();
  /* Sort DESCENDING: most recent on the LEFT */
  const sorted = DATA.timeline.slice().sort((a, b) => b.date.localeCompare(a.date));

  /* Significance filter: items with a significance field below the threshold are
     hidden at lower zoom levels (LOD).  Items without the field default to sig=3. */
  const minSig = getMinSignificance(tlZoom);
  const items = sorted.filter(t => {
    const sig = (typeof t.significance === 'number') ? t.significance : 3;
    if (sig < minSig) return false;
    if (!q) return true;
    return `${t.date} ${t.title} ${t.type} ${t.details || ''} ${(t.tags || []).join(' ')}`.toLowerCase().includes(q);
  });

  currentTimelineItems = items;

  const el = $('#timeline-list');
  if (!items.length) {
    el.innerHTML = `<p style="text-align:center;color:var(--muted2);padding:24px 0;font-size:13px">No entries match &ldquo;${esc(q)}&rdquo;</p>`;
    return;
  }

  el.innerHTML = `<div class="tl-track" style="--tl-zoom:${tlZoom.toFixed(3)}">
    ${items.map((t, i) => {
      const mediaPics = getEntryMedia(t).filter(m => m.type === 'image' || m.type === 'video');
      const hasMedia = mediaPics.length > 0;
      const project = t.projectId ? getProject(t.projectId) : null;
      const heroSrc = project ? projectHeroSrc(project) : '';
      const heroStrip = heroSrc
        ? `<div class="tl-hero-strip"><img src="${esc(heroSrc)}" alt="" loading="lazy"></div>`
        : '';
      return `
      <article class="tl-entry">
        <div class="tl-date">${esc(t.date || '')}</div>
        <div class="tl-rail">
          <div class="tl-dot${hasMedia ? ' tl-dot-media' : ''}" aria-hidden="true"></div>
        </div>
        <div class="tl-card${hasMedia ? ' tl-card-has-media' : ''}">
          ${heroStrip}
          <button class="tl-summary" data-tl-open="${i}" aria-label="Open details for ${esc(t.title || 'Untitled')}">
            <span class="tl-summary-text">${esc(t.title || 'Untitled')}</span>
            <span class="tl-summary-end">
              ${hasMedia ? `<span class="tl-media-badge" aria-label="${mediaPics.length} media item${mediaPics.length !== 1 ? 's' : ''}">
                <span class="tl-media-badge-icon">&#9671;</span>${mediaPics.length}
              </span>` : ''}
              <span class="tl-summary-arrow" aria-hidden="true">&#8250;</span>
            </span>
          </button>
          <div class="tl-pills-preview">
            <span class="tl-pill tl-pill-type">${esc(t.type || 'Milestone')}</span>
            ${(t.tags || []).slice(0, 5).map(x => `<span class="tl-pill">${esc(x)}</span>`).join('')}
          </div>
        </div>
      </article>`;
    }).join('')}
  </div>
  ${buildRulerHtml(items)}`;

  /* Gallery opener — event delegation so it survives re-renders */
  el.removeEventListener('click', el._tlGalleryHandler);
  el._tlGalleryHandler = e => {
    const btn = e.target.closest('[data-tl-open]');
    if (!btn) return;
    const idx = parseInt(btn.dataset.tlOpen, 10);
    if (currentTimelineItems[idx]) openGalleryModal(currentTimelineItems[idx]);
  };
  el.addEventListener('click', el._tlGalleryHandler);
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

function renderContact() {
  const el = $('#contact-links');
  if (!el) return;
  const p = DATA.profile || {};
  const items = [];
  if (p.email) items.push(
    `<a href="mailto:${esc(p.email)}" class="contact-link">
       <span class="contact-link-icon">&#x2709;</span>${esc(p.email)}
     </a>`);
  if (p.phone) items.push(
    `<a href="tel:${esc(p.phone.replace(/\D/g,''))}" class="contact-link">
       <span class="contact-link-icon">&#x260E;</span>${esc(p.phone)}
     </a>`);
  if (p.site) items.push(
    `<a href="${esc(p.site)}" class="contact-link" target="_blank" rel="noopener">
       <span class="contact-link-icon">&#x2197;</span>${esc(p.site.replace('https://',''))}
     </a>`);
  el.innerHTML = items.join('');
}

function renderAll() {
  renderHero();
  renderDiscover();
  renderProjects($('#projects-search') ? $('#projects-search').value : '');
  renderSummary();
  renderWorkHistory();
  renderEducation();
  renderSkills();
  renderTimeline($('#timeline-search') ? $('#timeline-search').value : '');
  renderPassions();
  renderContact();
  renderFooter();
  setupSiteSwitcher('portfolio');
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
   GALLERY MODAL
   ========================================================== */
let _galItems = [];
let _galIdx   = 0;
let _galContext = null;

function collectGalleryTags(items) {
  const tags = new Set();
  items.forEach(m => (m.tags || []).forEach(t => tags.add(t)));
  return [...tags].sort();
}

function renderGalleryGrid() {
  const grid = $('#gal-grid');
  const loadMore = $('#gal-load-more');
  if (!grid) return;
  let items = _galAllItems;
  if (_galTagFilter !== 'all') {
    items = items.filter(m => (m.tags || []).includes(_galTagFilter));
  }
  _galItems = items;
  const visible = items.slice(0, _galVisibleCount);
  if (visible.length) {
    grid.innerHTML = visible.map((m, i) => {
      const src = resolveMediaUrl(m.src);
      const poster = m.poster ? resolveMediaUrl(m.poster) : '';
      if (m.type === 'image') {
        return `<button class="gallery-thumb" data-gal-idx="${i}" aria-label="View ${esc(m.caption || 'photo ' + (i + 1))}">
          <img src="${esc(src)}" alt="${esc(m.caption || '')}" loading="lazy">
          ${m.caption ? `<div class="gallery-thumb-caption">${esc(m.caption)}</div>` : ''}
        </button>`;
      }
      return `<button class="gallery-thumb gallery-thumb-video" data-gal-idx="${i}" aria-label="Play ${esc(m.caption || 'video ' + (i + 1))}">
        ${poster ? `<img src="${esc(poster)}" alt="" loading="lazy">` : '<div class="gallery-thumb-noposter"></div>'}
        <div class="gallery-thumb-play-icon" aria-hidden="true">&#9654;</div>
        ${m.caption ? `<div class="gallery-thumb-caption">${esc(m.caption)}</div>` : ''}
      </button>`;
    }).join('');
  } else {
    grid.innerHTML = '<p class="gallery-empty">No photos in this filter.<br>Upload media to R2 and reference paths in <code>resume_pack.json</code>.</p>';
  }
  if (loadMore) {
    const more = items.length > _galVisibleCount;
    loadMore.hidden = !more;
    loadMore.textContent = `Load more (${items.length - _galVisibleCount} remaining)`;
  }
}

function openGalleryModal(entry) {
  const modal = $('#gallery-modal');
  if (!modal) return;

  const ctx = galleryContextFromEntry(entry);
  _galContext = ctx;

  $('#gal-date').textContent  = ctx.date  || '';
  $('#gal-title').textContent = ctx.title || 'Untitled';

  const typeTag = ctx.type || 'Milestone';
  const tags    = (ctx.tags || []).slice(0, 6);
  $('#gal-pills').innerHTML = [typeTag, ...tags]
    .map((p, i) => `<span class="tl-pill${i === 0 ? ' tl-pill-type' : ''}">${esc(p)}</span>`)
    .join('');

  const detEl = $('#gal-details');
  if (ctx.details) {
    detEl.innerHTML = esc(ctx.details).replace(/\n/g, '<br>');
    detEl.style.display = '';
  } else {
    detEl.style.display = 'none';
  }

  _galAllItems = (ctx.media || []).filter(m => m.type === 'image' || m.type === 'video');
  _galVisibleCount = GAL_PAGE_SIZE;
  _galTagFilter = 'all';

  const tagFilters = $('#gal-tag-filters');
  const galTags = collectGalleryTags(_galAllItems);
  if (tagFilters) {
    if (galTags.length) {
      tagFilters.hidden = false;
      tagFilters.innerHTML = ['all', ...galTags].map(t =>
        `<button type="button" class="glass-btn gal-tag-filter${t === 'all' ? ' active' : ''}" data-gal-tag="${esc(t)}">${t === 'all' ? 'All' : esc(t)}</button>`
      ).join('');
    } else {
      tagFilters.hidden = true;
      tagFilters.innerHTML = '';
    }
  }

  renderGalleryGrid();

  const links = ctx.links || [];
  const linksEl = $('#gal-links');
  let linksHtml = links.map(l =>
    `<a href="${esc(l.url)}" class="gallery-link-btn" target="_blank" rel="noopener">${esc(l.label || l.url)} &#x2197;</a>`
  ).join('');
  if (ctx.timelineRef) {
    linksHtml += `<a href="${esc(siteUrl('3d-resume/'))}#ch-timeline" class="gallery-link-btn">View on career timeline &#x2197;</a>`;
  }
  if (linksHtml) {
    linksEl.innerHTML = linksHtml;
    linksEl.hidden = false;
  } else {
    linksEl.innerHTML = '';
    linksEl.hidden = true;
  }

  if (entry && entry.id && DATA.projectById[entry.id]) {
    updateOgMeta(entry);
    try {
      history.replaceState(null, '', `#project=${encodeURIComponent(entry.id)}`);
    } catch (_) {}
  }

  closeLightbox();
  const bodyEl = $('#gallery-body');
  if (bodyEl) bodyEl.scrollTop = 0;

  const savedScrollY = window.scrollY;
  modal.showModal();
  window.scrollTo({ top: savedScrollY, behavior: 'instant' });
  requestAnimationFrame(() => window.scrollTo({ top: savedScrollY, behavior: 'instant' }));

  const orb = document.getElementById('cursor-orb');
  if (orb?.hidePopover) {
    try { orb.hidePopover(); orb.showPopover(); } catch (_) {}
  }
}

function openLightbox(index) {
  _galIdx = index;
  const lb = $('#gallery-lightbox');
  if (lb) lb.removeAttribute('hidden');
  renderLightboxSlide();
}

function closeLightbox() {
  const lb = $('#gallery-lightbox');
  if (!lb || lb.hasAttribute('hidden')) return;
  const v = lb.querySelector('video');
  if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
  lb.setAttribute('hidden', '');
}

function renderLightboxSlide() {
  if (!_galItems.length) return;
  _galIdx = ((_galIdx % _galItems.length) + _galItems.length) % _galItems.length;
  const item = _galItems[_galIdx];
  const stage = $('#lb-stage');
  if (item.type === 'image') {
    stage.innerHTML = `<img src="${esc(resolveMediaUrl(item.src))}" alt="${esc(item.caption || '')}" loading="eager">`;
  } else {
    stage.innerHTML = `<video controls autoplay playsinline${item.poster ? ` poster="${esc(resolveMediaUrl(item.poster))}"` : ''}>
      <source src="${esc(resolveMediaUrl(item.src))}">
    </video>`;
  }
  $('#lb-caption').textContent = item.caption || '';
  $('#lb-counter').textContent = `${_galIdx + 1} / ${_galItems.length}`;
  $('#lb-prev').style.display = _galItems.length > 1 ? '' : 'none';
  $('#lb-next').style.display = _galItems.length > 1 ? '' : 'none';
}

/* Animated close — adds .gallery-closing, waits for the outro to finish,
   then calls the native dialog close so the backdrop also fades out.      */
function closeGalleryModal() {
  const modal = $('#gallery-modal');
  if (!modal?.open) return;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    modal.classList.remove('gallery-closing');
    modal.close();
    if (window.location.hash.startsWith('#project=')) {
      try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch (_) {}
    }
  };
  modal.classList.add('gallery-closing');
  modal.addEventListener('animationend', finish, { once: true });
  setTimeout(finish, 600); /* fallback if animationend never fires */
}

function setupGalleryModal() {
  const modal = $('#gallery-modal');
  if (!modal) return;

  /* Close button & click-outside */
  $('#gallery-close').addEventListener('click', closeGalleryModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeGalleryModal(); });

  /* Lightbox controls */
  $('#lb-close').addEventListener('click', closeLightbox);
  $('#lb-prev').addEventListener('click', () => { _galIdx--; renderLightboxSlide(); });
  $('#lb-next').addEventListener('click', () => { _galIdx++; renderLightboxSlide(); });

  /* Touch swipe in lightbox */
  let _touchX = null;
  const lb = $('#gallery-lightbox');
  lb.addEventListener('touchstart', e => { _touchX = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', e => {
    if (_touchX === null) return;
    const dx = e.changedTouches[0].clientX - _touchX;
    if (Math.abs(dx) > 44) { _galIdx += (dx < 0 ? 1 : -1); renderLightboxSlide(); }
    _touchX = null;
  }, { passive: true });

  /* Grid click → open lightbox */
  $('#gal-grid').addEventListener('click', e => {
    const btn = e.target.closest('[data-gal-idx]');
    if (btn) openLightbox(parseInt(btn.dataset.galIdx, 10));
  });

  const loadMore = $('#gal-load-more');
  if (loadMore) {
    loadMore.addEventListener('click', () => {
      _galVisibleCount += GAL_PAGE_SIZE;
      renderGalleryGrid();
    });
  }

  const tagFilters = $('#gal-tag-filters');
  if (tagFilters) {
    tagFilters.addEventListener('click', e => {
      const btn = e.target.closest('[data-gal-tag]');
      if (!btn) return;
      _galTagFilter = btn.dataset.galTag;
      _galVisibleCount = GAL_PAGE_SIZE;
      tagFilters.querySelectorAll('.gal-tag-filter').forEach(b => b.classList.toggle('active', b === btn));
      renderGalleryGrid();
    });
  }

  /* Keyboard nav inside modal */
  modal.addEventListener('keydown', e => {
    const lbOpen = !$('#gallery-lightbox').hasAttribute('hidden');
    if (lbOpen) {
      if (e.key === 'ArrowLeft')  { e.preventDefault(); _galIdx--; renderLightboxSlide(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); _galIdx++; renderLightboxSlide(); }
      if (e.key === 'Escape')     { e.preventDefault(); closeLightbox(); }
    }
  });

  /* Intercept the browser's native Escape-to-close so the outro animation plays */
  modal.addEventListener('cancel', e => {
    e.preventDefault();
    closeGalleryModal();
  });

  /* Clean up video on modal close */
  modal.addEventListener('close', closeLightbox);
}

function setupDiscoverFilters() {
  const wrap = $('#discover-filters');
  const grid = $('#discover-grid');
  if (!wrap) return;
  wrap.addEventListener('click', e => {
    const btn = e.target.closest('[data-disc-cat]');
    if (!btn) return;
    _discCategory = btn.dataset.discCat;
    wrap.querySelectorAll('.disc-filter').forEach(b => b.classList.toggle('active', b === btn));
    renderDiscover();
  });
  if (grid) {
    grid.addEventListener('click', e => {
      const tile = e.target.closest('[data-proj-id]');
      if (!tile) return;
      const p = getProject(tile.dataset.projId);
      if (p) openGalleryModal(p);
    });
  }
}

function setupProjectsSearch() {
  const input = $('#projects-search');
  const wrap = $('#projects-filters');
  if (input) {
    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => renderProjects(input.value), 200);
    });
  }
  if (wrap) {
    wrap.addEventListener('click', e => {
      const btn = e.target.closest('[data-proj-cat]');
      if (!btn) return;
      _projCategory = btn.dataset.projCat;
      wrap.querySelectorAll('.proj-filter').forEach(b => b.classList.toggle('active', b === btn));
      renderProjects(input ? input.value : '');
    });
  }
  const grid = $('#projects-grid');
  if (grid) {
    grid.addEventListener('click', e => {
      if (e.target.closest('.proj-timeline-link')) return;
      const hit = e.target.closest('[data-proj-id]');
      if (!hit) return;
      const p = getProject(hit.dataset.projId);
      if (p) openGalleryModal(p);
    });
  }
}

function openProjectFromHash() {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash.startsWith('project=')) return;
  const slug = decodeURIComponent(hash.slice('project='.length));
  const project = (DATA.projects || []).find(p => p.id === slug || p.slug === slug);
  if (project) {
    requestAnimationFrame(() => openGalleryModal(project));
  }
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

/* ==========================================================
   TIMELINE SEARCH + ZOOM
   ========================================================== */
function setupTimelineSearch() {
  const input = $('#timeline-search');
  if (!input) return;
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => renderTimeline(input.value), 200);
  });
}

function setupTimelineZoom() {
  const range  = $('#tl-zoom-range');
  const btnIn  = $('#tl-zoom-in');
  const btnOut = $('#tl-zoom-out');
  const btnRst = $('#tl-zoom-reset');
  if (!range) return;

  range.addEventListener('input', () => applyTimelineZoom(parseInt(range.value, 10) / 100));
  btnIn.addEventListener('click',  () => applyTimelineZoom(tlZoom + TL_ZOOM_STEP));
  btnOut.addEventListener('click', () => applyTimelineZoom(tlZoom - TL_ZOOM_STEP));
  /* Reset = return to "perfect fit" zoom */
  btnRst.addEventListener('click', () => applyTimelineZoom(fitZoom));

  /* Ctrl/Cmd + wheel to zoom */
  const wrap = document.querySelector('.tl-wrap');
  if (wrap) {
    wrap.addEventListener('wheel', e => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      applyTimelineZoom(tlZoom - e.deltaY * 0.001);
    }, { passive: false });
  }

  /* After one layout pass the container has its real width — compute the exact
     "fit" zoom so all items fill the panel edge-to-edge, then re-render cleanly. */
  requestAnimationFrame(() => {
    fitZoom = computeFitZoom(DATA.timeline.length);
    range.min  = Math.max(10, Math.floor(fitZoom * 100 * 0.15));
    tlZoom     = Math.max(TL_ZOOM_MIN, Math.min(TL_ZOOM_MAX, fitZoom));
    range.value = Math.round(tlZoom * 100);
    const lbl = $('#tl-zoom-label');
    if (lbl) lbl.textContent = Math.round(tlZoom * 100) + '%';
    /* Full re-render at the correct zoom so ruler and track are pixel-perfect */
    renderTimeline($('#timeline-search') ? $('#timeline-search').value : '');
  });
}

/* ==========================================================
   PARTICLE HIGHLIGHTS
   ========================================================== */
function highlightParticles(active) {
  if (!particles || reducedMotion) return;
  const colors = particleGeo.attributes.aColor.array;
  const count = colors.length / 3;
  for (let i = 0; i < count; i++) {
    const v = active ? (Math.random() > 0.65 ? 1.5 : 0.2) : 1.0;
    colors[i * 3] = v; colors[i * 3 + 1] = v; colors[i * 3 + 2] = v;
  }
  particleGeo.attributes.aColor.needsUpdate = true;
}

function resetParticleColors() {
  if (!particles) return;
  particleGeo.attributes.aColor.array.set(particleBaseColors);
  particleGeo.attributes.aColor.needsUpdate = true;
}

/* ==========================================================
   CONTROLS
   ========================================================== */
function setupControls() {
  const motionBtn   = $('#btn-motion');
  const motionIcon  = $('#motion-icon');
  const motionLabel = $('#motion-label');
  const qualityBtn  = $('#btn-quality');
  const qualityIcon = $('#quality-icon');
  const qualityLbl  = $('#quality-label');
  const levels = ['high', 'medium', 'low'];

  function syncMotion() {
    document.body.classList.toggle('reduced-motion', reducedMotion);
    if (motionIcon)  motionIcon.textContent  = reducedMotion ? '\u25CC' : '\u29BF';
    if (motionLabel) motionLabel.textContent  = reducedMotion ? 'Particle Motion: Off' : 'Particle Motion: On';
    if (motionBtn)   motionBtn.title          = reducedMotion ? 'Enable Particle Motion' : 'Disable Particle Motion';
  }

  function syncQuality() {
    const icons   = { high: '\u25C6', medium: '\u25C7', low: '\u25CB' };
    const labels  = { high: 'Render Quality: High', medium: 'Render Quality: Medium', low: 'Render Quality: Low' };
    if (qualityIcon) qualityIcon.textContent = icons[qualityLevel]  || '\u25C6';
    if (qualityLbl)  qualityLbl.textContent  = labels[qualityLevel] || 'Render Quality: High';
    if (qualityBtn)  qualityBtn.title        = `Render Quality: ${qualityLevel}`;
    if (renderer) renderer.setPixelRatio(Math.min(window.devicePixelRatio, TUNING.dpr[qualityLevel]));
    nebulaPlanes.forEach(p => { p.visible = qualityLevel !== 'low'; });
    if (constellationLines) constellationLines.visible = qualityLevel === 'high';
    if (ambientParticles)   ambientParticles.visible   = qualityLevel !== 'low';
  }

  syncMotion();
  syncQuality();

  if (motionBtn)  motionBtn.addEventListener('click',  () => { reducedMotion = !reducedMotion; syncMotion(); });
  if (qualityBtn) qualityBtn.addEventListener('click', () => {
    const i = levels.indexOf(qualityLevel);
    qualityLevel = levels[(i + 1) % levels.length];
    syncQuality();
  });
}

/* ==========================================================
   IMPORT / EXPORT
   ========================================================== */
function buildCurrentPack() {
  return {
    version: 2,
    config: DATA.config || {},
    projects: DATA.projects || [],
    resume: {
      profile: DATA.profile,
      hero: {
        primary_domains: DATA.hero.primaryDomains.join(' \u2022 '),
        focus: DATA.hero.focus.join(' \u2022 '),
        style: DATA.hero.style.join(' \u2022 '),
        chips: DATA.hero.chips,
      },
      mvv: DATA.mvv,
      jobs: DATA.jobs,
      education: DATA.education,
      passions: DATA.passions,
      capabilities: DATA.capabilities,
    },
    timeline: DATA.timeline,
    skills_markdown: null,
  };
}

function applyImport(jsonText) {
  const statusEl = $('#import-status');
  try {
    const pack = JSON.parse(jsonText);
    if (!pack || typeof pack !== 'object') throw new Error('Invalid JSON structure.');
    DATA = packToData(pack);
    localStorage.setItem(LS_KEY, JSON.stringify(pack));
    renderAll();
    ScrollTrigger.refresh();
    statusEl.textContent = '\u2713 Import applied. Page content updated.';
    statusEl.className = 'settings-status ok';
  } catch (e) {
    statusEl.textContent = '\u2717 Error: ' + e.message;
    statusEl.className = 'settings-status err';
  }
}

function setupImport() {
  const modal    = $('#settings-modal');
  const openBtn  = $('#btn-import');
  const closeBtn = $('#settings-close');
  const applyBtn = $('#btn-import-apply');
  const fileBtn  = $('#btn-import-file');
  const fileIn   = $('#import-file-input');
  const exportBtn= $('#btn-export');
  const resetBtn = $('#btn-reset-data');
  const jsonArea = $('#import-json');
  const statusEl = $('#import-status');
  if (!modal || !openBtn) return;

  openBtn.addEventListener('click', () => { statusEl.textContent = ''; statusEl.className = 'settings-status'; jsonArea.value = ''; modal.showModal(); });
  closeBtn.addEventListener('click', () => modal.close());
  modal.addEventListener('click', e => { if (e.target === modal) modal.close(); });
  applyBtn.addEventListener('click', () => {
    const text = jsonArea.value.trim();
    if (!text) { statusEl.textContent = 'Paste JSON above first.'; statusEl.className = 'settings-status err'; return; }
    applyImport(text);
  });
  fileBtn.addEventListener('click', () => fileIn.click());
  fileIn.addEventListener('change', () => {
    const file = fileIn.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => { jsonArea.value = e.target.result; applyImport(e.target.result); };
    reader.readAsText(file);
    fileIn.value = '';
  });
  exportBtn.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(buildCurrentPack(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'resume_pack.json'; a.click();
    URL.revokeObjectURL(url);
    statusEl.textContent = '\u2713 Exported.'; statusEl.className = 'settings-status ok';
  });
  resetBtn.addEventListener('click', () => {
    if (!confirm('Reset all resume data to defaults? This cannot be undone.')) return;
    localStorage.removeItem(LS_KEY);
    DATA = { profile: SEED.profile, hero: SEED.hero, mvv: SEED.mvv, jobs: SEED.jobs, education: SEED.education, passions: SEED.passions, capabilities: SEED.capabilities, timeline: SEED.timeline, skillsTree: SEED.skillsTree };
    renderAll(); ScrollTrigger.refresh();
    statusEl.textContent = '\u2713 Reset to defaults.'; statusEl.className = 'settings-status ok';
  });
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
  /* Recompute fit zoom so significance thresholds stay correct after resize */
  const newFit = computeFitZoom(DATA.timeline.length);
  if (newFit > 0) fitZoom = newFit;
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
  if (frameCount % 6 === 0) document.documentElement.style.setProperty('--scroll-progress', scrollProgress.toFixed(3));
  if (composer) composer.render();
  else renderer.render(scene, camera);
}

/* ==========================================================
   SHARE BUTTON
   ========================================================== */
function setupShare() {
  const wrap  = document.getElementById('share-wrap');
  const btn   = document.getElementById('share-btn');
  const popup = document.getElementById('share-popup');
  if (!btn || !popup) return;

  const PAGE_URL  = window.location.href;
  const PAGE_TEXT = 'Explore Isaac Norris\'s interactive portfolio.';

  function openPopup() {
    popup.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
  }
  function closePopup() {
    popup.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    popup.classList.contains('is-open') ? closePopup() : openPopup();
  });

  /* Close on outside click */
  document.addEventListener('click', e => {
    if (wrap && !wrap.contains(e.target)) closePopup();
  });

  /* Facebook */
  const fbBtn = document.getElementById('share-facebook');
  if (fbBtn) {
    fbBtn.href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(PAGE_URL)}`;
    fbBtn.addEventListener('click', closePopup);
  }

  /* LinkedIn */
  const liBtn = document.getElementById('share-linkedin');
  if (liBtn) {
    liBtn.href = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(PAGE_URL)}`;
    liBtn.addEventListener('click', closePopup);
  }

  /* SMS / Text */
  const smsBtn = document.getElementById('share-sms');
  if (smsBtn) {
    const smsBody = `${PAGE_TEXT} ${PAGE_URL}`;
    /* iOS uses &body=, Android uses ?body= — the semicolon variant works on both */
    smsBtn.href = `sms:?&body=${encodeURIComponent(smsBody)}`;
    smsBtn.addEventListener('click', closePopup);
  }

  /* Copy link */
  const copyBtn   = document.getElementById('share-copy');
  const copyIcon  = document.getElementById('share-copy-icon');
  const copyLabel = document.getElementById('share-copy-label');
  if (copyBtn && copyIcon && copyLabel) {
    copyBtn.addEventListener('click', async () => {
      closePopup();
      try {
        await navigator.clipboard.writeText(PAGE_URL);
        copyIcon.textContent  = '✓';
        copyLabel.textContent = 'Copied!';
        copyBtn.classList.add('share-copied');
        setTimeout(() => {
          copyIcon.textContent  = '⊗';
          copyLabel.textContent = 'Copy Link';
          copyBtn.classList.remove('share-copied');
        }, 2200);
      } catch (_) {
        copyLabel.textContent = 'Unavailable';
        setTimeout(() => { copyLabel.textContent = 'Copy Link'; }, 2000);
      }
    });
  }
}

/* ==========================================================
   SUPPRESS NATIVE BROWSER TOOLTIPS
   ========================================================== */
function suppressTooltips() {
  /* Strip existing title attributes */
  document.querySelectorAll('[title]').forEach(el => el.removeAttribute('title'));

  /* Observe future DOM additions (e.g. dynamically rendered cards) */
  const mo = new MutationObserver(mutations => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.hasAttribute('title')) node.removeAttribute('title');
        node.querySelectorAll('[title]').forEach(el => el.removeAttribute('title'));
      }
    }
  });
  mo.observe(document.body, { subtree: true, childList: true });
}

/* ==========================================================
   CUSTOM CURSOR
   ========================================================== */
function setupCursor() {
  const orb = document.getElementById('cursor-orb');
  if (!orb || window.matchMedia('(hover: none), (pointer: coarse)').matches) return;

  /* Place cursor in the browser top layer so it renders above showModal()
     dialogs. Falls back gracefully in browsers without Popover API.     */
  try { orb.showPopover(); } catch (_) { /* no popover support — z-index fallback */ }

  /* Position is set DIRECTLY from mousemove — zero lag, no lerp */
  let mx = -200, my = -200;
  /* Scale only is lerped for smooth hover/click spring */
  let ts = 1.0, cs = 1.0;
  let isOverInteractive = false;
  let hasEntered = false;

  const INTERACTIVE = [
    'a', 'button', '[role="button"]', 'label', 'summary',
    '.ctrl-btn', '.snav-btn', '.theme-swatch', '.glass-btn',
    '.skill-node', '.tl-entry', '.tl-btn', '.tl-summary', '.gallery-thumb', '.gallery-link-btn', '.lb-nav', '.lb-close', 'select',
    '.hero-site-link', '.share-option', '#share-btn', '#share-facebook', '#share-sms',
    '.disc-tile', '.proj-card-hit', '.site-switch-link', '.gal-tag-filter', '#gal-load-more',
  ].join(', ');

  function applyTransform() {
    /* translate3d forces the element onto its own GPU compositor layer */
    orb.style.transform =
      `translate3d(${mx}px,${my}px,0) translate(-50%,-50%) scale(${cs.toFixed(4)})`;
  }

  /* pointermove fires at the full hardware polling rate (up to 1000 Hz),
     unlike mousemove which is throttled to ~60 Hz by the browser.
     Apply transform directly in the handler — no rAF, no batching.    */
  document.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return; /* ignore touch events */
    mx = e.clientX; my = e.clientY;
    if (!hasEntered) { orb.classList.add('is-visible'); hasEntered = true; }
    applyTransform();
  }, { passive: true });

  document.addEventListener('mouseleave', () => orb.classList.remove('is-visible'));
  document.addEventListener('mouseenter', () => { if (hasEntered) orb.classList.add('is-visible'); });

  document.addEventListener('mousedown', () => { ts = 0.72; });
  document.addEventListener('mouseup',   () => { ts = isOverInteractive ? 1.35 : 1.0; });

  document.addEventListener('mouseover', e => {
    if (e.target.closest(INTERACTIVE)) {
      isOverInteractive = true; ts = 1.35;
      document.body.classList.add('cursor-hover');
    }
  });
  document.addEventListener('mouseout', e => {
    if (e.target.closest(INTERACTIVE)) {
      isOverInteractive = false; ts = 1.0;
      document.body.classList.remove('cursor-hover');
    }
  });

  /* rAF loop handles ONLY the scale spring — very cheap */
  (function scaleTick() {
    if (Math.abs(ts - cs) > 0.0005) {
      cs += (ts - cs) * 0.14;
      applyTransform();
    }
    requestAnimationFrame(scaleTick);
  })();
}

/* ==========================================================
   INIT
   ========================================================== */
async function init() {
  /* Apply saved color theme immediately — before paint to avoid flash */
  applyColorTheme(loadColorTheme());

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

  /* Try external data file first — if it loads, override localStorage/defaults */
  const externalData = await fetchExternalData();
  if (externalData) {
    DATA = externalData;
  }

  const apiBase = getApiBaseUrl(DATA.config);
  if (apiBase) {
    const cmsPack = await fetchPublicProjects(apiBase);
    if (cmsPack) DATA = applyCmsProjects(DATA, cmsPack);
  }

  renderAll();
  setupScroll();
  setupNav();
  setupDiscoverFilters();
  setupProjectsSearch();
  setupSearch();
  setupTimelineSearch();
  setupTimelineZoom();
  setupControls();
  setupThemes();
  setupShare();
  suppressTooltips();
  setupCursor();
  setupModal();
  setupGalleryModal();
  setupImport();
  openProjectFromHash();
  window.addEventListener('hashchange', openProjectFromHash);
  window.addEventListener('resize', onResize);
  animate();
}

function handleInitError(err) {
  console.error('Portfolio init failed:', err);
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
