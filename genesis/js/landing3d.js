/* Genesis landing: one continuous 3D studio. The page scroll flies the camera through it.
   Everything is drawn in code (three.js, self-hosted). Only the headset photo and the logo are images. */
import * as THREE from '../vendor/three/three.module.min.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [].slice.call(r.querySelectorAll(s));
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer:coarse)').matches;
const root = document.documentElement;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (t) => t * t * (3 - 2 * t);
const mul = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

const ROOMS = [
  ['podcast', 'Podcast', 'Warm wood, two mics, one ring of light.'],
  ['talkshow', 'Talk show', 'A desk, a sofa and the city behind you.'],
  ['classroom', 'Classroom', 'Daylight, a whiteboard and rows of desks.'],
  ['library', 'Library', 'Floor-to-ceiling shelves and a reading lamp.'],
  ['tech', 'Tech desk', 'A video wall, three screens and cool light.'],
  ['terrace', 'Terrace', 'Golden hour over the skyline.'],
];

function boot() {
  const canvas = $('#gl');
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: !coarse, powerPreference: 'high-performance' }); } catch (e) { root.classList.add('nogl'); return; }
  if (!renderer.getContext()) { root.classList.add('nogl'); return; }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = !coarse;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0F1114);
  scene.fog = new THREE.Fog(0x0F1114, 10, 58);
  const camera = new THREE.PerspectiveCamera(42, 1, .1, 220);

  /* ---------- helpers ---------- */
  const canvasTex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  const glowTex = canvasTex(128, 128, (g, w, h) => { const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.3, 'rgba(255,255,255,.35)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); });
  const halo = (color, size, op = .8, p) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: op })); s.scale.setScalar(size); if (p) p.add(s); return s; };
  const mc = {};
  const M = (color, r = .6, m = .1) => { const k = color + '|' + r + '|' + m; return mc[k] || (mc[k] = new THREE.MeshStandardMaterial({ color, roughness: r, metalness: m })); };
  const E = (color, k = 1.5) => { const m = new THREE.MeshBasicMaterial({ color }); m.color.multiplyScalar(k); return m; };
  const mesh = (geo, mat, x = 0, y = 0, z = 0, p) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); if (p) p.add(m); return m; };
  const bx = (p, w, h, d, mat, x, y, z, ry = 0, rz = 0, rx = 0) => { const m = mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z, p); m.rotation.set(rx, ry, rz); return m; };
  const cyl = (p, rt, rb, h, mat, x, y, z, seg = 28) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z, p);
  const sph = (p, r, mat, x, y, z) => mesh(new THREE.SphereGeometry(r, 20, 14), mat, x, y, z, p);
  const tor = (p, R, r, mat, x, y, z, rx = 0) => { const m = mesh(new THREE.TorusGeometry(R, r, 16, 64), mat, x, y, z, p); m.rotation.x = rx; return m; };
  const rgeo = (w, h, d, r = .05) => {
    const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    const g = new THREE.ExtrudeGeometry(s, { depth: d - .02, bevelEnabled: true, bevelSize: .01, bevelThickness: .01, bevelSegments: 2, curveSegments: 6 });
    g.translate(0, 0, -(d - .02) / 2); return g;
  };
  const chrome = M(0xdfe3e8, .14, 1), champ = M(0xD6AD70, .28, .9), char = M(0x1a1d22, .5, .35), black = M(0x0b0c0e, .45, .3);

  /* ---------- environment (soft boxes the metals reflect) ---------- */
  (() => {
    const s = new THREE.Scene(); s.background = new THREE.Color(0x07080a);
    const add = (w, h, x, y, z, c, k) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); s.add(m); };
    add(14, 7, -9, 8, 7, 0xffdfb0, 6); add(9, 9, 11, 3, -4, 0x9fe6ff, 2.4); add(24, 2, 0, 13, 0, 0xffffff, 2.2);
    add(12, 4, 0, -2, -13, 0xD6AD70, 1.8); add(8, 6, -12, 2, -6, 0xffffff, 1.2);
    const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(s, .035).texture; pm.dispose();
  })();
  scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x20150c, .35));
  const key = new THREE.SpotLight(0xffe2bd, 650, 60, .62, .7, 2); key.position.set(-5, 9, 6); key.target.position.set(2, 1.5, -2);
  key.castShadow = !coarse; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -.0004; key.shadow.camera.near = 3; key.shadow.camera.far = 40; scene.add(key, key.target);
  const rim = new THREE.PointLight(0x9fe6ff, 60, 22, 2); rim.position.set(6, 3, -4); scene.add(rim);

  /* ---------- world floor + gates + dust ---------- */
  const gridTex = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(214,173,112,.55)'; g.lineWidth = 2; g.strokeRect(0, 0, w, h); });
  gridTex.wrapS = gridTex.wrapT = THREE.RepeatWrapping; gridTex.repeat.set(24, 150);
  const floor = mesh(new THREE.PlaneGeometry(48, 300), new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: .32, metalness: .75 }), 0, 0, -120, scene); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  const grid = mesh(new THREE.PlaneGeometry(48, 300), new THREE.MeshBasicMaterial({ map: gridTex, transparent: true, opacity: .09, blending: THREE.AdditiveBlending, depthWrite: false }), 0, .004, -120, scene); grid.rotation.x = -Math.PI / 2;
  const gates = [];
  for (let z = -12; z > -112; z -= 6.5) {
    if ([0, -34, -62, -88, -114].some((s) => Math.abs(z - s) < 6)) continue;
    const g = new THREE.Group(); g.position.set(0, 3.6, z);
    tor(g, 6.4, .025, E(0xD6AD70, 1.3), 0, 0, 0).material.transparent = true;
    tor(g, 6.4, .12, E(0xD6AD70, .35), 0, 0, 0).material.transparent = true; g.children[1].material.opacity = .18;
    scene.add(g); gates.push(g);
  }
  const N = coarse ? 420 : 900, pp = new Float32Array(N * 3), dr = mul(7);
  for (let i = 0; i < N; i++) { pp[i * 3] = (dr() - .5) * 30; pp[i * 3 + 1] = dr() * 10; pp[i * 3 + 2] = 10 - dr() * 135; }
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
  const dust = new THREE.Points(pg, new THREE.PointsMaterial({ map: glowTex, size: .16, color: 0xffe9c8, transparent: true, opacity: .6, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true })); scene.add(dust);

  /* ---------- 1. HERO SET ---------- */
  const hero = new THREE.Group(); scene.add(hero);
  const wallTex = canvasTex(1024, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#15171b'); gr.addColorStop(1, '#241c15'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) { g.fillStyle = (x / 16) % 2 ? 'rgba(0,0,0,.28)' : 'rgba(214,173,112,.05)'; g.fillRect(x, 0, 8, h); }
    const r = g.createRadialGradient(w * .62, h * .55, 0, w * .62, h * .55, w * .5); r.addColorStop(0, 'rgba(214,173,112,.28)'); r.addColorStop(1, 'rgba(214,173,112,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h);
  });
  const wall = mesh(new THREE.CylinderGeometry(12, 12, 11, 80, 1, true, Math.PI - 1.0, 2.0), new THREE.MeshStandardMaterial({ map: wallTex, roughness: .85, metalness: .1, side: THREE.BackSide }), 0, 5.5, 5, hero); wall.receiveShadow = true;
  for (let i = -3; i <= 3; i++) { const a = Math.PI + i * .24; const s = bx(hero, .06, 7.5, .05, E(0xF4F0E8, 1.1), 12 * Math.sin(a), 4.2, 5 + 12 * Math.cos(a) + .05); s.rotation.y = a; }

  const screen = new THREE.Group(); screen.position.set(4.2, 2.95, -3.6); screen.rotation.y = -.2; hero.add(screen);
  const frame = mesh(rgeo(3.6, 4.7, .22, .16), M(0x23262c, .3, .85), 0, 0, 0, screen); frame.castShadow = true;
  const heroTex = new THREE.TextureLoader().load('assets/hero-vr.jpg', () => { root.classList.add('photo-ready'); }); heroTex.colorSpace = THREE.SRGBColorSpace; heroTex.anisotropy = 4;
  const disp = mesh(new THREE.PlaneGeometry(3.3, 4.38), new THREE.MeshBasicMaterial({ map: heroTex, toneMapped: false }), 0, 0, .125, screen);
  const sheen = mesh(new THREE.PlaneGeometry(3.3, 4.38), new THREE.MeshBasicMaterial({ map: canvasTex(64, 256, (g, w, h) => { const l = g.createLinearGradient(0, 0, w, h); l.addColorStop(0, 'rgba(255,255,255,.22)'); l.addColorStop(.35, 'rgba(255,255,255,0)'); l.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = l; g.fillRect(0, 0, w, h); }), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 0, 0, .13, screen);
  halo(0xD6AD70, 9, .35, screen).position.z = -.4;
  const tally = sph(screen, .05, E(0xD6AD70, 2), 1.55, 2.12, .14);

  function cineCam() {
    const g = new THREE.Group();
    const body = bx(g, .95, .75, 1.45, char, 0, 0, 0); body.castShadow = true;
    bx(g, .96, .08, 1.0, champ, 0, .42, -.1);
    const lens = cyl(g, .3, .3, .8, chrome, 0, 0, -1.1); lens.rotation.x = Math.PI / 2; lens.castShadow = true;
    const ring = cyl(g, .33, .33, .14, black, 0, 0, -.85); ring.rotation.x = Math.PI / 2;
    const glass = mesh(new THREE.CircleGeometry(.25, 40), new THREE.MeshPhysicalMaterial({ color: 0x0a1722, roughness: .05, metalness: .2, clearcoat: 1 }), 0, 0, -1.505, g); glass.rotation.y = Math.PI;
    tor(g, .27, .02, champ, 0, 0, -1.5);
    bx(g, .8, .72, .26, black, 0, 0, -1.62);
    bx(g, .5, .4, .5, char, -.72, .12, -.1);
    bx(g, .04, .4, .9, chrome, 0, .56, -.1);
    sph(g, .045, E(0xD6AD70, 2.2), .36, .3, -.65);
    return g;
  }
  const rig = new THREE.Group(); rig.position.set(3.0, 0, 0.2); rig.scale.setScalar(.8); hero.add(rig);
  const cam = cineCam(); cam.position.set(0, 2.15, 0); cam.rotation.y = .5; rig.add(cam);
  cyl(rig, .16, .16, .3, chrome, 0, 1.7, 0);
  for (let i = 0; i < 3; i++) { const a = i * TAU / 3 + .4, leg = cyl(rig, .035, .045, 2.05, M(0x2a2d33, .3, .8), Math.sin(a) * .52, .98, Math.cos(a) * .52, 10); leg.rotation.set(Math.cos(a) * .27, 0, -Math.sin(a) * .27); leg.castShadow = true; }

  const ringL = new THREE.Group(); ringL.position.set(6.2, 0, -1.2); hero.add(ringL);
  cyl(ringL, .04, .04, 2.9, chrome, 0, 1.45, 0, 12);
  for (let i = 0; i < 3; i++) { const a = i * TAU / 3, l = cyl(ringL, .025, .03, 1.1, chrome, Math.sin(a) * .42, .5, Math.cos(a) * .42, 8); l.rotation.set(Math.cos(a) * .6, 0, -Math.sin(a) * .6); }
  const lite = new THREE.Group(); lite.position.set(0, 3.05, 0); lite.rotation.y = -.6; ringL.add(lite);
  tor(lite, .95, .09, E(0xfff0d8, 2.6), 0, 0, 0); tor(lite, 1.05, .035, chrome, 0, 0, -.06);
  halo(0xffe2bd, 5.2, .55, lite).position.z = .3;
  const rlight = new THREE.PointLight(0xffe2bd, 28, 12, 2); rlight.position.set(0, 3.05, .8); ringL.add(rlight);

  const mic = new THREE.Group(); mic.position.set(.9, 0, .2); hero.add(mic);
  cyl(mic, .07, .09, 3.4, chrome, 5.6, 1.7, 0, 16); cyl(mic, .5, .6, .08, black, 5.6, .04, 0, 28);
  const boom = cyl(mic, .028, .028, 4.1, chrome, 3.6, 3.45, 0, 10); boom.rotation.z = Math.PI / 2 + .12;
  tor(mic, .1, .015, champ, 1.62, 3.2, 0, Math.PI / 2);
  const cap = mesh(new THREE.CapsuleGeometry(.14, .5, 8, 20), M(0x15171a, .35, .7), 1.62, 3.12, 0, mic); cap.rotation.z = .35;
  const grille = mesh(new THREE.CapsuleGeometry(.155, .3, 6, 18), M(0xD6AD70, .3, .9), 1.62, 3.15, 0, mic); grille.rotation.z = .35; grille.material = new THREE.MeshStandardMaterial({ color: 0xD6AD70, metalness: .9, roughness: .35, wireframe: true });
  const beamTex = canvasTex(8, 256, (g, w, h) => { const l = g.createLinearGradient(0, 0, 0, h); l.addColorStop(0, 'rgba(255,255,255,.9)'); l.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = l; g.fillRect(0, 0, w, h); });
  [[-1.6, 10, 1.2, -.12], [2.4, 10, -1.5, .1]].forEach(([x, y, z, rz]) => { const b = mesh(new THREE.CylinderGeometry(.15, 2.4, 10, 36, 1, true), new THREE.MeshBasicMaterial({ map: beamTex, color: 0xffe2bd, transparent: true, opacity: .12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), x, 5.2, z, hero); b.rotation.z = rz; });
  const orbs = [];
  [[-.4, 1.3, 4.6, .4], [1.4, 3.6, 3.2, .24], [4.4, .5, 4.0, .36]].forEach(([x, y, z, r], i) => { const o = sph(hero, r, i % 2 ? champ : chrome, x, y, z); o.castShadow = true; o.userData = { y, i }; orbs.push(o); });
  hero.children.forEach((c) => c.traverse((o) => { if (o.isMesh && o !== wall && o !== disp && o !== sheen) o.castShadow = o.castShadow || false; }));

  /* ---------- 2. ROOM DIORAMAS ---------- */
  const rooms = new THREE.Group(); rooms.position.set(0, 0, -34); scene.add(rooms);
  const plat = cyl(rooms, 6.9, 7.1, .3, M(0x1a1d22, .25, .9), 0, .15, 0, 96); tor(plat, 6.95, .035, E(0xD6AD70, 1.2), 0, .31, 0, Math.PI / 2).position.set(0, .31, 0);
  tor(rooms, 6.2, .02, E(0xF4F0E8, .8), 0, .32, 0, Math.PI / 2);
  halo(0xD6AD70, 18, .22, rooms).position.set(0, .6, 0);
  const ring = new THREE.Group(); rooms.add(ring);

  const skyline = (w, h, stops, seed, cols, sun) => canvasTex(w, h, (g) => {
    const r = mul(seed), gr = g.createLinearGradient(0, 0, 0, h); stops.forEach(([o, c]) => gr.addColorStop(o, c)); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    if (sun) { const s = g.createRadialGradient(w * .66, h * .74, 0, w * .66, h * .74, w * .4); s.addColorStop(0, 'rgba(255,230,180,.95)'); s.addColorStop(.25, 'rgba(255,200,130,.4)'); s.addColorStop(1, 'rgba(255,200,130,0)'); g.fillStyle = s; g.fillRect(0, 0, w, h); }
    cols.forEach((c, L) => { let x = -10; while (x < w) { const bw = 26 + r() * 60, bh = h * (.18 + r() * (.22 + L * .1)); g.fillStyle = c; g.fillRect(x, h - bh, bw, bh); if (L === cols.length - 1) for (let y = h - bh + 8; y < h - 6; y += 12) for (let xx = x + 5; xx < x + bw - 6; xx += 10) if (r() < .3) { g.fillStyle = r() < .5 ? '#ffd9a0' : '#ffe9c4'; g.fillRect(xx, y, 4, 6); } x += bw + 2 + r() * 4; } });
  });
  const screenTex = (seed, warm) => canvasTex(256, 160, (g, w, h) => {
    const r = mul(seed), l = g.createLinearGradient(0, 0, w, h); l.addColorStop(0, '#12313a'); l.addColorStop(1, warm ? '#4a3a22' : '#1f6a6c'); g.fillStyle = l; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 7; i++) { g.fillStyle = 'rgba(244,240,232,' + (.25 + r() * .5) + ')'; g.fillRect(14, 16 + i * 18, 40 + r() * 150, 6); }
    g.strokeStyle = '#D6AD70'; g.lineWidth = 3; g.beginPath(); for (let i = 0; i < 9; i++) g.lineTo(130 + i * 14, h - 18 - r() * 70); g.stroke();
  });
  const ledTex = canvasTex(512, 300, (g, w, h) => {
    const r = mul(11), pal = ['#12313a', '#1b5058', '#25736f', '#d6ad70', '#2a3b52', '#0f2024', '#6fe0d4'];
    for (let j = 0; j < 3; j++) for (let i = 0; i < 5; i++) { const x = i * 102 + 4, y = j * 98 + 4, l = g.createLinearGradient(x, y, x + 94, y + 90); l.addColorStop(0, pal[(r() * 7) | 0]); l.addColorStop(1, pal[(r() * 7) | 0]); g.fillStyle = l; g.fillRect(x, y, 94, 90); g.strokeStyle = 'rgba(244,240,232,.75)'; g.lineWidth = 2; g.beginPath(); for (let k = 0; k < 9; k++) g.lineTo(x + 8 + k * 10, y + 78 - r() * 56); g.stroke(); }
  });
  const deckTex = canvasTex(256, 256, (g, w, h) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#7a5a3c' : '#6c4f34'; g.fillRect(0, i * 32, w, 31); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, i * 32 + 30, w, 2); } });
  const plant = (p, x, z, s = 1) => { cyl(p, .14 * s, .1 * s, .26 * s, M(0x2a2118, .8, 0), x, .13 * s, z, 12); for (let i = 0; i < 6; i++) { const l = mesh(new THREE.ConeGeometry(.07 * s, .6 * s, 6), M(0x2d5a43, .7, 0), x + Math.cos(i * 1.05) * .11 * s, .5 * s, z + Math.sin(i * 1.05) * .11 * s, p); l.rotation.set(Math.sin(i * 1.05) * .5, 0, -Math.cos(i * 1.05) * .5); } };
  const chairA = (p, x, z, ry, col) => { const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; p.add(g); bx(g, .5, .1, .5, M(col, .6, .1), 0, .36, 0); bx(g, .5, .55, .1, M(col, .6, .1), 0, .66, -.22, 0, 0, -.1); cyl(g, .03, .03, .34, M(0x15171a, .4, .7), 0, .18, 0, 8); cyl(g, .22, .22, .03, M(0x15171a, .4, .7), 0, .02, 0, 16); };
  const pl = (p, color, k, x, y, z, s = .7) => { const l = new THREE.PointLight(color, k, 7, 2); l.position.set(x, y, z); p.add(l); return l; };

  const builders = {
    podcast(g) {
      bx(g, 3, .14, 3, M(0x2a1f17, .55, .15), 0, -.07, 0); bx(g, 3, 2.2, .12, M(0x3a2a1e, .7, .1), 0, 1.1, -1.44); bx(g, .12, 2.2, 3, M(0x33261a, .7, .1), -1.44, 1.1, 0);
      cyl(g, 1.15, 1.15, .02, M(0x4a3626, .9, 0), 0, .01, .1, 40);
      for (let r = 0; r < 4; r++) for (let c = 0; c < 7; c++) { const h = cyl(g, .17, .17, .05, M(r % 2 ? 0x43342a : 0x2f241b, .9, 0), -1.1 + c * .37 + (r % 2) * .18, .5 + r * .32, -1.36, 6); h.rotation.x = Math.PI / 2; }
      tor(g, .48, .028, E(0xE8C690, 2.2), 0, 1.5, -1.37); halo(0xD6AD70, 2.6, .5, g).position.set(0, 1.5, -1.2);
      cyl(g, .72, .72, .06, M(0x8a6a48, .4, .3), 0, .64, .1, 40); cyl(g, .07, .07, .6, M(0x17110c, .5, .3), 0, .32, .1, 12); cyl(g, .3, .3, .03, M(0x17110c, .5, .3), 0, .02, .1, 20);
      chairA(g, -1.0, .15, 1.2, 0x7a5a3c); chairA(g, 1.0, .15, -1.2, 0x7a5a3c);
      [[-.4, 1], [.4, -1]].forEach(([x, s]) => { cyl(g, .012, .012, .7, chrome, x * 1.3, 1.0, .25, 8); const a = cyl(g, .012, .012, .6, chrome, x * 1.0, 1.2, .25, 8); a.rotation.z = s * .9; mesh(new THREE.CapsuleGeometry(.04, .12, 4, 10), champ, x * .78, 1.0, .25, g); });
      [-.8, 0, .8].forEach((x) => { cyl(g, .005, .005, .6, M(0x0a0807, 1, 0), x, 1.9, .2, 6); const c = mesh(new THREE.ConeGeometry(.17, .12, 20, 1, true), M(0x171210, .6, .4), x, 1.62, .2, g); c.material.side = 2; sph(g, .05, E(0xFFD9A0, 3), x, 1.6, .2); });
      pl(g, 0xffd0a0, 14, 0, 1.6, .3);
    },
    talkshow(g) {
      bx(g, 3, .14, 3, M(0x1c1e24, .3, .6), 0, -.07, 0); bx(g, 3, 2.2, .12, M(0x141a26, .7, .1), 0, 1.1, -1.44); bx(g, .12, 2.2, 3, M(0x181d29, .7, .1), -1.44, 1.1, 0);
      mesh(new THREE.PlaneGeometry(2.0, 1.45), new THREE.MeshBasicMaterial({ map: skyline(512, 360, [[0, '#1c2740'], [.6, '#47485f'], [1, '#b88a63']], 5, ['#0e111a', '#121620', '#0a0d14']) }), 0, 1.2, -1.37, g);
      [-1.1, 1.1].forEach((x) => { for (let k = 0; k < 4; k++) bx(g, .1, 2.0, .1, M(k % 2 ? 0x2b1e2a : 0x352534, .8, 0), x + (x < 0 ? k : -k) * .1, 1.05, -1.3); });
      bx(g, .05, 1.5, .05, M(0x0b0d12, .5, .5), 0, 1.2, -1.36); bx(g, .05, 1.5, .05, M(0x0b0d12, .5, .5), -.67, 1.2, -1.36); bx(g, .05, 1.5, .05, M(0x0b0d12, .5, .5), .67, 1.2, -1.36);
      bx(g, 1.5, .07, .62, M(0xcfb892, .35, .2), -.35, .78, .25); bx(g, 1.45, .74, .05, M(0x17140f, .5, .3), -.35, .4, .54); bx(g, 1.4, .02, .02, E(0xE8C690, 2), -.35, .62, .57);
      chairA(g, -.35, -.35, 0, 0x2a2d34); bx(g, .42, .02, .3, black, -.55, .82, .22); bx(g, .4, .24, .02, M(0x5b7a9a, .3, .4), -.55, .93, .08, 0, 0, -.2);
      const sf = new THREE.Group(); sf.position.set(.95, 0, .55); sf.rotation.y = -.55; g.add(sf); bx(sf, 1.05, .32, .5, M(0x8a5a44, .8, 0), 0, .22, 0); bx(sf, 1.05, .45, .14, M(0x8a5a44, .8, 0), 0, .5, -.22); bx(sf, .14, .5, .5, M(0x74483a, .8, 0), -.55, .3, 0); bx(sf, .14, .5, .5, M(0x74483a, .8, 0), .55, .3, 0);
      plant(g, -1.15, .7, 1.4); pl(g, 0xE8C690, 9, 0, 1.8, .3); pl(g, 0x7a9cff, 4, 0, 1.2, -1);
    },
    classroom(g) {
      bx(g, 3, .14, 3, M(0xa98d68, .6, .1), 0, -.07, 0); bx(g, 3, 2.2, .12, M(0xd8cfbd, .85, 0), 0, 1.1, -1.44); bx(g, .12, 2.2, 3, M(0xcfc4ae, .85, 0), -1.44, 1.1, 0);
      bx(g, 1.7, .95, .06, M(0x8d7656, .6, .1), 0, 1.25, -1.36); bx(g, 1.6, .85, .02, M(0xf6f4ee, .3, 0), 0, 1.25, -1.32);
      [.25, .1, -.05, -.2].forEach((y, i) => bx(g, .9 - i * .12, .03, .01, M(0x27455f, .5, 0), -.2, 1.25 + y, -1.305));
      mesh(new THREE.PlaneGeometry(1.5, 1.4), E(0xfff3cf, 1.3), -1.37, 1.3, .1, g).rotation.y = Math.PI / 2;
      [-.7, 0, .7].forEach((x) => [-.35, .45].forEach((z) => { bx(g, .52, .04, .36, M(0xd3b384, .5, .1), x, .62, z); cyl(g, .02, .02, .6, M(0x2a2b2e, .4, .7), x, .31, z - .1, 6); chairA(g, x, z + .42, 3.14, 0x3b4f66); }));
      bx(g, 3, .005, .6, E(0xfff3cf, .35), 0, .01, .9);
      pl(g, 0xfff3cf, 16, -.8, 1.6, .2); pl(g, 0xffffff, 6, .6, 1.8, .6);
    },
    library(g) {
      bx(g, 3, .14, 3, M(0x3b2a1c, .5, .2), 0, -.07, 0); bx(g, 3, 2.2, .12, M(0x1d1510, .8, 0), 0, 1.1, -1.44); bx(g, .12, 2.2, 3, M(0x211711, .8, 0), -1.44, 1.1, 0);
      const cols = [0x5a2a2a, 0x2c4a3a, 0x2b3f5c, 0x7a5a2c, 0x4a3a5a, 0x6b3a22, 0x8a7048, 0x8a3a30, 0xc7b58c], r = mul(4), bk = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: .7, metalness: .05 }), 2 * 5 * 24), d = new THREE.Object3D(); let n = 0;
      for (let wall = 0; wall < 2; wall++) for (let row = 0; row < 5; row++) { bx(g, wall ? .3 : 2.8, .035, wall ? 2.8 : .3, M(0x46321f, .6, .1), wall ? -1.28 : 0, .42 + row * .36, wall ? 0 : -1.28); let t = -1.3; for (let i = 0; i < 24; i++) { const w = .05 + r() * .04, h = .22 + r() * .1; d.position.set(wall ? -1.28 : t, .42 + row * .36 + .02 + h / 2, wall ? t : -1.28); d.scale.set(wall ? .22 : w, h, wall ? w : .22); d.updateMatrix(); bk.setMatrixAt(n, d.matrix); bk.setColorAt(n, new THREE.Color(cols[(r() * cols.length) | 0])); n++; t += w + .008; if (t > 1.25) break; } }
      bk.count = n; g.add(bk);
      bx(g, 1.3, .06, .6, M(0x7a5230, .45, .2), .15, .62, .35); [[-.45, .1], [.75, .1], [-.45, .6], [.75, .6]].forEach(([x, z]) => cyl(g, .03, .03, .6, M(0x2a190d, .6, .1), x, .31, z, 8));
      const lm = mesh(new THREE.ConeGeometry(.15, .16, 20, 1, true), M(0x2f6b4a, .4, .5), -.25, .85, .3, g); lm.material.side = 2; cyl(g, .015, .015, .2, champ, -.25, .72, .3, 8); halo(0x9bf0a8, 1.1, .5, g).position.set(-.25, .85, .3);
      bx(g, .4, .015, .28, M(0xefe7d6, .6, 0), .35, .66, .35, .2); [0x8a3a30, 0x2b3f5c, 0x7a5a2c].forEach((c, i) => bx(g, .3, .05, .22, M(c, .6, 0), .8, .68 + i * .05, .4, i * .15));
      bx(g, .05, 1.8, .03, M(0x7a5230, .5, .1), -.9, .95, -1.15, 0, -.13); bx(g, .05, 1.8, .03, M(0x7a5230, .5, .1), -.62, .95, -1.15, 0, -.13); for (let i = 0; i < 6; i++) bx(g, .33, .03, .03, M(0x7a5230, .5, .1), -.76 + i * .016, .3 + i * .28, -1.12);
      sph(g, .06, E(0xffd08a, 3), -.6, 1.95, .1); halo(0xffd08a, 1.8, .6, g).position.set(-.6, 1.95, .1); sph(g, .06, E(0xffd08a, 3), .7, 1.95, .1); halo(0xffd08a, 1.8, .6, g).position.set(.7, 1.95, .1);
      pl(g, 0xffcf8a, 16, 0, 1.7, .4);
    },
    tech(g) {
      bx(g, 3, .14, 3, M(0x12151a, .25, .7), 0, -.07, 0); bx(g, 3, 2.2, .12, M(0x0c0f14, .7, .1), 0, 1.1, -1.44); bx(g, .12, 2.2, 3, M(0x10141b, .7, .1), -1.44, 1.1, 0);
      mesh(new THREE.PlaneGeometry(2.5, 1.46), new THREE.MeshBasicMaterial({ map: ledTex, toneMapped: false }), 0, 1.35, -1.37, g); halo(0x6fe0d4, 4.2, .35, g).position.set(0, 1.3, -1.1);
      bx(g, 2.7, .03, .03, E(0x6fe0d4, 2), 0, 2.15, -1.3); bx(g, .03, 2.1, .03, E(0x6fe0d4, 2), -1.36, 1.1, -1.3); bx(g, 2.7, .03, .03, E(0xD6AD70, 2), 0, .02, 1.3);
      bx(g, 2.3, .06, .8, M(0x262b33, .3, .6), 0, .72, .5); [-.7, 0, .7].forEach((x, i) => { const m = new THREE.Group(); m.position.set(x, 1.12, .4); m.rotation.y = -x * .25; g.add(m); mesh(rgeo(.7, .44, .05, .03), black, 0, 0, 0, m); mesh(new THREE.PlaneGeometry(.64, .38), new THREE.MeshBasicMaterial({ map: screenTex(i + 2, i === 1), toneMapped: false }), 0, 0, .03, m); cyl(m, .02, .02, .3, chrome, 0, -.35, -.04, 8); });
      bx(g, .6, .02, .2, black, 0, .76, .75); cyl(g, .05, .05, .09, champ, .9, .8, .65, 16);
      chairA(g, 0, 1.15, 3.14, 0x1a1d22); halo(0x6fe0d4, 3.4, .3, g).position.set(0, .9, .6);
      pl(g, 0x6fe0d4, 14, 0, 1.6, .6); pl(g, 0xD6AD70, 4, .9, .5, 1);
    },
    terrace(g) {
      bx(g, 3, .14, 3, new THREE.MeshStandardMaterial({ map: deckTex, roughness: .6 }), 0, -.07, 0);
      mesh(new THREE.PlaneGeometry(3, 2.3), new THREE.MeshBasicMaterial({ map: skyline(512, 400, [[0, '#241d3a'], [.4, '#7a4a6a'], [.7, '#e08a5a'], [1, '#f8dba0']], 6, ['#7a5072', '#4a3558', '#2b2040'], true) }), 0, 1.15, -1.45, g);
      const rail = new THREE.MeshPhysicalMaterial({ color: 0xaad6ff, transparent: true, opacity: .16, roughness: .05, metalness: 0, side: 2 }); bx(g, 3, .7, .02, rail, 0, .45, -1.3); bx(g, .02, .7, 3, rail, -1.45, .45, 0); bx(g, 3, .03, .04, chrome, 0, .82, -1.3); bx(g, .04, .03, 3, chrome, -1.45, .82, 0);
      for (let i = 0; i < 9; i++) { const t = i / 8, x = -1.3 + t * 2.6, y = 1.85 - Math.sin(t * Math.PI) * .22; sph(g, .035, E(0xffd9a0, 3), x, y, -.5); }
      cyl(g, .02, .02, 1.9, M(0x120d16, .5, .5), -1.35, .95, -.5, 8); cyl(g, .02, .02, 1.9, M(0x120d16, .5, .5), 1.35, .95, -.5, 8);
      [[-.9, .2, .4], [.9, .35, -.4]].forEach(([x, z, ry]) => { const l = new THREE.Group(); l.position.set(x, 0, z); l.rotation.y = ry; g.add(l); bx(l, .5, .08, 1.0, M(0x2a2018, .6, .1), 0, .26, 0); bx(l, .46, .06, .8, M(0xe8dcc2, .9, 0), 0, .33, .05); bx(l, .46, .06, .5, M(0xe8dcc2, .9, 0), 0, .5, -.38, 0, 0, .8); });
      cyl(g, .3, .3, .04, M(0x6a4a30, .5, .2), 0, .5, .5, 24); cyl(g, .03, .03, .5, M(0x1b120b, .5, .2), 0, .25, .5, 8); cyl(g, .02, .02, .1, E(0xf4f0e8, 1), 0, .57, .5, 8); halo(0xffd9a0, .8, .7, g).position.set(0, .62, .5);
      plant(g, 1.2, -.9, 1.5); plant(g, -1.2, .95, 1.2); halo(0xffd9a0, 3.4, .6, g).position.set(.8, 1.0, -1.35);
      pl(g, 0xffc58a, 15, 0, 1.5, .3);
    },
  };
  const rItems = ROOMS.map(([id], i) => {
    const pivot = new THREE.Group(), g = new THREE.Group(); pivot.add(g); builders[id](g);
    const hit = mesh(new THREE.BoxGeometry(3.2, 2.5, 3.2), new THREE.MeshBasicMaterial({ visible: false }), 0, 1.25, 0, g); hit.userData.room = i;
    const a = i * TAU / 6; pivot.position.set(Math.sin(a) * 4.7, .32, Math.cos(a) * 4.7);
    ring.add(pivot); return { pivot, g, hit, a, lift: 0, s: 1 };
  });

  /* ---------- 3. IRIS ---------- */
  const iris = new THREE.Group(); iris.position.set(0, 3.2, -62); scene.add(iris);
  const RP = 2.7, BL = 3.5;
  const blades = [];
  const shape = new THREE.Shape(); shape.moveTo(-.25, 0); shape.lineTo(BL, 0); shape.quadraticCurveTo(BL + .2, -.9, BL * .8, -1.7); shape.lineTo(-.25, -1.2); shape.closePath();
  const bgeo = new THREE.ExtrudeGeometry(shape, { depth: .05, bevelEnabled: true, bevelSize: .015, bevelThickness: .012, bevelSegments: 2 });
  for (let i = 0; i < 9; i++) { const ph = i * TAU / 9, b = new THREE.Group(); b.position.set(Math.cos(ph) * RP, Math.sin(ph) * RP, i * .018); const m = new THREE.Mesh(bgeo, new THREE.MeshStandardMaterial({ color: 0xd9dde3, metalness: 1, roughness: .2 + (i % 3) * .05 })); b.add(m); sph(b, .08, champ, 0, 0, .06); iris.add(b); blades.push({ b, ph }); }
  const lensTex = canvasTex(256, 256, (g, w, h) => { const r = g.createRadialGradient(128, 128, 0, 128, 128, 128); r.addColorStop(0, '#ffe9c4'); r.addColorStop(.35, '#d6a766'); r.addColorStop(.75, '#4a3320'); r.addColorStop(1, '#14100c'); g.fillStyle = r; g.fillRect(0, 0, w, h); });
  const back = mesh(new THREE.CircleGeometry(2.7, 64), new THREE.MeshBasicMaterial({ map: lensTex, toneMapped: false }), 0, 0, -.3, iris); halo(0xffe2bd, 11, .55, iris).position.z = -.4;
  tor(iris, 3.75, .16, chrome, 0, 0, .12); tor(iris, 3.45, .03, E(0xD6AD70, 1.6), 0, 0, .3); tor(iris, 4.1, .04, champ, 0, 0, .05);
  for (let i = 0; i < 24; i++) { const a = i * TAU / 24, t = bx(iris, .06, .26, .06, i % 6 ? M(0x2a2d33, .4, .8) : champ, Math.cos(a) * 3.75, Math.sin(a) * 3.75, .28); t.rotation.z = a; }

  /* ---------- 4. FEATURE OBJECTS ---------- */
  const feat = new THREE.Group(); feat.position.set(3.6, 2.2, -88); scene.add(feat);
  const wave = []; for (let i = 0; i < 11; i++) { const b = bx(feat, .2, 1, .2, i % 3 ? champ : chrome, -1.6 + i * .32, 1.0, 0); wave.push(b); }
  const l3 = new THREE.Group(); l3.position.set(-.4, -.4, .5); feat.add(l3); mesh(rgeo(3.2, .62, .1, .12), M(0x23262c, .3, .8), 0, 0, 0, l3); mesh(rgeo(.9, .62, .12, .1), champ, -1.15, 0, .02, l3); bx(l3, 1.5, .09, .02, M(0xF4F0E8, .5, 0), .35, .08, .07); bx(l3, 1.0, .06, .02, M(0xB9B3A9, .5, 0), .1, -.1, .07);
  const btn = new THREE.Group(); btn.position.set(-2.1, -1.6, .4); feat.add(btn); cyl(btn, .6, .66, .2, M(0x23262c, .3, .8), 0, 0, 0, 40); const cap2 = cyl(btn, .5, .5, .12, champ, 0, .14, 0, 40);
  [[1.4, -1.5, .3, -.3], [2.1, -1.2, -.2, .4]].forEach(([x, y, z, ry]) => { const p = new THREE.Group(); p.position.set(x, y, z); p.rotation.y = ry; feat.add(p); mesh(rgeo(.8, 1.6, .08, .12), M(0x1c1f24, .3, .8), 0, 0, 0, p); mesh(new THREE.PlaneGeometry(.7, 1.48), new THREE.MeshBasicMaterial({ map: heroTex, toneMapped: false }), 0, 0, .05, p); });
  halo(0xD6AD70, 9, .25, feat).position.set(0, 0, -1);

  /* ---------- 5. COIN ---------- */
  const coin = new THREE.Group(); coin.position.set(0, 2.5, -114); scene.add(coin);
  const logoTex = new THREE.TextureLoader().load('assets/genesis-logo-atelier.png'); logoTex.colorSpace = THREE.SRGBColorSpace; logoTex.anisotropy = 8;
  const cbody = cyl(coin, 2, 2, .38, M(0x191C20, .3, .85), 0, 0, 0, 96); cbody.rotation.x = Math.PI / 2;
  const lmat = new THREE.MeshBasicMaterial({ map: logoTex, transparent: true });
  mesh(new THREE.PlaneGeometry(2.3, 2.46), lmat, 0, 0, .2, coin); const lb = mesh(new THREE.PlaneGeometry(2.3, 2.46), lmat, 0, 0, -.2, coin); lb.rotation.y = Math.PI;
  tor(coin, 2, .1, champ, 0, 0, 0); halo(0xD6AD70, 12, .4, coin);
  const orbit = new THREE.Group(); coin.add(orbit); for (let i = 0; i < 28; i++) { const a = i * TAU / 28, s = sph(orbit, .05 + (i % 4) * .015, i % 3 ? chrome : champ, Math.cos(a) * 3.3, Math.sin(a) * .5, Math.sin(a) * 3.3); }

  /* ---------- camera path driven by scroll ---------- */
  const secs = ['#hero', '#rooms', '#how', '#features', '#close'].map((s) => $(s));
  let T = [0], K = [];
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  function layout() {
    const w = innerWidth, h = innerHeight, asp = w / h, port = asp < .85;
    renderer.setSize(w, h, false); camera.aspect = asp; camera.updateProjectionMatrix();
    const max = Math.max(1, document.documentElement.scrollHeight - h);
    T = secs.map((s) => clamp(s.offsetTop + (s.offsetHeight - h) / 2, 0, max)); T[0] = 0; T[T.length - 1] = max;
    const z = port ? 1.55 : 1;
    K = [
      { p: V(.5, 1.9, 8.8 * z + (port ? 2 : 0)), l: V(port ? 1.4 : 1.2, 1.9, 0), fov: port ? 52 : 40, oy: port ? .2 : 0, ox: port ? 0 : -.12 },
      { p: V(0, 4.6, -34 + 12.5 * (port ? 1.5 : 1)), l: V(0, 1.1, -34 + 1.2), fov: port ? 52 : 42, oy: port ? .05 : 0, ox: 0 },
      { p: V(0, 3.3, -62 + 10.5 * (port ? 1.4 : 1)), l: V(0, 3.1, -62), fov: port ? 56 : 44, oy: port ? .2 : 0, ox: port ? 0 : -.2 },
      { p: V(port ? 0 : .6, 2.6, -88 + 9.5 * (port ? 1.5 : 1)), l: V(port ? 0 : 1.4, 2.4, -88), fov: port ? 56 : 44, oy: port ? .16 : 0, ox: port ? 0 : .14 },
      { p: V(0, 2.5, -114 + 10 * (port ? 1.4 : 1)), l: V(0, 1.1, -114), fov: port ? 52 : 42, oy: port ? .12 : 0, ox: 0 },
    ];
  }
  const cur = { p: V(0, 2, 9), l: V(0, 2, 0), fov: 42, oy: 0, ox: 0, roll: 0 }, tgt = { p: V(), l: V(), fov: 42, oy: 0, ox: 0, roll: 0 };
  const ptr = { x: 0, y: 0, sx: 0, sy: 0 };
  let sy = 0, prog = 0, stopIdx = 0;
  function aim() {
    const y = scrollY; let i = 0; for (let k = 0; k < T.length - 1; k++) if (y >= T[k]) i = k; i = Math.min(i, T.length - 2);
    const span = Math.max(1, T[i + 1] - T[i]); const f = clamp((y - T[i]) / span, 0, 1); const e = smooth(clamp((f - .1) / .8, 0, 1)); const arc = Math.sin(Math.PI * e);
    const a = K[i], b = K[i + 1]; if (!a || !b) return;
    tgt.p.lerpVectors(a.p, b.p, e); tgt.l.lerpVectors(a.l, b.l, e);
    const dir = i % 2 ? -1 : 1; if (!reduce) { tgt.p.x += arc * 2.4 * dir; tgt.p.y += arc * .7; tgt.roll = arc * .07 * dir; } else tgt.roll = 0;
    tgt.fov = a.fov + (b.fov - a.fov) * e + (reduce ? 0 : arc * 7); tgt.oy = a.oy + (b.oy - a.oy) * e; tgt.ox = a.ox + (b.ox - a.ox) * e;
    prog = i + e; stopIdx = e < .5 ? i : i + 1;
  }
  const lookv = V();
  function applyCam(dt) {
    const k = reduce ? 1 : 1 - Math.exp(-dt * 5.5);
    cur.p.lerp(tgt.p, k); cur.l.lerp(tgt.l, k); cur.fov += (tgt.fov - cur.fov) * k; cur.oy += (tgt.oy - cur.oy) * k; cur.ox += (tgt.ox - cur.ox) * k; cur.roll += (tgt.roll - cur.roll) * k;
    ptr.sx += (ptr.x - ptr.sx) * (reduce ? 0 : .06); ptr.sy += (ptr.y - ptr.sy) * (reduce ? 0 : .06);
    camera.position.set(cur.p.x + ptr.sx * .55, cur.p.y - ptr.sy * .3, cur.p.z);
    lookv.set(cur.l.x + ptr.sx * .25, cur.l.y - ptr.sy * .12, cur.l.z); camera.lookAt(lookv); camera.rotateZ(cur.roll);
    if (Math.abs(camera.fov - cur.fov) > .01) { camera.fov = cur.fov; camera.updateProjectionMatrix(); }
    const w = innerWidth, h = innerHeight;
    if (cur.oy || cur.ox) camera.setViewOffset(w, h, cur.ox * w, cur.oy * h, w, h); else camera.clearViewOffset();
  }

  /* ---------- room picker ---------- */
  const stage = $('#stage'), chips = $('#roomChips'), nameEl = $('#roomName'), descEl = $('#roomDesc'), openEl = $('#roomOpen');
  let kSel = 0, ringTgt = 0, hover = -1, drag = null, idx = 0;
  const STEP = TAU / 6;
  ROOMS.forEach(([id, name], i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = name; b.dataset.i = i; b.setAttribute('aria-pressed', 'false'); chips.appendChild(b); });
  function select(i) {
    idx = i; $$('.chip', chips).forEach((c, j) => { c.setAttribute('aria-pressed', j === i ? 'true' : 'false'); });
    nameEl.textContent = ROOMS[i][1]; descEl.textContent = ROOMS[i][2]; openEl.href = 'studio.html?guest=1&env=scene-premium-' + ROOMS[i][0]; openEl.setAttribute('aria-label', 'Explore Genesis in the ' + ROOMS[i][1] + ' room');
  }
  function goto(i) { const cur0 = ((Math.round(-ringTgt / STEP) % 6) + 6) % 6; let d = ((i - cur0 + 9) % 6) - 3; kSel = Math.round(-ringTgt / STEP) + d; ringTgt = -kSel * STEP; select(i); }
  chips.addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (b) goto(+b.dataset.i); });
  addEventListener('keydown', (e) => { if (!stage.matches(':hover') && document.activeElement !== stage) return; if (e.key === 'ArrowRight') goto((idx + 1) % 6); if (e.key === 'ArrowLeft') goto((idx + 5) % 6); });
  select(0);
  const ray = new THREE.Raycaster(), nd = new THREE.Vector2();
  function pick(e) { const r = stage.getBoundingClientRect(); nd.set(((e.clientX) / innerWidth) * 2 - 1, -((e.clientY) / innerHeight) * 2 + 1); ray.setFromCamera(nd, camera); const hit = ray.intersectObjects(rItems.map((r) => r.hit), false)[0]; return hit ? hit.object.userData.room : -1; }
  stage.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, t: ringTgt, moved: 0 }; stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', (e) => {
    if (drag) { const dx = e.clientX - drag.x; drag.moved = Math.max(drag.moved, Math.abs(dx)); if (drag.moved > 6) ringTgt = drag.t + dx * .0065; }
    else { const h = pick(e); if (h !== hover) { hover = h; stage.style.cursor = h >= 0 ? 'pointer' : 'grab'; } }
  });
  const endDrag = (e) => { if (!drag) return; const moved = drag.moved; drag = null; if (moved > 6) { kSel = Math.round(-ringTgt / STEP); ringTgt = -kSel * STEP; select(((kSel % 6) + 6) % 6); } else { const h = pick(e); if (h >= 0) { if (h === idx) location.href = openEl.href; else goto(h); } } };
  stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', () => { drag = null; });
  stage.addEventListener('pointerleave', () => { hover = -1; });

  /* ---------- events ---------- */
  addEventListener('pointermove', (e) => { ptr.x = e.clientX / innerWidth - .5; ptr.y = e.clientY / innerHeight - .5; }, { passive: true });
  addEventListener('resize', () => { layout(); aim(); }, { passive: true });
  const bar = $('#prog'), top = $('#top');
  addEventListener('scroll', () => { aim(); const m = document.documentElement.scrollHeight - innerHeight; bar.style.setProperty('--p', m > 0 ? (scrollY / m).toFixed(4) : 0); top.classList.toggle('s', scrollY > 40); }, { passive: true });
  document.addEventListener('visibilitychange', () => { clock.running = !document.hidden; });

  /* ---------- loop ---------- */
  const clock = new THREE.Clock(); let pr = Math.min(devicePixelRatio, coarse ? 1.5 : 2), acc = 0, frames = 0, ready = false;
  renderer.setPixelRatio(pr);
  layout(); aim(); cur.p.copy(tgt.p); cur.l.copy(tgt.l); cur.fov = tgt.fov; cur.oy = tgt.oy; cur.ox = tgt.ox;
  function tick() {
    requestAnimationFrame(tick);
    if (document.hidden) return;
    const dt = Math.min(clock.getDelta(), .05), t = clock.elapsedTime;
    acc += dt; frames++; if (frames === 90) { if (acc / 90 > .03 && pr > 1) { pr = Math.max(1, pr - .25); renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight, false); } acc = 0; frames = 0; }
    aim(); applyCam(dt);
    const m = reduce ? 0 : 1;
    // hero
    screen.position.y = 2.95 + Math.sin(t * .8) * .06 * m; screen.rotation.y = -.2 + ptr.sx * -.2; screen.rotation.x = ptr.sy * .08;
    tally.material.color.setScalar(1.2 + Math.sin(t * 3) * .6 * m);
    cam.rotation.y = .5 + ptr.sx * -.5; cam.rotation.x = ptr.sy * .12;
    lite.rotation.y = -.6 + ptr.sx * .5; rlight.intensity = 26 + Math.sin(t * 2) * 2 * m + (1 - Math.min(1, Math.abs(ptr.sx + .1) * 3)) * 6;
    orbs.forEach((o) => { o.position.y = o.userData.y + Math.sin(t * .9 + o.userData.i * 2) * .12 * m; });
    gates.forEach((g, i) => { g.rotation.z = t * .08 * m * (i % 2 ? 1 : -1) + i; });
    dust.rotation.y = Math.sin(t * .05) * .02 * m;
    // rooms
    ring.rotation.y += (ringTgt - ring.rotation.y) * (reduce ? 1 : .09);
    rItems.forEach((it, i) => {
      const a = it.a + ring.rotation.y, f = Math.max(0, Math.cos(a)), isH = hover === i;
      const ts = .78 + .5 * f * f + (isH ? .06 : 0); it.s += (ts - it.s) * .12; it.g.scale.setScalar(it.s);
      it.lift += ((isH ? .22 : 0) - it.lift) * .12; it.pivot.position.y = .32 + it.lift;
      it.pivot.rotation.y = -ring.rotation.y - Math.sin(a) * .38 + (isH ? Math.sin(t * 1.6) * .05 : 0);
    });
    // iris
    const openT = (stopIdx === 2 || prog > 1.5 && prog < 2.6) ? 1 : 0;
    const ia = clamp(1 - Math.abs(prog - 2) * 1.1, 0, 1), pulse = reduce ? 0 : (Math.sin(t * .8) * .5 + .5);
    const delta = .18 + (1 - smooth(ia)) * .95 + pulse * .1 * ia;
    blades.forEach((o) => { o.b.rotation.z = o.ph + Math.PI / 2 + delta; });
    iris.rotation.z = t * .04 * m + ptr.sx * .2; iris.rotation.y = ptr.sx * .25; iris.rotation.x = ptr.sy * .18;
    // features
    wave.forEach((b, i) => { const h = .35 + (Math.sin(t * 2.6 + i * .8) * .5 + .5) * 1.2 * m + (m ? 0 : .6); b.scale.y = h; b.position.y = 1.0 - .5 + h / 2; });
    feat.rotation.y = -.35 + ptr.sx * .5; feat.rotation.x = ptr.sy * .12; feat.position.y = 2.2 + Math.sin(t * .7) * .08 * m;
    btn.position.y = -1.6 + Math.sin(t * 1.4) * .05 * m; cap2.position.y = .14 - (Math.sin(t * 1.4) > .85 ? .05 : 0);
    // coin
    coin.rotation.y = Math.sin(t * .6) * .9 * m + ptr.sx * 1.4; coin.rotation.x = ptr.sy * .6; coin.position.y = 2.5 + Math.sin(t * 1.2) * .12 * m; orbit.rotation.y = t * .25 * m; orbit.rotation.z = .3;
    renderer.render(scene, camera);
    if (!ready) { ready = true; root.classList.add('gl-ready'); }
  }
  tick();
  $$('.btn-p').forEach((b) => { if (coarse || reduce) return; b.addEventListener('pointermove', (e) => { const r = b.getBoundingClientRect(); b.style.transform = `translate(${((e.clientX - r.left) / r.width - .5) * 10}px,${((e.clientY - r.top) / r.height - .5) * 8 - 2}px)`; }); b.addEventListener('pointerleave', () => { b.style.transform = ''; }); });
}
try { boot(); } catch (e) { console.error(e); root.classList.add('nogl'); }
