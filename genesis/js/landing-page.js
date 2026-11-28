/* Landing page wiring: header, 3D hero, room try-on, closing coin. */
const $ = (id) => document.getElementById(id);
const ROOMS = [
  { id: 'podcast', name: 'Podcast', hue: '#ff8a3d' },
  { id: 'talkshow', name: 'Talk show', hue: '#ff5fa2' },
  { id: 'tech', name: 'Tech desk', hue: '#8a4dff' },
  { id: 'terrace', name: 'Terrace', hue: '#ff6a88' },
  { id: 'sports', name: 'Sports desk', hue: '#2f7bff' },
  { id: 'classroom', name: 'Classroom', hue: '#35d6a4' },
  { id: 'stage', name: 'Stage', hue: '#ffb454' },
  { id: 'library', name: 'Library', hue: '#e0954f' },
  { id: 'living', name: 'Living room', hue: '#9fc3ff' },
  { id: 'minimal', name: 'Minimal', hue: '#c9b8ff' }
];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const studio = (r) => 'studio.html?guest=1&env=scene-premium-' + r.id;
const full = (r) => 'assets/environments/scene-premium-' + r.id + '.jpg';

const top = $('top');
const onScroll = () => top.classList.toggle('s', scrollY > 40);
onScroll(); addEventListener('scroll', onScroll, { passive: true });

/* ---- hero ---- */
function webgl() { try { return !!document.createElement('canvas').getContext('webgl2'); } catch (e) { return false; } }
const heroEl = document.querySelector('.hero');
function showPick(i) {
  const r = ROOMS[i];
  $('pickName').textContent = r.name; $('pickLink').href = studio(r);
  heroEl.style.setProperty('--hue', r.hue);
}
let three = null;
if (webgl()) {
  three = import('./landing-3d.js');
  three.then((m) => m.hero({ canvas: $('hero3d'), rooms: ROOMS, onPick: showPick })).then((api) => {
    heroEl.classList.add('live'); $('picker').hidden = false; $('hint').hidden = false;
    $('prev').onclick = () => api.next(-1); $('next').onclick = () => api.next(1);
  }).catch((e) => console.warn('3D hero unavailable', e));
}

/* ---- room try-on ---- */
const screen = $('screen'), tilt = $('tilt');
let front = $('bgA'), back = $('bgB'), token = 0;
function wear(i) {
  const r = ROOMS[i], mine = ++token;
  Array.from($('thumbs').children).forEach((b, k) => b.setAttribute('aria-pressed', String(k === i)));
  $('thirdRoom').textContent = r.name; $('tryOpen').href = studio(r);
  tilt.style.setProperty('--hue', r.hue);
  const im = new Image();
  im.onload = () => {
    if (mine !== token) return;
    back.src = im.src; back.classList.add('on'); front.classList.remove('on');
    [front, back] = [back, front];
  };
  im.src = full(r);
}
ROOMS.forEach((r, i) => {
  const b = document.createElement('button');
  b.type = 'button'; b.setAttribute('aria-pressed', 'false'); b.style.setProperty('--hue', r.hue);
  b.innerHTML = '<img src="assets/landing/room-' + r.id + '.webp" alt="" width="640" height="360" loading="lazy"><span>' + r.name + '</span>';
  b.onclick = () => wear(i);
  $('thumbs').appendChild(b);
});
front.src = full(ROOMS[0]);
$('thumbs').firstChild.setAttribute('aria-pressed', 'true');
$('tryOpen').href = studio(ROOMS[0]);
$('nameIn').addEventListener('input', (e) => { $('thirdName').textContent = e.target.value.trim() || 'Your name'; });

/* tilt the preview toward the pointer (or finger) with the person floating above the room */
if (!reduce) {
  const move = (e) => {
    const q = tilt.getBoundingClientRect();
    const x = Math.max(-0.5, Math.min(0.5, (e.clientX - q.left) / q.width - 0.5));
    const y = Math.max(-0.5, Math.min(0.5, (e.clientY - q.top) / q.height - 0.5));
    screen.style.setProperty('--x', x.toFixed(3)); screen.style.setProperty('--y', y.toFixed(3));
  };
  const rest = () => { screen.style.setProperty('--x', 0); screen.style.setProperty('--y', 0); };
  tilt.addEventListener('pointermove', move); tilt.addEventListener('pointerdown', move);
  tilt.addEventListener('pointerleave', rest); tilt.addEventListener('pointercancel', rest);
}

/* ---- closing coin, loaded only when near ---- */
if (webgl()) {
  const cv = $('coin');
  const io = new IntersectionObserver((e) => {
    if (!e[0].isIntersecting) return;
    io.disconnect();
    (three || import('./landing-3d.js')).then((m) => m.coin(cv)).catch(() => cv.remove());
  }, { rootMargin: '300px' });
  io.observe(cv);
}
