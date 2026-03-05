import * as THREE from 'three';
import * as DATA from './data.js';

/* ==========================================================
   GLOBALS
   ========================================================== */
const { gsap, ScrollTrigger } = window;
gsap.registerPlugin(ScrollTrigger);

const IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;
const PREFERS_REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let reducedMotion = PREFERS_REDUCED;
let qualityLevel = IS_MOBILE ? 'low' : 'high';

const QUALITY = {
  high:   { particles: 2500, stars: 600, dpr: 2   },
  medium: { particles: 1500, stars: 400, dpr: 1.5 },
  low:    { particles: 700,  stars: 200, dpr: 1   },
};

const NUM_CHAPTERS = 6;
let scrollProgress = 0;

/* ==========================================================
   WEBGL CHECK
   ========================================================== */
function supportsWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

/* ==========================================================
   THREE.JS SCENE
   ========================================================== */
let scene, camera, renderer, clock;
let particles, particleGeo, particlePositions, particleBaseColors;
let stars;
let formationTargets = [];
let time = 0;

function initScene() {
  const canvas = document.getElementById('bg-canvas');
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.position.set(0, 0, 50);

  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: !IS_MOBILE });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY[qualityLevel].dpr));
  clock = new THREE.Clock();
}

/* ==========================================================
   GLOW TEXTURE (procedural sprite)
   ========================================================== */
function createGlowTexture() {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.15, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

/* ==========================================================
   STARFIELD
   ========================================================== */
function createStarfield(count) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3]     = (Math.random() - 0.5) * 300;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 300;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 200 - 60;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.25,
    color: 0xffffff,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    sizeAttenuation: true,
  });
  stars = new THREE.Points(geo, mat);
  scene.add(stars);
}

/* ==========================================================
   PARTICLE FORMATION GENERATORS
   ========================================================== */
function genSphereCloud(count) {
  const p = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const phi = Math.acos(2 * Math.random() - 1);
    const theta = Math.random() * Math.PI * 2;
    const r = 8 + Math.random() * 18;
    p[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    p[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    p[i * 3 + 2] = r * Math.cos(phi);
  }
  return p;
}

function genRectGrid(count) {
  const p = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    p[i * 3]     = (Math.random() - 0.5) * 16;
    p[i * 3 + 1] = (Math.random() - 0.5) * 10 + 2;
    p[i * 3 + 2] = (Math.random() - 0.5) * 3;
  }
  return p;
}

function genCascade(count) {
  const p = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const t = i / count;
    p[i * 3]     = (Math.random() - 0.5) * 12 + 4;
    p[i * 3 + 1] = (t - 0.5) * 16 + (Math.random() - 0.5) * 2;
    p[i * 3 + 2] = (Math.random() - 0.5) * 4;
  }
  return p;
}

function genConstellation(count) {
  const cats = 10;
  const golden = 2.399963;
  const p = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const cat = i % cats;
    const phi = Math.acos(1 - 2 * (cat + 0.5) / cats);
    const theta = cat * golden;
    const cx = 15 * Math.sin(phi) * Math.cos(theta) - 2;
    const cy = 15 * Math.cos(phi) + 2;
    const cz = 15 * Math.sin(phi) * Math.sin(theta);
    p[i * 3]     = cx + (Math.random() - 0.5) * 5;
    p[i * 3 + 1] = cy + (Math.random() - 0.5) * 5;
    p[i * 3 + 2] = cz + (Math.random() - 0.5) * 5;
  }
  return p;
}

function genFlowPath(count) {
  const p = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const t = i / count;
    p[i * 3]     = (t - 0.5) * 35 + 6;
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
    p[i * 3]     = cx + r * Math.sin(theta) * Math.cos(phi);
    p[i * 3 + 1] = r * Math.sin(theta) * Math.sin(phi);
    p[i * 3 + 2] = r * Math.cos(theta);
  }
  return p;
}

const FORMATION_FNS = [genSphereCloud, genRectGrid, genCascade, genConstellation, genFlowPath, genTwinIslands];

/* ==========================================================
   PARTICLE SYSTEM
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

  for (let ch = 0; ch < NUM_CHAPTERS; ch++) {
    formationTargets.push(FORMATION_FNS[ch](count));
  }

  particlePositions.set(formationTargets[0]);

  for (let i = 0; i < count; i++) {
    const c = PALETTE[i % PALETTE.length];
    particleBaseColors[i * 3]     = c.r;
    particleBaseColors[i * 3 + 1] = c.g;
    particleBaseColors[i * 3 + 2] = c.b;
  }
  colors.set(particleBaseColors);

  particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  particleGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    size: IS_MOBILE ? 0.22 : 0.28,
    map: createGlowTexture(),
    transparent: true,
    opacity: 0.72,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexColors: true,
    sizeAttenuation: true,
  });

  particles = new THREE.Points(particleGeo, mat);
  scene.add(particles);
}

/* ==========================================================
   PARTICLE UPDATE (morph + noise)
   ========================================================== */
function updateParticles(t, dt) {
  if (reducedMotion || !particles) return;
  const count = particlePositions.length / 3;

  const raw = scrollProgress * (NUM_CHAPTERS - 1);
  const from = Math.min(NUM_CHAPTERS - 1, Math.floor(raw));
  const to = Math.min(NUM_CHAPTERS - 1, from + 1);
  const blend = raw - from;

  const fromArr = formationTargets[from];
  const toArr   = formationTargets[to];
  const lerpSpeed = Math.min(1, 2.8 * dt);

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    const tx = fromArr[i3]     + (toArr[i3]     - fromArr[i3])     * blend;
    const ty = fromArr[i3 + 1] + (toArr[i3 + 1] - fromArr[i3 + 1]) * blend;
    const tz = fromArr[i3 + 2] + (toArr[i3 + 2] - fromArr[i3 + 2]) * blend;

    particlePositions[i3]     += (tx - particlePositions[i3])     * lerpSpeed;
    particlePositions[i3 + 1] += (ty - particlePositions[i3 + 1]) * lerpSpeed;
    particlePositions[i3 + 2] += (tz - particlePositions[i3 + 2]) * lerpSpeed;

    const ns = 0.06;
    particlePositions[i3]     += Math.sin(t * 0.5 + i * 0.037) * ns;
    particlePositions[i3 + 1] += Math.cos(t * 0.4 + i * 0.029) * ns;
    particlePositions[i3 + 2] += Math.sin(t * 0.3 + i * 0.043) * ns;
  }
  particleGeo.attributes.position.needsUpdate = true;
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
    tl.to(camera.position, { x: 0, y: 1.5, z: 38, duration: 1, ease: 'none' })
      .to(camera.position, { x: 3, y: -0.5, z: 32, duration: 1, ease: 'none' })
      .to(camera.position, { x: -2, y: 2,   z: 42, duration: 1, ease: 'none' })
      .to(camera.position, { x: 4, y: -1,   z: 35, duration: 1, ease: 'none' })
      .to(camera.position, { x: 0, y: 0,    z: 48, duration: 1, ease: 'none' });
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
      scrollTrigger: {
        trigger: section,
        start: 'top 82%',
        toggleActions: 'play none none reverse',
      },
      y: 50,
      opacity: 0,
      scale: 0.96,
      duration: 0.9,
      ease: 'power2.out',
    });
  });
}

/* ==========================================================
   HTML HELPERS
   ========================================================== */
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

/* ==========================================================
   UI RENDERING
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
    <div class="kpi-group">
      <div class="kpi-label">Primary Domains</div>
      <div class="kpi-chips">${DATA.hero.primaryDomains.map(d => `<span class="kpi-chip">${esc(d)}</span>`).join('')}</div>
    </div>
    <div class="kpi-group">
      <div class="kpi-label">Focus</div>
      <div class="kpi-chips">${DATA.hero.focus.map(f => `<span class="kpi-chip">${esc(f)}</span>`).join('')}</div>
    </div>
    <div class="kpi-group">
      <div class="kpi-label">Style</div>
      <div class="kpi-chips">${DATA.hero.style.map(s => `<span class="kpi-chip">${esc(s)}</span>`).join('')}</div>
    </div>
  `;
}

function renderJobs() {
  const el = $('#jobs-list');
  const reversed = DATA.jobs.slice().reverse();
  el.innerHTML = `
    <h3 class="sub-heading">Work History</h3>
    ${reversed.map((j, i) => `
      <div class="job-card" tabindex="0" role="button" data-type="job" data-idx="${i}">
        <div class="job-header">
          <div class="job-title">${esc(j.title)}</div>
          <div class="job-dates">${esc(j.dates)}</div>
        </div>
        <div class="job-preview">${esc(j.details.slice(0, 2).join(' \u2022 '))}</div>
        <div class="job-tags">${j.tags.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>
      </div>
    `).join('')}
    <h3 class="sub-heading" style="margin-top:20px">Education</h3>
    ${DATA.education.map((e, i) => `
      <div class="job-card" tabindex="0" role="button" data-type="edu" data-idx="${i}">
        <div class="job-header">
          <div class="job-title">${esc(e.title)}</div>
          <div class="job-dates">${esc(e.dates)}</div>
        </div>
        <div class="job-preview">${esc(e.details.join(' \u2022 '))}</div>
        <div class="job-tags">${e.tags.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>
      </div>
    `).join('')}
  `;

  $$('.job-card', el).forEach(card => {
    const handler = () => {
      const type = card.dataset.type;
      const idx = parseInt(card.dataset.idx, 10);
      const item = type === 'job' ? DATA.jobs.slice().reverse()[idx] : DATA.education[idx];
      openModal(item.title, item.dates, item.details.map(d => '\u2022 ' + d).join('\n'));
    };
    card.addEventListener('click', handler);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
    });
  });
}

function renderSkillNode(node, depth) {
  const cls = depth === 0 ? 'skill-l1' : depth === 1 ? 'skill-l2' : 'skill-l3';
  const open = depth === 0 ? ' open' : '';
  const items = (node.items || []).length
    ? `<ul class="skill-bullets">${node.items.map(b => `<li>${esc(b)}</li>`).join('')}</ul>`
    : '';
  const kids = (node.children || []).map(ch => renderSkillNode(ch, depth + 1)).join('');
  if (!items && !kids) return '';
  return `<details class="skill-node ${cls}"${open}><summary><span>${esc(node.title)}</span><span class="skill-caret"></span></summary><div class="skill-body">${items}${kids}</div></details>`;
}

function renderSkills() {
  $('#skills-tree').innerHTML = DATA.skillsTree.map(n => renderSkillNode(n, 0)).join('');
}

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
    </div>
  `).join('');

  $$('.timeline-entry', el).forEach(row => {
    const handler = () => {
      const entry = sorted[parseInt(row.dataset.idx, 10)];
      openModal(entry.title, `${entry.date} \u2022 ${entry.type}`, entry.details || '');
    };
    row.addEventListener('click', handler);
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
    });
  });
}

function renderPassions() {
  $('#passions-list').innerHTML = `<div class="passions-grid">${DATA.passions.map(p => `<div class="passion-bubble">${esc(p)}</div>`).join('')}</div>`;

  $('#caps-list').innerHTML = DATA.capabilities.map(g => `
    <div class="cap-group">
      <h3 class="cap-group-title">${esc(g.group)}</h3>
      <ul class="cap-items">${g.items.map(it => `<li>${esc(it)}</li>`).join('')}</ul>
    </div>
  `).join('');
}

function renderFooter() {
  const site = $('#footer-site');
  site.href = DATA.profile.site;
  site.textContent = DATA.profile.site.replace('https://', '');
  const email = $('#footer-email');
  email.href = `mailto:${DATA.profile.email}`;
  email.textContent = DATA.profile.email;
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
  $('#detail-modal').addEventListener('click', e => {
    if (e.target === $('#detail-modal')) $('#detail-modal').close();
  });
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
    n.style.display = '';
    n.open = true;
    let p = n.parentElement;
    while (p && p.id !== 'skills-tree') {
      if (p.tagName === 'DETAILS') { p.style.display = ''; p.open = true; }
      p = p.parentElement;
    }
  });
  highlightParticles(true);
}

function highlightParticles(active) {
  if (!particles || reducedMotion) return;
  const colors = particleGeo.attributes.color.array;
  const count = colors.length / 3;
  for (let i = 0; i < count; i++) {
    const factor = active ? (Math.random() > 0.65 ? 1.4 : 0.25) : 1;
    colors[i * 3]     = Math.min(1, particleBaseColors[i * 3]     * factor);
    colors[i * 3 + 1] = Math.min(1, particleBaseColors[i * 3 + 1] * factor);
    colors[i * 3 + 2] = Math.min(1, particleBaseColors[i * 3 + 2] * factor);
  }
  particleGeo.attributes.color.needsUpdate = true;
}

function resetParticleColors() {
  if (!particles) return;
  particleGeo.attributes.color.array.set(particleBaseColors);
  particleGeo.attributes.color.needsUpdate = true;
}

/* ==========================================================
   CONTROLS
   ========================================================== */
function setupControls() {
  const motionBtn = $('#btn-motion');
  const motionIcon = $('#motion-icon');
  const qualityBtn = $('#btn-quality');
  const qualityIcon = $('#quality-icon');
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
    if (renderer) renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY[qualityLevel].dpr));
  }

  syncMotion();
  syncQuality();

  motionBtn.addEventListener('click', () => { reducedMotion = !reducedMotion; syncMotion(); });
  qualityBtn.addEventListener('click', () => {
    const idx = levels.indexOf(qualityLevel);
    qualityLevel = levels[(idx + 1) % levels.length];
    syncQuality();
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
}

/* ==========================================================
   ANIMATION LOOP
   ========================================================== */
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  time += dt;

  updateParticles(time, dt);

  if (stars && !reducedMotion) {
    stars.rotation.y = time * 0.003;
    stars.rotation.x = time * 0.001;
  }

  if (particles && !reducedMotion) {
    particles.rotation.y = Math.sin(time * 0.08) * 0.015;
  }

  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
}

/* ==========================================================
   INIT
   ========================================================== */
function init() {
  if (!supportsWebGL()) {
    $('#fallback').classList.add('active');
    $('#content').style.display = 'none';
    $('#controls').style.display = 'none';
    return;
  }

  const q = QUALITY[qualityLevel];

  initScene();
  createStarfield(q.stars);
  createParticles(q.particles);

  renderHero();
  renderSummary();
  renderJobs();
  renderSkills();
  renderTimeline();
  renderPassions();
  renderFooter();

  setupScroll();
  setupSearch();
  setupControls();
  setupModal();

  window.addEventListener('resize', onResize);
  animate();
}

try {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
} catch (err) {
  console.error('3D Resume init failed:', err);
  const fb = document.getElementById('fallback');
  if (fb) fb.classList.add('active');
  const ct = document.getElementById('content');
  if (ct) ct.style.display = 'none';
}
