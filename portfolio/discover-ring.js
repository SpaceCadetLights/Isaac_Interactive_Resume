/**
 * 3D tilted ring gallery for Explore My Highlights.
 * items: { projectId, title, subtitle, imageUrl|null }[]
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const TILT_RAD = THREE.MathUtils.degToRad(16);
const RING_RADIUS = 3.4;
const CARD_W = 1.7;
const CARD_H = 1.08;
const CARD_THICK = 0.092;
const CARD_RADIUS = 0.11;
const DRAG_SPIN = 0.0026;
const SWIPE_COMMIT_PX = 36;
const CAMERA_Z = 6.35;
const CAMERA_Y = 0.28;
const FOCUS_Y = 0.44;

let instance = null;

function supportsWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

function makePlaceholderTexture(title) {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 400;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 640, 400);
  g.addColorStop(0, '#142e5c');
  g.addColorStop(0.5, '#281858');
  g.addColorStop(1, '#0d2840');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 640, 400);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = '600 26px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = String(title || 'Highlight').split(/\s+/);
  const mid = Math.ceil(lines.length / 2);
  ctx.fillText(lines.slice(0, mid).join(' '), 320, 188);
  if (lines.length > 1) ctx.fillText(lines.slice(mid).join(' '), 320, 220);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function loadTexture(url) {
  return new Promise((resolve) => {
    if (!url) {
      resolve(null);
      return;
    }
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        resolve(tex);
      },
      undefined,
      () => resolve(null),
    );
  });
}

/** Rolling FPS governor — lowers quality when the device struggles. */
class PerfGovernor {
  constructor() {
    this.tier = 'high';
    this.samples = [];
    this.lastTierChange = performance.now();
  }

  sample(frameMs) {
    this.samples.push(frameMs);
    if (this.samples.length > 90) this.samples.shift();
    if (this.samples.length < 30) return;
    const now = performance.now();
    if (now - this.lastTierChange < 1800) return;

    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    const fps = 1000 / avg;
    const prev = this.tier;

    if (fps < 22 && this.tier !== 'low') this.tier = 'low';
    else if (fps < 34 && this.tier === 'high') this.tier = 'medium';
    else if (fps > 52 && this.tier === 'low') this.tier = 'medium';
    else if (fps > 58 && this.tier === 'medium') this.tier = 'high';

    if (prev !== this.tier) {
      this.lastTierChange = now;
      this.samples = [];
    }
  }

  get pixelRatioCap() {
    return { high: 2, medium: 1.35, low: 1 }[this.tier];
  }

  get spinScale() {
    return { high: 1, medium: 0.65, low: 0.35 }[this.tier];
  }

  get useDepthBlur() {
    return false;
  }

  get useFog() {
    return this.tier !== 'low';
  }

  get antialias() {
    return this.tier === 'high';
  }
}

class DiscoverRing {
  constructor(wrap, captionEl, items, options) {
    this.wrap = wrap;
    this.captionEl = captionEl;
    this.items = items;
    this.options = options;
    this.reducedMotion = !!options.reducedMotion;
    this.onSelect = options.onSelect || (() => {});

    this.canvas = wrap.querySelector('#discover-ring-canvas');
    this.cards = [];
    this.visible = true;
    this.isDragging = false;
    this.dragLastX = 0;
    this.dragTotalX = 0;
    this.dragStartIndex = 0;
    this.dragStartRotation = 0;
    this.dragMoved = false;
    this.spinVelocity = 0;
    this.manualSpin = 0;
    this.isSnapping = false;
    this.snapTargetY = 0;
    this.focusIndex = 0;
    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this._tmpVec = new THREE.Vector3();
    this._tmpVec2 = new THREE.Vector3();
    this._tmpQuat = new THREE.Quaternion();
    this._parentQuat = new THREE.Quaternion();
    this._worldQuat = new THREE.Quaternion();
    this._tmpMat4 = new THREE.Matrix4();
    this._tiltAxis = new THREE.Vector3(1, 0, 0);
    this.perf = new PerfGovernor();
    this._frameMs = 0;
    this._pageScrollUntil = 0;

    this._initScene();
    this.cardGeo = null;
    this._buildRing().then(() => {
      this._bindEvents();
      this._observeVisibility();
      this._resize();
      this._startSnapToIndex(0, true);
      this._animate();
      this._updateCaption();
    });
  }

  _initScene() {
    const w = this.wrap.clientWidth || 800;
    const h = this.wrap.clientHeight || 480;

    this.scene = new THREE.Scene();
    this.scene.background = null;

    this.camera = new THREE.PerspectiveCamera(32, w / h, 0.1, 80);
    this.camera.position.set(0, CAMERA_Y, CAMERA_Z);
    this.camera.lookAt(0, FOCUS_Y, 0);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 0);
    this._applyPixelRatio();
    this.renderer.setSize(w, h, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.ringPivot = new THREE.Group();
    this.ringPivot.position.y = 1.02;
    this.ringPivot.rotation.x = TILT_RAD;
    this.scene.add(this.ringPivot);

    this.ringGroup = new THREE.Group();
    this.ringPivot.add(this.ringGroup);

    this.scene.add(new THREE.HemisphereLight(0xb8c8e8, 0x1a2030, 0.95));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));

    this.keyLight = new THREE.DirectionalLight(0xffffff, 0.85);
    this.keyLight.position.set(0.5, 1.8, CAMERA_Z + 1);
    this.scene.add(this.keyLight);

    this.fillLight = new THREE.PointLight(0xffffff, 0.9, 22);
    this.fillLight.position.set(0, 0.5, CAMERA_Z - 0.8);
    this.scene.add(this.fillLight);

    const rim = new THREE.DirectionalLight(0x9ce8ff, 0.28);
    rim.position.set(-2.5, 0.8, 2);
    this.scene.add(rim);
  }

  _applyPixelRatio() {
    const cap = this.perf.pixelRatioCap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
  }

  _createCardMaterials(frontTexture) {
    const edgeMat = new THREE.MeshStandardMaterial({
      color: 0xd8e8f8,
      roughness: 0.06,
      metalness: 0.02,
      transparent: false,
      opacity: 1,
    });

    const frontMat = new THREE.MeshBasicMaterial({
      map: frontTexture,
    });

    const backMat = new THREE.MeshStandardMaterial({
      color: 0x9aa8c8,
      roughness: 0.12,
      metalness: 0.08,
      transparent: false,
      opacity: 1,
    });

    return [edgeMat, edgeMat, edgeMat, edgeMat, frontMat, backMat];
  }

  async _buildRing() {
    const n = this.items.length;
    const cardGeo = new RoundedBoxGeometry(CARD_W, CARD_H, CARD_THICK, 6, CARD_RADIUS);
    this.cardGeo = cardGeo;

    const textures = await Promise.all(
      this.items.map((item) => loadTexture(item.imageUrl)),
    );

    for (let i = 0; i < n; i++) {
      const item = this.items[i];
      const angle = (i / n) * Math.PI * 2;

      const tex = textures[i] || makePlaceholderTexture(item.title);
      const materials = this._createCardMaterials(tex);
      const mesh = new THREE.Mesh(cardGeo, materials);

      mesh.userData = { projectId: item.projectId, pickable: true, baseAngle: angle };

      this.scene.add(mesh);
      this.cards.push({
        mesh,
        frontMat: materials[4],
        backMat: materials[5],
        edgeMats: materials.slice(0, 4),
        item,
        baseAngle: angle,
      });
    }
  }

  _syncQualityTier() {
    this._applyPixelRatio();
  }

  _bindEvents() {
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);

    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(this.wrap);

    this._onPageScroll = () => {
      this._pageScrollUntil = performance.now() + 160;
    };
    window.addEventListener('scroll', this._onPageScroll, { passive: true });

    this._onPointerDown = (e) => {
      if (e.button !== 0) return;
      this.isDragging = true;
      this.isSnapping = false;
      this.dragMoved = false;
      this.dragLastX = e.clientX;
      this.dragTotalX = 0;
      this.dragStartIndex = this._getNearestCardIndex();
      this.dragStartRotation = this.ringGroup.rotation.y;
      this.wrap.classList.add('is-dragging');
      if (this.wrap.setPointerCapture) this.wrap.setPointerCapture(e.pointerId);
    };
    this._onPointerMove = (e) => {
      if (!this.isDragging) return;
      e.preventDefault();
      const dx = e.clientX - this.dragLastX;
      if (Math.abs(dx) > 2) this.dragMoved = true;
      this.dragLastX = e.clientX;
      this.dragTotalX += dx;
      this.spinVelocity = 0;
      this._applyDragRotation();
    };
    this._onPointerUp = (e) => {
      if (!this.isDragging) return;
      this.isDragging = false;
      this.wrap.classList.remove('is-dragging');
      try { this.wrap.releasePointerCapture(e.pointerId); } catch (_) {}
      this._magneticSnapAfterDrag();
    };
    this._onClick = (e) => {
      if (this.dragMoved) {
        this.dragMoved = false;
        return;
      }
      const rect = this.wrap.getBoundingClientRect();
      this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObjects(
        this.cards.map(c => c.mesh),
        false,
      );
      if (hits[0]?.object?.userData?.projectId) {
        this.onSelect(hits[0].object.userData.projectId);
      }
    };

    this.wrap.addEventListener('pointerdown', this._onPointerDown);
    this.wrap.addEventListener('pointermove', this._onPointerMove);
    this.wrap.addEventListener('pointerup', this._onPointerUp);
    this.wrap.addEventListener('pointercancel', this._onPointerUp);
    this.wrap.addEventListener('click', this._onClick);
    this._onTouchMove = (e) => {
      if (this.isDragging) e.preventDefault();
    };
    this.wrap.addEventListener('touchmove', this._onTouchMove, { passive: false });
  }

  _observeVisibility() {
    this._observer = new IntersectionObserver(
      (entries) => { this.visible = entries[0]?.isIntersecting ?? true; },
      { threshold: 0.08 },
    );
    this._observer.observe(this.wrap);
  }

  _resize() {
    const w = this.wrap.clientWidth;
    const h = this.wrap.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this._centerRingFrame(h);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  _centerRingFrame(h) {
    const t = THREE.MathUtils.clamp((h - 300) / 220, 0, 1);
    this.ringPivot.position.y = THREE.MathUtils.lerp(0.88, 1.02, t);
    const focusY = THREE.MathUtils.lerp(0.36, 0.46, t);
    this.camera.position.set(0, CAMERA_Y, CAMERA_Z);
    this.camera.lookAt(0, focusY, 0);
    this._focusY = focusY;
  }

  _normalizeAngle(angle) {
    return ((angle % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
  }

  _rotationForCard(index) {
    return -this.cards[index].baseAngle;
  }

  _getNearestCardIndex() {
    const n = this.cards.length;
    if (!n) return 0;
    const step = (Math.PI * 2) / n;
    const idx = Math.round(-this.ringGroup.rotation.y / step);
    return ((idx % n) + n) % n;
  }

  _startSnapToIndex(index, immediate = false) {
    if (!this.cards.length) return;
    const n = this.cards.length;
    const clamped = ((index % n) + n) % n;
    this.snapTargetY = this._rotationForCard(clamped);
    this.isSnapping = !immediate;
    this.spinVelocity = 0;
    this.manualSpin = 0;
    if (immediate) {
      this.ringGroup.rotation.y = this.snapTargetY;
      this.isSnapping = false;
    }
    this.focusIndex = clamped;
  }

  _applyDragRotation() {
    const n = this.cards.length;
    if (!n) return;
    const step = (Math.PI * 2) / n;
    const maxOff = step * 0.96;
    let off = this.dragTotalX * DRAG_SPIN;
    off = THREE.MathUtils.clamp(off, -maxOff, maxOff);
    this.ringGroup.rotation.y = this.dragStartRotation + off;
  }

  _magneticSnapAfterDrag() {
    const n = this.cards.length;
    if (!n) return;

    let targetIndex = this.dragStartIndex;
    if (Math.abs(this.dragTotalX) > SWIPE_COMMIT_PX) {
      const dir = this.dragTotalX > 0 ? -1 : 1;
      targetIndex = ((this.dragStartIndex + dir) % n + n) % n;
    }

    this._startSnapToIndex(targetIndex);
    this.dragTotalX = 0;
  }

  _snapToTarget(dt) {
    if (!this.isSnapping) return;

    let delta = this._normalizeAngle(this.snapTargetY - this.ringGroup.rotation.y);
    const step = delta * Math.min(1, dt * 11);
    this.ringGroup.rotation.y += step;

    if (Math.abs(delta) < 0.003) {
      this.ringGroup.rotation.y = this.snapTargetY;
      this.isSnapping = false;
    }
  }

  _updateCardLayout() {
    const spin = this.ringGroup.rotation.y;
    const cam = this.camera.position;
    const pivotY = this.ringPivot.position.y;

    for (const card of this.cards) {
      const mesh = card.mesh;
      const angle = card.baseAngle + spin;
      const x = Math.sin(angle) * RING_RADIUS;
      const z = Math.cos(angle) * RING_RADIUS;

      this._tmpVec.set(x, 0, z);
      this._tmpVec.applyAxisAngle(this._tiltAxis, TILT_RAD);
      this._tmpVec.y += pivotY;
      mesh.position.copy(this._tmpVec);
      const dx = cam.x - mesh.position.x;
      const dz = cam.z - mesh.position.z;
      mesh.rotation.set(0, Math.atan2(dx, dz), 0);
    }
  }

  /** Front card = best alignment with camera view axis. */
  _getFocusCard() {
    let best = null;
    let bestScore = -Infinity;

    for (let i = 0; i < this.cards.length; i++) {
      const card = this.cards[i];
      card.mesh.getWorldPosition(this._tmpVec);
      const dist = this.camera.position.distanceTo(this._tmpVec);
      const zCam = this._tmpVec.z;
      const score = zCam - dist * 0.08;

      if (score > bestScore) {
        bestScore = score;
        best = { card, index: i, dist };
      }
    }
    return best;
  }

  _updateDepthStyles(focusDist) {
    for (const card of this.cards) {
      card.mesh.getWorldPosition(this._tmpVec);
      const dist = this.camera.position.distanceTo(this._tmpVec);
      const delta = Math.abs(dist - focusDist);
      const depthT = Math.min(1, delta / 2.2);
      const zCam = this._tmpVec.z;
      const frontness = Math.max(0, Math.min(1, (zCam + RING_RADIUS) / (RING_RADIUS * 2)));
      const near = frontness * (1 - depthT * 0.5);

      const scale = 0.9 + near * 0.14;
      card.mesh.scale.setScalar(scale);
    }
  }

  _snapToFocus() {
    if (this.isDragging || this.isSnapping || this.reducedMotion) return;
    const nearest = this._getNearestCardIndex();
    const delta = this._normalizeAngle(this._rotationForCard(nearest) - this.ringGroup.rotation.y);
    if (Math.abs(delta) > 0.015) {
      this._startSnapToIndex(nearest);
    }
  }

  _updateCaption() {
    if (!this.captionEl) return;
    this.captionEl.hidden = true;
  }

  _animate() {
    this._raf = requestAnimationFrame(() => this._animate());
    if (!this.visible) return;

    const pageScrolling = performance.now() < this._pageScrollUntil;
    if (pageScrolling && !this.isDragging) return;

    const dt = Math.min(this.clock.getDelta(), 0.05);
    const frameStart = performance.now();

    if (this.isDragging) {
      this._applyDragRotation();
    } else {
      this._snapToTarget(dt);
      if (!this.isSnapping && !this.reducedMotion) {
        this._snapToFocus();
      }
    }

    this._updateCardLayout();

    const focus = this._getFocusCard();
    const focusDist = focus?.dist ?? (CAMERA_Z - RING_RADIUS);
    this._updateDepthStyles(focusDist);

    this.renderer.render(this.scene, this.camera);

    if (focus && focus.index !== this.focusIndex) this._updateCaption();

    this._frameMs = performance.now() - frameStart;
    const prevTier = this.perf.tier;
    this.perf.sample(this._frameMs);
    if (prevTier !== this.perf.tier) this._syncQualityTier();
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    this._resizeObserver?.disconnect();
    this._observer?.disconnect();
    window.removeEventListener('scroll', this._onPageScroll);
    this.wrap.removeEventListener('pointerdown', this._onPointerDown);
    this.wrap.removeEventListener('pointermove', this._onPointerMove);
    this.wrap.removeEventListener('pointerup', this._onPointerUp);
    this.wrap.removeEventListener('pointercancel', this._onPointerUp);
    this.wrap.removeEventListener('click', this._onClick);
    this.wrap.removeEventListener('touchmove', this._onTouchMove);

    for (const card of this.cards) {
      this.scene.remove(card.mesh);
      const tex = card.frontMat.map;
      tex?.dispose?.();
      [card.frontMat, card.backMat, ...card.edgeMats].forEach((m) => m.dispose());
    }
    this.cardGeo?.dispose();
    this.renderer.dispose();
  }
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function unmountDiscoverRing() {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}

export function mountDiscoverRing(wrap, captionEl, items, options = {}) {
  unmountDiscoverRing();
  if (!wrap || !items?.length || !supportsWebGL()) return false;
  instance = new DiscoverRing(wrap, captionEl, items, options);
  return true;
}

export function refreshDiscoverRing(wrap, captionEl, items, options = {}) {
  return mountDiscoverRing(wrap, captionEl, items, options);
}
