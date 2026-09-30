'use strict';

/* Card Snap — capture front, back and corner photos of trading cards.
 * Everything runs on-device; photos never leave the phone unless you share them. */

const CARD_ASPECT = 63 / 88;          // standard Pokémon card, width / height
const JPEG_Q = 0.92;
const CORNERS = ['tl', 'tr', 'bl', 'br'];
const CORNER_NAMES = { tl: 'Top left', tr: 'Top right', bl: 'Bottom left', br: 'Bottom right' };

const $ = (id) => document.getElementById(id);
const els = {
  screens: document.querySelectorAll('.screen'),
  cardName: $('cardName'), optBack: $('optBack'), optCloseups: $('optCloseups'), optAuto: $('optAuto'),
  startBtn: $('startBtn'), sessionWrap: $('sessionWrap'), sessionList: $('sessionList'), zipAllBtn: $('zipAllBtn'),
  installHint: $('installHint'),
  stage: $('stage'), video: $('video'), guide: $('guide'), stepLabel: $('stepLabel'), stepHelp: $('stepHelp'),
  autoRing: $('autoRing'), flash: $('flash'), shutter: $('shutter'), camCancel: $('camCancel'),
  torchBtn: $('torchBtn'), nativeInput: $('nativeInput'), zoomRow: $('zoomRow'), zoom: $('zoom'), camError: $('camError'),
  reviewTitle: $('reviewTitle'), reviewGrid: $('reviewGrid'), reviewBack: $('reviewBack'),
  shareBtn: $('shareBtn'), zipBtn: $('zipBtn'), nextBtn: $('nextBtn'),
};

const state = {
  stream: null, track: null, torchOn: false,
  steps: [], stepIdx: 0, retakeOnly: false,
  card: null,           // card currently being shot
  session: [],          // finished cards
  auto: { timer: null, prev: null, still: 0, sawMotion: false, armedAt: 0 },
};

/* ---------------- screens ---------------- */

function show(id) {
  els.screens.forEach((s) => s.classList.toggle('active', s.id === id));
  window.scrollTo(0, 0);
}

/* ---------------- workflow ---------------- */

function buildSteps() {
  const steps = [{ id: 'front', kind: 'card', label: 'FRONT', help: 'Line the card up inside the frame' }];
  if (els.optBack.checked) steps.push({ id: 'back', kind: 'card', label: 'BACK', help: 'Flip the card over — same spot' });
  if (els.optCloseups.checked) {
    for (const c of CORNERS) {
      steps.push({ id: 'cu-' + c, kind: 'corner', corner: c, label: 'CLOSE-UP · ' + CORNER_NAMES[c].toUpperCase(),
        help: 'Front side. Move in close so the ' + CORNER_NAMES[c].toLowerCase() + ' corner fills the bracket' });
    }
  }
  return steps;
}

function newCard() {
  const counter = (Number(safeGet('cs-counter')) || 0) + 1;
  safeSet('cs-counter', String(counter));
  const name = els.cardName.value.trim() || 'Card ' + counter;
  return { name, slug: slugify(name) || 'card-' + counter, shots: {}, files: [] };
}

async function startShoot() {
  state.card = newCard();
  state.steps = buildSteps();
  state.stepIdx = 0;
  state.retakeOnly = false;
  await openCamera();
}

async function retake(stepId) {
  const all = buildStepsFor(state.card);
  state.steps = all.filter((s) => s.id === stepId);
  state.stepIdx = 0;
  state.retakeOnly = true;
  await openCamera();
}

// Steps matching what a card already has (used for retakes after options changed).
function buildStepsFor(card) {
  const ids = Object.keys(card.shots);
  const base = buildSteps();
  for (const id of ids) if (!base.find((s) => s.id === id)) {
    if (id === 'back') base.push({ id: 'back', kind: 'card', label: 'BACK', help: 'Flip the card over — same spot' });
    if (id.startsWith('cu-')) {
      const c = id.slice(3);
      base.push({ id, kind: 'corner', corner: c, label: 'CLOSE-UP · ' + CORNER_NAMES[c].toUpperCase(), help: '' });
    }
  }
  return base;
}

async function openCamera() {
  show('camera');
  els.camError.classList.add('hidden');
  if (!state.stream) {
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
      });
    } catch (err) {
      els.camError.textContent = 'Live camera unavailable (' + (err.name || err.message) +
        '). Tap "Phone cam" to use your normal camera app instead.';
      els.camError.classList.remove('hidden');
    }
    if (state.stream) {
      els.video.srcObject = state.stream;
      state.track = state.stream.getVideoTracks()[0];
      await els.video.play().catch(() => {});
      await waitForVideo();
      setupTrackFeatures();
    }
  }
  enterStep();
}

function waitForVideo() {
  return new Promise((res) => {
    if (els.video.videoWidth) return res();
    els.video.addEventListener('loadedmetadata', () => res(), { once: true });
    setTimeout(res, 3000);
  });
}

function setupTrackFeatures() {
  const t = state.track;
  if (!t || !t.getCapabilities) return;
  const caps = t.getCapabilities();
  const adv = {};
  if (caps.focusMode && caps.focusMode.includes('continuous')) adv.focusMode = 'continuous';
  if (Object.keys(adv).length) t.applyConstraints({ advanced: [adv] }).catch(() => {});
  els.torchBtn.classList.toggle('hidden', !caps.torch);
  if (caps.zoom) {
    els.zoom.min = caps.zoom.min; els.zoom.max = caps.zoom.max; els.zoom.step = caps.zoom.step || 0.1;
    els.zoom.value = t.getSettings().zoom || caps.zoom.min;
    els.zoomRow.classList.remove('hidden');
  }
}

function stopCamera() {
  stopAuto();
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  state.stream = null; state.track = null; state.torchOn = false;
  els.zoomRow.classList.add('hidden');
}

function currentStep() { return state.steps[state.stepIdx]; }

function enterStep() {
  const step = currentStep();
  els.stepLabel.textContent = step.label + (state.steps.length > 1 ? `  ${state.stepIdx + 1}/${state.steps.length}` : '');
  els.stepHelp.textContent = step.help;
  layoutGuide();
  startAuto();
}

function layoutGuide() {
  const step = currentStep();
  if (!step) return;
  const W = els.stage.clientWidth, H = els.stage.clientHeight;
  let w, h;
  if (step.kind === 'card') {
    h = Math.min(H * 0.8, (W * 0.86) / CARD_ASPECT);
    w = h * CARD_ASPECT;
  } else {
    w = h = Math.min(W, H) * 0.7;
  }
  Object.assign(els.guide.style, { width: w + 'px', height: h + 'px', left: (W - w) / 2 + 'px', top: (H - h) / 2 + 'px' });
  els.guide.classList.toggle('square', step.kind === 'corner');
  els.guide.classList.remove('steady');
  if (step.kind === 'corner') {
    els.guide.dataset.only = step.corner;
    els.guide.querySelectorAll('.c').forEach((c) => c.classList.toggle('on', c.classList.contains(step.corner)));
  } else {
    delete els.guide.dataset.only;
    els.guide.querySelectorAll('.c').forEach((c) => c.classList.remove('on'));
  }
}

async function capture() {
  if (!state.stream || !els.video.videoWidth) { els.nativeInput.click(); return; }
  stopAuto();
  flash();
  const frame = grabFrame();
  const region = guideToSource(frame);
  await handleImage(frame, region);
}

async function handleImage(source, region) {
  const step = currentStep();
  let shot;
  if (step.kind === 'card') {
    const card = extractCard(source, region);
    shot = {
      canvas: card.canvas,
      corners: cornerCollage(card.canvas, card.inset, step.id === 'front' ? 'FRONT' : 'BACK'),
      blur: blurScore(card.canvas),
      detected: card.detected,
    };
  } else {
    const c = region ? cropCanvas(source, region) : source;
    shot = { canvas: limitSize(c, 2400), blur: blurScore(c) };
  }
  state.card.shots[step.id] = shot;

  state.stepIdx++;
  if (state.stepIdx < state.steps.length) enterStep();
  else finishShoot();
}

function finishShoot() {
  stopCamera();
  state.card.thumb = null;
  buildFiles(state.card).then(renderSession);
  renderReview();
  show('review');
}

/* ---------------- image processing ---------------- */

function grabFrame() {
  const v = els.video;
  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext('2d').drawImage(v, 0, 0);
  return c;
}

// Map the on-screen guide box to pixel coordinates in the captured frame
// (the video is displayed with object-fit: cover, so it's scaled + cropped).
function guideToSource(frame) {
  const vr = els.video.getBoundingClientRect();
  const gr = els.guide.getBoundingClientRect();
  const scale = Math.max(vr.width / frame.width, vr.height / frame.height);
  const offX = (vr.width - frame.width * scale) / 2;
  const offY = (vr.height - frame.height * scale) / 2;
  return {
    x: (gr.left - vr.left - offX) / scale,
    y: (gr.top - vr.top - offY) / scale,
    w: gr.width / scale,
    h: gr.height / scale,
  };
}

function clampRect(r, W, H) {
  const x = Math.max(0, Math.round(r.x)), y = Math.max(0, Math.round(r.y));
  return { x, y, w: Math.min(W - x, Math.round(r.w)), h: Math.min(H - y, Math.round(r.h)) };
}

function grow(r, f) {
  const dx = r.w * f, dy = r.h * f;
  return { x: r.x - dx, y: r.y - dy, w: r.w + 2 * dx, h: r.h + 2 * dy };
}

function cropCanvas(src, r) {
  const rr = clampRect(r, src.width, src.height);
  const c = document.createElement('canvas');
  c.width = rr.w; c.height = rr.h;
  c.getContext('2d').drawImage(src, rr.x, rr.y, rr.w, rr.h, 0, 0, rr.w, rr.h);
  return c;
}

function limitSize(c, maxEdge) {
  const s = Math.min(1, maxEdge / Math.max(c.width, c.height));
  if (s === 1) return c;
  const o = document.createElement('canvas');
  o.width = Math.round(c.width * s); o.height = Math.round(c.height * s);
  const g = o.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(c, 0, 0, o.width, o.height);
  return o;
}

/* Find the card inside a photo, assuming a fairly plain background.
 * Returns a rect in `src` pixel coords, or null if nothing card-like was found. */
function detectCard(src) {
  const SW = 320;
  const s = SW / src.width;
  const w = SW, h = Math.max(1, Math.round(src.height * s));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;

  // background = average colour of a thin border ring
  let br = 0, bg = 0, bb = 0, n = 0;
  const ring = 3;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x >= ring && x < w - ring && y >= ring && y < h - ring) continue;
    const i = (y * w + x) * 4; br += d[i]; bg += d[i + 1]; bb += d[i + 2]; n++;
  }
  br /= n; bg /= n; bb /= n;

  // For each row, find the left-most and right-most runs of "not background" pixels.
  // The card's border makes these line up row after row, whatever the artwork looks like.
  const fg = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const j = i * 4;
    fg[i] = Math.abs(d[j] - br) + Math.abs(d[j + 1] - bg) + Math.abs(d[j + 2] - bb) > 60 ? 1 : 0;
  }
  const RUN = 3;
  const left = new Int32Array(h).fill(-1), right = new Int32Array(h).fill(-1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0, k = 0; x < w; x++) { k = fg[row + x] ? k + 1 : 0; if (k === RUN) { left[y] = x - RUN + 1; break; } }
    for (let x = w - 1, k = 0; x >= 0; x--) { k = fg[row + x] ? k + 1 : 0; if (k === RUN) { right[y] = x + RUN - 1; break; } }
  }
  const isCardRow = (y) => left[y] >= 0 && right[y] - left[y] > w * 0.35;

  // longest run of card rows, tolerating small gaps
  const GAP = Math.round(h * 0.04);
  let best = [0, -1], start = -1, lastOn = -1;
  for (let y = 0; y <= h; y++) {
    const on = y < h && isCardRow(y);
    if (on) { if (start < 0) start = y; lastOn = y; }
    else if (start >= 0 && (y === h || y - lastOn > GAP)) {
      if (lastOn - start > best[1] - best[0]) best = [start, lastOn];
      start = -1;
    }
  }
  const [y0, y1] = best;
  if (y1 - y0 < h * 0.35) return null;
  const ls = [], rs = [];
  for (let y = y0; y <= y1; y++) if (isCardRow(y)) { ls.push(left[y]); rs.push(right[y]); }
  const median = (a) => a.sort((m, n) => m - n)[a.length >> 1];
  const x0 = median(ls), x1 = median(rs);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const aspect = bw / bh;
  if (Math.abs(aspect - CARD_ASPECT) > 0.12 && Math.abs(1 / aspect - CARD_ASPECT) > 0.12) return null;
  return { x: x0 / s, y: y0 / s, w: bw / s, h: bh / s };
}

// Crop the card out of the frame. Tries to snap to the real card edges, falls back to the guide box.
// `inset` is how far the card edge sits from the crop edge (px), used for the corner crops.
function extractCard(src, guide) {
  const MARGIN = 0.035;
  let search = guide ? cropCanvas(src, grow(guide, 0.08)) : src;
  const found = detectCard(search);
  let cardRect;
  let detected = !!found;
  if (found) cardRect = found;
  else if (guide) {
    const g = grow(guide, 0.08);
    cardRect = { x: guide.x - Math.max(0, g.x), y: guide.y - Math.max(0, g.y), w: guide.w, h: guide.h };
  } else cardRect = { x: 0, y: 0, w: search.width, h: search.height };

  const out = cropCanvas(search, grow(cardRect, MARGIN));
  const inset = Math.min(cardRect.w * MARGIN, cardRect.x, cardRect.y);
  return { canvas: limitSize(out, 3000), inset: inset * Math.min(1, 3000 / Math.max(out.width, out.height)), detected };
}

// 2x2 grid of the four corners, enlarged — the "corner check" photo buyers want.
function cornerCollage(card, inset, title) {
  const side = Math.round(Math.min(card.width, card.height) * 0.2 + inset);
  const TILE = 800, GAP = 16, HEAD = 70;
  const out = document.createElement('canvas');
  out.width = TILE * 2 + GAP * 3;
  out.height = TILE * 2 + GAP * 3 + HEAD;
  const g = out.getContext('2d');
  g.fillStyle = '#111'; g.fillRect(0, 0, out.width, out.height);
  g.imageSmoothingQuality = 'high';
  g.fillStyle = '#fff';
  g.font = '600 40px -apple-system, Segoe UI, Roboto, sans-serif';
  g.textBaseline = 'middle';
  g.fillText(title + ' — CORNERS', GAP + 4, GAP + HEAD / 2);
  const pos = {
    tl: [0, 0], tr: [card.width - side, 0], bl: [0, card.height - side], br: [card.width - side, card.height - side],
  };
  CORNERS.forEach((k, i) => {
    const [sx, sy] = pos[k];
    const dx = GAP + (i % 2) * (TILE + GAP), dy = HEAD + GAP + Math.floor(i / 2) * (TILE + GAP);
    g.drawImage(card, sx, sy, side, side, dx, dy, TILE, TILE);
    g.font = '600 28px -apple-system, Segoe UI, Roboto, sans-serif';
    const label = CORNER_NAMES[k];
    const tw = g.measureText(label).width;
    g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(dx + 12, dy + TILE - 56, tw + 24, 44);
    g.fillStyle = '#fff'; g.fillText(label, dx + 24, dy + TILE - 34);
  });
  return out;
}

// Variance of the Laplacian — higher = sharper. Measured on a normalised size so thresholds are stable.
function blurScore(src) {
  const w = 480, h = Math.round((src.height / src.width) * w);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const l = gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w] - 4 * gray[i];
    sum += l; sum2 += l * l; n++;
  }
  const mean = sum / n;
  return sum2 / n - mean * mean;
}
const BLURRY = 40;

/* ---------------- auto-capture: fire when the phone has moved, then held still ---------------- */

function startAuto() {
  stopAuto();
  if (!els.optAuto.checked || !state.stream) return;
  const a = state.auto;
  a.prev = null; a.still = 0; a.sawMotion = false; a.armedAt = performance.now() + 1200;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 48;
  const g = c.getContext('2d', { willReadFrequently: true });
  const NEED = 7; // ~1s of stillness at 150ms ticks
  els.autoRing.classList.remove('hidden');
  const circle = els.autoRing.querySelector('circle');
  a.timer = setInterval(() => {
    if (!els.video.videoWidth) return;
    g.drawImage(els.video, 0, 0, 64, 48);
    const d = g.getImageData(0, 0, 64, 48).data;
    const cur = new Uint8Array(64 * 48);
    for (let i = 0; i < cur.length; i++) cur[i] = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3;
    if (a.prev) {
      let diff = 0;
      for (let i = 0; i < cur.length; i++) diff += Math.abs(cur[i] - a.prev[i]);
      diff /= cur.length;
      if (diff > 6) { a.sawMotion = true; a.still = 0; }
      else if (diff < 2.5 && a.sawMotion && performance.now() > a.armedAt) a.still++;
      else a.still = Math.max(0, a.still - 1);
    }
    a.prev = cur;
    const p = Math.min(1, a.still / NEED);
    circle.style.strokeDashoffset = String(100.5 * (1 - p));
    els.guide.classList.toggle('steady', p > 0.5);
    els.autoRing.querySelector('span').textContent = a.sawMotion ? 'Hold still' : 'Position the card';
    if (a.still >= NEED) capture();
  }, 150);
}

function stopAuto() {
  clearInterval(state.auto.timer);
  state.auto.timer = null;
  els.autoRing.classList.add('hidden');
  els.guide.classList.remove('steady');
}

function flash() {
  els.flash.classList.add('on');
  requestAnimationFrame(() => requestAnimationFrame(() => els.flash.classList.remove('on')));
  if (navigator.vibrate) navigator.vibrate(30);
}

/* ---------------- output files ---------------- */

function toBlob(canvas) {
  return new Promise((res) => canvas.toBlob(res, 'image/jpeg', JPEG_Q));
}

async function buildFiles(card) {
  const list = [];
  const s = card.shots;
  if (s.front) list.push(['front', s.front.canvas]);
  if (s.back) list.push(['back', s.back.canvas]);
  if (s.front) list.push(['front-corners', s.front.corners]);
  if (s.back) list.push(['back-corners', s.back.corners]);
  for (const c of CORNERS) if (s['cu-' + c]) list.push(['closeup-' + c, s['cu-' + c].canvas]);
  card.filesReady = Promise.all(list.map(async ([label, canvas], i) => {
    const blob = await toBlob(canvas);
    const name = `${card.slug}_${String(i + 1).padStart(2, '0')}_${label}.jpg`;
    return new File([blob], name, { type: 'image/jpeg' });
  })).then((files) => { card.files = files; return files; });
  return card.filesReady;
}

async function shareFiles(files, title) {
  if (navigator.canShare && navigator.canShare({ files })) {
    try { await navigator.share({ files, title }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  // Fallback: download each file
  for (const f of files) {
    downloadBlob(f, f.name);
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function downloadZip(cards, zipName) {
  if (typeof JSZip === 'undefined') { alert('Zip library not loaded — check your connection, or use Save / Share.'); return; }
  const zip = new JSZip();
  for (const card of cards) {
    const files = await card.filesReady;
    const folder = cards.length > 1 ? zip.folder(card.slug) : zip;
    files.forEach((f) => folder.file(f.name, f));
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, zipName);
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

/* ---------------- review ---------------- */

function renderReview() {
  const card = state.card;
  els.reviewTitle.textContent = card.name;
  els.reviewGrid.innerHTML = '';
  const add = (canvas, caption, stepId, opts = {}) => {
    const div = document.createElement('div');
    div.className = 'shot' + (opts.wide ? ' wide' : '');
    const img = new Image();
    img.src = canvas.toDataURL('image/jpeg', 0.8);
    div.appendChild(img);
    const cap = document.createElement('div');
    cap.className = 'cap';
    const left = document.createElement('span');
    left.textContent = caption;
    if (opts.warn) {
      const w = document.createElement('div');
      w.className = 'warn'; w.textContent = opts.warn;
      left.appendChild(w);
    }
    cap.appendChild(left);
    if (stepId) {
      const b = document.createElement('button');
      b.className = 'btn small'; b.textContent = 'Retake';
      b.onclick = () => retake(stepId);
      cap.appendChild(b);
    }
    div.appendChild(cap);
    els.reviewGrid.appendChild(div);
  };
  const s = card.shots;
  const warnFor = (shot) => {
    const w = [];
    if (shot.blur < BLURRY) w.push('Might be blurry');
    if (shot.detected === false) w.push('Edges not found — check the crop');
    return w.join(' · ');
  };
  if (s.front) add(s.front.canvas, 'Front', 'front', { warn: warnFor(s.front) });
  if (s.back) add(s.back.canvas, 'Back', 'back', { warn: warnFor(s.back) });
  if (s.front) add(s.front.corners, 'Front corners', null, { wide: true });
  if (s.back) add(s.back.corners, 'Back corners', null, { wide: true });
  for (const c of CORNERS) {
    const shot = s['cu-' + c];
    if (shot) add(shot.canvas, 'Close-up: ' + CORNER_NAMES[c], 'cu-' + c, { warn: shot.blur < BLURRY ? 'Might be blurry' : '' });
  }
}

function saveCardToSession() {
  const card = state.card;
  if (!card || state.session.includes(card)) return;
  state.session.push(card);
  renderSession();
}

function renderSession() {
  els.sessionWrap.classList.toggle('hidden', state.session.length === 0);
  els.sessionList.innerHTML = '';
  for (const card of [...state.session].reverse()) {
    const li = document.createElement('li');
    const img = new Image();
    img.src = card.thumb || (card.thumb = limitSize(card.shots.front.canvas, 200).toDataURL('image/jpeg', 0.7));
    const meta = document.createElement('div');
    meta.className = 'meta';
    const b = document.createElement('b'); b.textContent = card.name;
    const sm = document.createElement('small'); sm.textContent = (card.files.length || '…') + ' photos';
    meta.append(b, sm);
    const btn = document.createElement('button');
    btn.className = 'btn small'; btn.textContent = 'Save';
    btn.onclick = async () => shareFiles(await card.filesReady, card.name);
    li.append(img, meta, btn);
    els.sessionList.appendChild(li);
  }
}

/* ---------------- native camera fallback ---------------- */

async function handleNativeFile(file) {
  if (!file) return;
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  let src;
  if (bmp) {
    src = document.createElement('canvas');
    src.width = bmp.width; src.height = bmp.height;
    src.getContext('2d').drawImage(bmp, 0, 0);
  } else {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
    src = document.createElement('canvas');
    src.width = img.naturalWidth; src.height = img.naturalHeight;
    src.getContext('2d').drawImage(img, 0, 0);
  }
  stopAuto();
  await handleImage(src, null);
}

/* ---------------- utils ---------------- */

function slugify(s) {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}
function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

/* ---------------- wire up ---------------- */

els.startBtn.onclick = startShoot;
els.shutter.onclick = capture;
els.camCancel.onclick = () => {
  stopCamera();
  if (state.retakeOnly) { renderReview(); show('review'); } else show('home');
};
els.nativeInput.onchange = (e) => { handleNativeFile(e.target.files[0]); e.target.value = ''; };
els.torchBtn.onclick = () => {
  state.torchOn = !state.torchOn;
  state.track && state.track.applyConstraints({ advanced: [{ torch: state.torchOn }] }).catch(() => {});
};
els.zoom.oninput = () => state.track && state.track.applyConstraints({ advanced: [{ zoom: Number(els.zoom.value) }] }).catch(() => {});

els.reviewBack.onclick = () => { saveCardToSession(); show('home'); };
els.shareBtn.onclick = async () => { saveCardToSession(); shareFiles(await state.card.filesReady, state.card.name); };
els.zipBtn.onclick = () => { saveCardToSession(); downloadZip([state.card], state.card.slug + '.zip'); };
els.nextBtn.onclick = () => {
  saveCardToSession();
  els.cardName.value = '';
  show('home');
  els.cardName.focus();
};
els.zipAllBtn.onclick = () => downloadZip(state.session, 'cards-' + new Date().toISOString().slice(0, 10) + '.zip');

window.addEventListener('resize', () => { if ($('camera').classList.contains('active')) layoutGuide(); });
window.addEventListener('beforeunload', (e) => { if (state.session.length) { e.preventDefault(); e.returnValue = ''; } });
document.addEventListener('visibilitychange', () => {
  // Release the camera when the app is backgrounded; reopen on return.
  if (document.hidden && state.stream) { stopCamera(); state.resumeCamera = true; }
  else if (!document.hidden && state.resumeCamera) { state.resumeCamera = false; openCamera(); }
});

// Install hint
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
if (!standalone) {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  els.installHint.textContent = ios
    ? 'Install: tap Share → "Add to Home Screen" to use this like an app.'
    : 'Install: open the browser menu → "Install app" / "Add to Home screen".';
  els.installHint.classList.remove('hidden');
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
