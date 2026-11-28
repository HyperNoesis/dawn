/* Genesis landing 3D: the hero stage (person, ring light, orbiting rooms, studio mic) and the closing logo coin. */
import * as THREE from '../vendor/three/three.module.min.js';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const small = () => innerWidth <= 900;

function renderer(canvas) {
  const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  r.setPixelRatio(Math.min(devicePixelRatio, small() ? 1.5 : 1.75));
  return r;
}

/* A tiny lit "studio" turned into a reflection map, so chrome has something to reflect. */
function studioEnv(r) {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x0b0620);
  const panel = (color, power, w, h, x, y, z) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); s.add(m);
  };
  panel(0xffffff, 3.2, 8, 2, 0, 7, 3);
  panel(0x8a4dff, 2.6, 4, 9, -8, 0, 1);
  panel(0x3ee6ff, 2.2, 3, 9, 8, 1, -1);
  panel(0xff6a88, 1.8, 9, 3, 0, -7, 2);
  panel(0xffffff, 1.4, 1, 8, 4, 0, 8);
  const p = new THREE.PMREMGenerator(r), t = p.fromScene(s, 0.02).texture;
  p.dispose(); return t;
}

function loadTex(loader, url) {
  return new Promise((res, rej) => loader.load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; res(t); }, undefined, rej));
}

/* Run draw() only while the canvas is on screen and the tab is visible. */
function loopWhileVisible(canvas, draw) {
  let on = false, raf = 0, last = 0;
  const tick = (now) => { raf = 0; const dt = Math.min((now - (last || now)) / 1000, 0.05); last = now; draw(dt, now / 1000); if (on && !document.hidden) raf = requestAnimationFrame(tick); };
  const kick = () => { if (!raf && on && !document.hidden) { last = 0; raf = requestAnimationFrame(tick); } };
  new IntersectionObserver((e) => { on = e[0].isIntersecting; kick(); }).observe(canvas);
  document.addEventListener('visibilitychange', kick);
}

const NOISE_FREE_VERT = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}';

export async function hero({ canvas, rooms, onPick }) {
  const r = renderer(canvas);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 60);
  scene.environment = studioEnv(r);
  const loader = new THREE.TextureLoader();
  const [person, ...shots] = await Promise.all([loadTex(loader, 'assets/landing/person.webp'), ...rooms.map((x) => loadTex(loader, 'assets/landing/room-' + x.id + '.webp'))]);

  const world = new THREE.Group(); scene.add(world);
  const accent = new THREE.Color(rooms[0].hue), accentTo = accent.clone();

  /* ---- the person: a gently domed plane with coloured rim light and a one-time scan-in ---- */
  const PH = 7.1, PW = PH * 736 / 977;
  const pg = new THREE.PlaneGeometry(PW, PH, 48, 64);
  const pos = pg.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const u = (pos.getX(i) / PW) * 2, v = (pos.getY(i) / PH) * 2;
    pos.setZ(i, 0.55 * Math.max(0, 1 - u * u) * Math.max(0, 1 - v * v * 0.5));
  }
  const pm = new THREE.ShaderMaterial({
    transparent: true, depthWrite: true,
    uniforms: { map: { value: person }, accent: { value: accent }, reveal: { value: reduce ? 1.2 : 0 } },
    vertexShader: NOISE_FREE_VERT,
    fragmentShader: `uniform sampler2D map;uniform vec3 accent;uniform float reveal;varying vec2 vUv;
      void main(){
        vec4 c=texture2D(map,vUv);
        float bottom=smoothstep(0.0,0.16,vUv.y);
        float a=c.a*bottom;
        float l=clamp(c.a-texture2D(map,vUv+vec2(-0.022,0.004)).a,0.,1.);
        float rr=clamp(c.a-texture2D(map,vUv+vec2(0.022,0.004)).a,0.,1.);
        vec3 col=c.rgb*vec3(0.97,0.95,1.04);
        col+=vec3(0.24,0.80,1.0)*l*0.6+accent*rr*0.8;
        float y=1.0-vUv.y;
        float done=smoothstep(y-0.02,y+0.02,reveal);
        float line=exp(-pow((y-reveal)*38.0,2.0))*step(reveal,1.05);
        col=mix(col,vec3(0.45,0.92,1.0),line);
        a*=max(done,line);
        if(a<0.02)discard;
        gl_FragColor=vec4(col,a);
        #include <colorspace_fragment>
      }`
  });
  const figure = new THREE.Mesh(pg, pm); world.add(figure);

  /* ---- ring light behind the head ---- */
  const ring = new THREE.Group();
  const chrome = new THREE.MeshStandardMaterial({ color: 0xe9e4ff, metalness: 1, roughness: 0.12, envMapIntensity: 1.25 });
  const outer = new THREE.Mesh(new THREE.TorusGeometry(2.75, 0.17, 32, 180), chrome);
  const tubeMat = new THREE.MeshBasicMaterial({ color: accent });
  const tube = new THREE.Mesh(new THREE.TorusGeometry(2.44, 0.045, 12, 180), tubeMat);
  const thin = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.018, 8, 200), chrome);
  const haloMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { accent: { value: accent } }, vertexShader: NOISE_FREE_VERT,
    fragmentShader: 'uniform vec3 accent;varying vec2 vUv;void main(){float d=length(vUv-0.5)*2.0;float g=exp(-pow((d-0.61)*7.0,2.0))*0.55+exp(-d*d*3.0)*0.28;gl_FragColor=vec4(accent,g*(1.0-smoothstep(0.85,1.0,d)));}'
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), haloMat); halo.position.z = -0.2;
  ring.add(halo, outer, tube, thin); world.add(ring);

  /* ---- studio microphone, chrome ---- */
  const mic = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a1c55, metalness: 0.95, roughness: 0.28 });
  mic.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.62, 12, 40), chrome));
  for (let i = -3; i <= 3; i++) { const b = new THREE.Mesh(new THREE.TorusGeometry(0.368, 0.016, 8, 48), dark); b.rotation.x = Math.PI / 2; b.position.y = i * 0.095; mic.add(b); }
  const yoke = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.045, 12, 64, Math.PI), chrome); yoke.rotation.z = Math.PI; yoke.position.y = -0.12; mic.add(yoke);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.62, 24), dark); stem.position.y = -0.94; mic.add(stem);
  world.add(mic);

  /* ---- room screens orbiting her ---- */
  const CW = 1.9, CH = CW * 9 / 16;
  const cardMat = (tex) => new THREE.ShaderMaterial({
    transparent: true,
    uniforms: { map: { value: tex }, glow: { value: 0 }, dim: { value: 1 }, edge: { value: new THREE.Color() } },
    side: THREE.DoubleSide, vertexShader: NOISE_FREE_VERT,
    fragmentShader: `uniform sampler2D map;uniform float glow;uniform float dim;uniform vec3 edge;varying vec2 vUv;
      void main(){
        vec2 uv=vUv;if(!gl_FrontFacing)uv.x=1.0-uv.x;
        vec2 p=(vUv-0.5)*vec2(1.7778,1.0);vec2 q=abs(p)-vec2(0.8889,0.5)+0.09;
        float d=length(max(q,0.0))+min(max(q.x,q.y),0.0)-0.09;
        float a=1.0-smoothstep(-0.006,0.004,d);
        if(a<0.02)discard;
        vec3 c=texture2D(map,uv).rgb*dim;
        float b=smoothstep(-0.034,-0.012,d);
        c=mix(c,mix(vec3(0.55,0.5,0.85),edge*1.5,glow),b*(0.55+0.45*glow));
        gl_FragColor=vec4(c,a);
        #include <colorspace_fragment>
      }`
  });
  const cards = rooms.map((room, i) => {
    const g = new THREE.PlaneGeometry(CW, CH, 24, 1), p = g.attributes.position;
    for (let k = 0; k < p.count; k++) { const x = p.getX(k); p.setZ(k, -x * x * 0.11); }
    const m = new THREE.Mesh(g, cardMat(shots[i])); m.material.uniforms.edge.value.set(room.hue); m.userData.i = i; world.add(m); return m;
  });

  /* ---- drifting light dust ---- */
  const N = small() ? 220 : 480, dp = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { dp[i * 3] = (Math.random() - 0.5) * 18; dp[i * 3 + 1] = (Math.random() - 0.5) * 11; dp[i * 3 + 2] = (Math.random() - 0.5) * 10 - 1; }
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  const dot = document.createElement('canvas'); dot.width = dot.height = 32;
  const cx = dot.getContext('2d'), gr = cx.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, '#fff'); gr.addColorStop(1, 'rgba(255,255,255,0)'); cx.fillStyle = gr; cx.fillRect(0, 0, 32, 32);
  const dust = new THREE.Points(dg, new THREE.PointsMaterial({ map: new THREE.CanvasTexture(dot), size: 0.07, color: 0xbfaeff, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(dust);

  /* ---- layout ---- */
  let R = 3.9, depth = 2.5, orbitY = -1.9, baseS = 1;
  function layout() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    r.setSize(w, h, false); cam.aspect = w / h;
    cam.position.set(0, 0, 13); cam.updateProjectionMatrix();
    const vh = 2 * 13 * Math.tan(THREE.MathUtils.degToRad(17.5)), vw = vh * cam.aspect;
    if (!small()) {
      baseS = Math.min(1.08, vw / 12.5);
      world.position.set(vw * 0.19, (-vh / 2) + PH * baseS / 2 - 0.2, 0);
      R = Math.min(3.55, vw * 0.27 / baseS); depth = 2.0; orbitY = -1.55;
    } else {
      baseS = Math.min(1, vw / 5.2);
      world.position.set(0.1, (-vh / 2) + PH * baseS / 2 + 0.15, 0);
      R = 2.6; depth = 2.0; orbitY = -1.7;
    }
    world.scale.setScalar(baseS);
    ring.position.set(0.15, 0.75, -1.7);
    mic.position.set(small() ? -2.0 : Math.min(3.35, (vw * 0.31 - 0.75) / baseS), small() ? 1.9 : 1.15, 0.6); mic.scale.setScalar(small() ? 0.72 : 1);
  }
  layout(); addEventListener('resize', () => { layout(); place(); r.render(scene, cam); });

  /* ---- interaction ---- */
  const step = Math.PI * 2 / rooms.length;
  let spin = 0, target = 0, active = 0, drag = null, idle = 0;
  const ptr = { x: 0, y: 0 }, eased = { x: 0, y: 0 };
  function setActive(i, tell) { active = i; accentTo.set(rooms[i].hue); if (tell) onPick(i); }
  function select(i) {
    let t = -i * step; t += Math.round((target - t) / (Math.PI * 2)) * Math.PI * 2;
    target = t; idle = -4; setActive(i, true);
    if (reduce) { spin = target; accent.copy(accentTo); frame(0, 2); }
  }
  const nearest = () => ((Math.round(-target / step) % rooms.length) + rooms.length) % rooms.length;
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, from: target, moved: 0 }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x; drag.moved = Math.max(drag.moved, Math.abs(dx), Math.abs(e.clientY - drag.y));
    target = drag.from + dx / canvas.clientWidth * (small() ? 3.6 : 4.5); idle = -4;
    const n = nearest(); if (n !== active) setActive(n, true);
    if (reduce) { spin = target; accent.copy(accentTo); frame(0, 2); }
  });
  const ray = new THREE.Raycaster();
  canvas.addEventListener('pointerup', (e) => {
    if (!drag) return;
    if (drag.moved < 8) {
      const b = canvas.getBoundingClientRect();
      ray.setFromCamera({ x: (e.clientX - b.left) / b.width * 2 - 1, y: -(e.clientY - b.top) / b.height * 2 + 1 }, cam);
      const hit = ray.intersectObjects(cards)[0]; if (hit) select(hit.object.userData.i);
    } else select(nearest());
    drag = null;
  });
  canvas.addEventListener('pointercancel', () => { if (drag) { drag = null; select(nearest()); } });
  addEventListener('pointermove', (e) => { ptr.x = e.clientX / innerWidth - 0.5; ptr.y = e.clientY / innerHeight - 0.5; }, { passive: true });

  function place() {
    cards.forEach((m, i) => {
      const a = spin + i * step, s = Math.sin(a), c = Math.cos(a), front = (c + 1) / 2, on = i === active ? 1 : 0;
      m.position.set(s * R, orbitY + (1 - front) * 1.9, c * depth);
      m.rotation.y = s * 0.55;
      const u = m.material.uniforms;
      u.glow.value += (on - u.glow.value) * (reduce ? 1 : 0.12);
      u.dim.value = 0.34 + 0.7 * Math.pow(front, 1.6) + 0.1 * u.glow.value;
      m.scale.setScalar(0.74 + 0.26 * front + 0.1 * u.glow.value);
    });
  }
  function frame(dt, t) {
    if (!reduce) {
      pm.uniforms.reveal.value = Math.min(1.2, pm.uniforms.reveal.value + dt * 0.75);
      idle += dt;
      /* slow tour of the rooms while nobody is touching it */
      if (!drag && idle > 3.4) { idle = 0; const n = (active + 1) % rooms.length; target -= step; setActive(n, true); }
      spin += (target - spin) * Math.min(1, dt * 5);
      accent.lerp(accentTo, Math.min(1, dt * 3));
    }
    eased.x += (ptr.x - eased.x) * 0.05; eased.y += (ptr.y - eased.y) * 0.05;
    const sway = reduce ? 0 : Math.sin(t * 0.45) * 0.045;
    const scroll = Math.min(1, scrollY / (canvas.clientHeight || 1));
    figure.rotation.y = eased.x * 0.32 + sway; figure.rotation.x = eased.y * 0.08;
    cam.position.x = eased.x * 1.1; cam.position.y = -eased.y * 0.6 + scroll * 1.2; cam.lookAt(0, scroll * 0.4, 0);
    tubeMat.color.copy(accent);
    ring.rotation.y = eased.x * 0.7 + sway * 2; ring.rotation.x = -eased.y * 0.35 + scroll * 0.9;
    thin.rotation.x = Math.sin(t * 0.5) * 0.35; thin.rotation.y = Math.cos(t * 0.37) * 0.4;
    mic.rotation.set(0.12 + Math.sin(t * 0.8) * 0.08, t * 0.35, -0.38);
    mic.position.y = (small() ? 1.9 : 1.15) + Math.sin(t * 1.1) * 0.14;
    dust.rotation.y = t * 0.02 + eased.x * 0.15; dust.position.y = scroll * 2;
    place(); r.render(scene, cam);
  }
  onPick(0);
  if (reduce) { frame(0, 2); } else loopWhileVisible(canvas, frame);
  return { select, next: (d) => select((active + d + rooms.length) % rooms.length) };
}

export async function coin(canvas) {
  const r = renderer(canvas), scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
  cam.position.z = 9; scene.environment = studioEnv(r);
  const tex = await loadTex(new THREE.TextureLoader(), 'assets/genesis-logo-atelier.png');
  const chrome = new THREE.MeshStandardMaterial({ color: 0xe9e4ff, metalness: 1, roughness: 0.12 });
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 0.34, 120), new THREE.MeshStandardMaterial({ color: 0x1a0f3d, metalness: 0.9, roughness: 0.2 }));
  body.rotation.x = Math.PI / 2; g.add(body, new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.17, 28, 160), chrome));
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  [1, -1].forEach((s) => { const f = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 2.24), mat); f.position.z = 0.18 * s; if (s < 0) f.rotation.y = Math.PI; g.add(f); });
  const orbit = new THREE.Mesh(new THREE.TorusGeometry(2.75, 0.025, 8, 200), chrome);
  scene.add(g, orbit);
  const size = () => { const w = canvas.clientWidth, h = canvas.clientHeight; if (!w) return; r.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); r.render(scene, cam); };
  let a = 0, v = 0, drag = null;
  canvas.addEventListener('pointerdown', (e) => { drag = e.clientX; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => { if (drag === null) return; const d = (e.clientX - drag) * 0.012; drag = e.clientX; a += d; v = d * 30; if (reduce) frame(0, 0); });
  const up = () => { drag = null; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  function frame(dt, t) {
    /* after a spin it keeps going, then settles face-on and sways, so the mark stays readable */
    if (drag === null) {
      a += v * dt; v *= Math.exp(-dt * 1.6);
      if (Math.abs(v) < 1.5) { const rest = Math.round(a / (Math.PI * 2)) * Math.PI * 2 + Math.sin(t * 0.7) * 0.5; a += (rest - a) * Math.min(1, dt * 2); }
    }
    g.rotation.y = a; g.position.y = Math.sin(t * 1.2) * 0.08;
    orbit.rotation.set(1.25 + Math.sin(t * 0.6) * 0.15, Math.sin(t * 0.4) * 0.35, 0);
    r.render(scene, cam);
  }
  size(); addEventListener('resize', size);
  if (reduce) { a = 0.35; frame(0, 0); } else loopWhileVisible(canvas, frame);
}
