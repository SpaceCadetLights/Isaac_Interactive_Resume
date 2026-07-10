/**
 * 3D tilted ring gallery for Explore My Highlights.
 * items: { projectId, title, subtitle, imageUrl|null }[]
 */
import * as THREE from 'three';

const TILT_RAD = THREE.MathUtils.degToRad(24);
const RING_RADIUS = 4.2;
const CARD_W = 1.75;
const CARD_H = 1.1;
const CARD_THICK = 0.028;

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
  ctx.strokeStyle = 'rgba(124,247,255,0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(24, 24, 592, 352);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = '600 26px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = String(title || 'Highlight').split(/\s+/);
  const mid = Math.ceil(lines.length / 2);
  ctx.fillText(lines.slice(0, mid).join(' '), 320, 188);
  if (lines.length > 1) ctx.fillText(lines.slice(mid).join(' '), 320, 222);
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
    this.dragMoved = false;
    this.spinVelocity = this.reducedMotion ? 0 : 0.22;
    this.manualSpin = 0;
    this.focusIndex = 0;
    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this._tmpVec = new THREE.Vector3();

    this._initScene();
    this._buildRing().then(() => {
      this._initPost();
      this._bindEvents();
      this._observeVisibility();
      this._resize();
      this._animate();
      this._updateCaption();
    });
  }

  _initScene() {
    const w = this.wrap.clientWidth || 800;
    const h = this.wrap.clientHeight || 480;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x080c18, 0.055);
    this.scene.background = null;

    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 80);
    this.camera.position.set(0, 0.85, 7.2);
    this.camera.lookAt(0, -0.15, 0);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.ringGroup = new THREE.Group();
    this.ringGroup.rotation.x = TILT_RAD;
    this.scene.add(this.ringGroup);

    const rimLight = new THREE.AmbientLight(0x8899cc, 0.35);
    this.scene.add(rimLight);
    const key = new THREE.DirectionalLight(0x7cf7ff, 0.45);
    key.position.set(2, 4, 6);
    this.scene.add(key);
  }

  async _buildRing() {
    const n = this.items.length;
    const planeGeo = new THREE.PlaneGeometry(CARD_W, CARD_H);
    const backGeo = new THREE.PlaneGeometry(CARD_W, CARD_H);
    const edgeGeo = new THREE.PlaneGeometry(CARD_W + 0.06, CARD_H + 0.06);

    const textures = await Promise.all(
      this.items.map((item) => loadTexture(item.imageUrl)),
    );

    for (let i = 0; i < n; i++) {
      const item = this.items[i];
      const group = new THREE.Group();
      const angle = (i / n) * Math.PI * 2;
      group.position.x = Math.sin(angle) * RING_RADIUS;
      group.position.z = Math.cos(angle) * RING_RADIUS;
      group.rotation.y = Math.PI / 2 - angle;

      const tex = textures[i] || makePlaceholderTexture(item.title);
      const frontMat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 1,
        side: THREE.FrontSide,
        depthWrite: true,
      });
      const backMat = new THREE.MeshBasicMaterial({
        color: 0x0a0e1c,
        transparent: true,
        opacity: 0.72,
        side: THREE.FrontSide,
      });
      const edgeMat = new THREE.MeshBasicMaterial({
        color: 0x1a2848,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
      });

      const edge = new THREE.Mesh(edgeGeo, edgeMat);
      edge.position.z = -CARD_THICK * 0.5 - 0.001;
      group.add(edge);

      const back = new THREE.Mesh(backGeo, backMat);
      back.position.z = -CARD_THICK;
      back.rotation.y = Math.PI;
      group.add(back);

      const front = new THREE.Mesh(planeGeo, frontMat);
      front.position.z = 0.001;
      front.userData = { projectId: item.projectId, pickable: true };
      group.add(front);

      const frame = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(CARD_W, CARD_H)),
        new THREE.LineBasicMaterial({ color: 0x7cf7ff, transparent: true, opacity: 0.35 }),
      );
      frame.position.z = 0.002;
      group.add(frame);

      this.ringGroup.add(group);
      this.cards.push({
        group,
        front,
        frontMat,
        backMat,
        edgeMat,
        frame,
        item,
        baseAngle: angle,
      });
    }
  }

  async _initPost() {
    if (this.reducedMotion) return;
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    if (isMobile) return;

    try {
      const [ecm, rpm, bpm] = await Promise.all([
        import('three/addons/postprocessing/EffectComposer.js'),
        import('three/addons/postprocessing/RenderPass.js'),
        import('three/addons/postprocessing/BokehPass.js'),
      ]);
      const w = this.wrap.clientWidth;
      const h = this.wrap.clientHeight;
      this.composer = new ecm.EffectComposer(this.renderer);
      this.composer.addPass(new rpm.RenderPass(this.scene, this.camera));
      this.bokehPass = new bpm.BokehPass(this.scene, this.camera, {
        focus: 6.5,
        aperture: 0.00012,
        maxblur: 0.012,
        width: w,
        height: h,
      });
      this.composer.addPass(this.bokehPass);
    } catch (e) {
      console.warn('Discover ring DOF unavailable:', e.message);
    }
  }

  _bindEvents() {
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);

    this._onPointerDown = (e) => {
      if (e.button !== 0) return;
      this.isDragging = true;
      this.dragMoved = false;
      this.dragLastX = e.clientX;
      this.wrap.classList.add('is-dragging');
      this.canvas.setPointerCapture(e.pointerId);
    };
    this._onPointerMove = (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.dragLastX;
      if (Math.abs(dx) > 3) this.dragMoved = true;
      this.dragLastX = e.clientX;
      this.manualSpin += dx * 0.004;
      this.spinVelocity = 0;
    };
    this._onPointerUp = (e) => {
      if (!this.isDragging) return;
      this.isDragging = false;
      this.wrap.classList.remove('is-dragging');
      try { this.canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      if (!this.reducedMotion) this.spinVelocity = 0.18;
    };
    this._onClick = (e) => {
      if (this.dragMoved) {
        this.dragMoved = false;
        return;
      }
      const rect = this.canvas.getBoundingClientRect();
      this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObjects(
        this.cards.map(c => c.front),
        false,
      );
      if (hits[0]?.object?.userData?.projectId) {
        this.onSelect(hits[0].object.userData.projectId);
      }
    };

    this.canvas.addEventListener('pointerdown', this._onPointerDown);
    this.canvas.addEventListener('pointermove', this._onPointerMove);
    this.canvas.addEventListener('pointerup', this._onPointerUp);
    this.canvas.addEventListener('pointercancel', this._onPointerUp);
    this.canvas.addEventListener('click', this._onClick);

    this._onEnter = () => { if (!this.isDragging) this.spinVelocity = 0; };
    this._onLeave = () => {
      if (!this.isDragging && !this.reducedMotion) this.spinVelocity = 0.22;
    };
    this.wrap.addEventListener('mouseenter', this._onEnter);
    this.wrap.addEventListener('mouseleave', this._onLeave);
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
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    if (this.composer) this.composer.setSize(w, h);
    if (this.bokehPass) {
      this.bokehPass.uniforms.aspect.value = this.camera.aspect;
    }
  }

  _getFocusCard() {
    let best = null;
    let bestDist = Infinity;
    for (let i = 0; i < this.cards.length; i++) {
      const card = this.cards[i];
      card.group.getWorldPosition(this._tmpVec);
      const dist = this.camera.position.distanceTo(this._tmpVec);
      if (dist < bestDist) {
        bestDist = dist;
        best = { card, index: i, dist };
      }
    }
    return best;
  }

  _updateDepthStyles(focusDist) {
    for (const card of this.cards) {
      card.group.getWorldPosition(this._tmpVec);
      const dist = this.camera.position.distanceTo(this._tmpVec);
      const delta = Math.abs(dist - focusDist);
      const t = Math.min(1, delta / 3.8);
      const near = 1 - t;

      card.frontMat.opacity = 0.38 + near * 0.62;
      card.backMat.opacity = 0.25 + near * 0.5;
      card.edgeMat.opacity = 0.35 + near * 0.55;
      if (card.frame?.material) card.frame.material.opacity = 0.12 + near * 0.55;

      const scale = 0.78 + near * 0.28;
      card.group.scale.set(scale, scale, scale);

      const darken = 1 - t * 0.42;
      card.frontMat.color.setScalar(darken);
    }
  }

  _updateCaption() {
    if (!this.captionEl) return;
    const focus = this._getFocusCard();
    if (!focus) {
      this.captionEl.hidden = true;
      return;
    }
    const { title, subtitle } = focus.card.item;
    this.captionEl.hidden = false;
    this.captionEl.innerHTML = `
      <div class="discover-ring-caption-title">${escapeHtml(title)}</div>
      ${subtitle ? `<div class="discover-ring-caption-sub">${escapeHtml(subtitle)}</div>` : ''}
      <div class="discover-ring-caption-hint">Click to open · drag to spin</div>`;
    this.focusIndex = focus.index;
  }

  _animate() {
    this._raf = requestAnimationFrame(() => this._animate());
    if (!this.visible) return;

    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (!this.reducedMotion && !this.isDragging) {
      this.ringGroup.rotation.y += this.spinVelocity * dt;
    }
    this.ringGroup.rotation.y += this.manualSpin;
    this.manualSpin *= 0.92;

    const focus = this._getFocusCard();
    const focusDist = focus?.dist ?? 6.5;
    this._updateDepthStyles(focusDist);

    if (this.bokehPass) {
      this.bokehPass.uniforms.focus.value = focusDist;
    }

    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);

    if (focus && focus.index !== this.focusIndex) this._updateCaption();
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    this._observer?.disconnect();
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    this.canvas.removeEventListener('pointermove', this._onPointerMove);
    this.canvas.removeEventListener('pointerup', this._onPointerUp);
    this.canvas.removeEventListener('pointercancel', this._onPointerUp);
    this.canvas.removeEventListener('click', this._onClick);
    this.wrap.removeEventListener('mouseenter', this._onEnter);
    this.wrap.removeEventListener('mouseleave', this._onLeave);

    for (const card of this.cards) {
      card.frontMat.map?.dispose();
      card.frontMat.dispose();
      card.backMat.dispose();
      card.edgeMat.dispose();
      card.front.geometry.dispose();
      card.back.geometry.dispose();
      card.edge.geometry.dispose();
    }
    this.renderer.dispose();
    this.composer = null;
    this.bokehPass = null;
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
