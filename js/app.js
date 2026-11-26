(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  // ───────── 다국어 ─────────
  let lang = 'ko';
  try { lang = localStorage.getItem('mallang.lang') || (navigator.language || 'ko').slice(0, 2); } catch (_) {}
  if (!window.I18N[lang]) lang = 'en';
  const t = (k, vars) => {
    let s = window.I18N[lang][k] ?? window.I18N.ko[k] ?? k;
    if (vars) for (const key in vars) s = s.replace(`{${key}}`, vars[key]);
    return s;
  };
  function applyLang() {
    document.documentElement.lang = lang;
    $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $$('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); el.setAttribute('aria-label', el.title); });
    $('#lang').value = lang;
    updateHint();
    updateRecButton();
  }

  // ───────── 상태 ─────────
  const RATIOS = { '9:16': [720, 1280], '1:1': [960, 960], '4:5': [864, 1080] };
  const BGS = ['#f6f1e4', '#e4dcf9', '#d6ecfa', '#fff0a8', '#ffd9cf', '#1e1b2e'];
  const DEFAULTS = { soft: 55, jiggle: 65, reach: 45, stretch: 50 };
  const S = {
    mode: 'play', W: 720, H: 1280, bg: BGS[0],
    img: null, iw: 1, ih: 1, rect: { x: 0, y: 0, s: 1 },
    circles: [{ x: 0, y: 0, r: 1 }, { x: 0, y: 0, r: 1 }], useCircles: true,
    cols: 1, rows: 1, n: 0,
    rest: null, d: null, v: null, w: null, tx: null, ty: null, g: null,
    grabs: new Map(), awake: true, hasSoft: false,
    set: { ...DEFAULTS }, sound: true, tool: 'brush', touched: false,
  };
  const history = [];

  const glc = $('#gl'), ovc = $('#overlay'), octx = ovc.getContext('2d');
  const stageEl = $('#stage');
  const mask = document.createElement('canvas');
  const mctx = mask.getContext('2d', { willReadFrequently: true });
  const PAINT = '#5b4bdb';

  // ───────── 알림 ─────────
  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }

  // ───────── WebGL ─────────
  const gl = glc.getContext('webgl', { preserveDrawingBuffer: true, alpha: false, antialias: true });
  let prog, bufPos, bufUv, bufIdx, tex, uRes, idxCount = 0, posArr;
  function initGl() {
    if (!gl) { toast(t('errGl')); return false; }
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER,
      'attribute vec2 aPos;attribute vec2 aUv;uniform vec2 uRes;varying vec2 vUv;' +
      'void main(){vUv=aUv;vec2 c=aPos/uRes*2.0-1.0;gl_Position=vec4(c.x,-c.y,0.0,1.0);}'));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER,
      'precision mediump float;uniform sampler2D uTex;varying vec2 vUv;void main(){gl_FragColor=texture2D(uTex,vUv);}'));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    uRes = gl.getUniformLocation(prog, 'uRes');
    bufPos = gl.createBuffer(); bufUv = gl.createBuffer(); bufIdx = gl.createBuffer();
    tex = gl.createTexture();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    return true;
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function render() {
    const { n, rest, d, rect } = S;
    for (let i = 0; i < n; i++) {
      posArr[i * 2] = rect.x + (rest[i * 2] + d[i * 2]) * rect.s;
      posArr[i * 2 + 1] = rect.y + (rest[i * 2 + 1] + d[i * 2 + 1]) * rect.s;
    }
    gl.viewport(0, 0, S.W, S.H);
    const [r, g, b] = hexToRgb(S.bg);
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(uRes, S.W, S.H);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufPos);
    gl.bufferData(gl.ARRAY_BUFFER, posArr, gl.DYNAMIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufUv);
    const aUv = gl.getAttribLocation(prog, 'aUv');
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufIdx);
    gl.drawElements(gl.TRIANGLES, idxCount, gl.UNSIGNED_SHORT, 0);
  }

  // ───────── 이미지 / 메시 ─────────
  function setImage(canvas, opts = {}) {
    S.img = canvas; S.iw = canvas.width; S.ih = canvas.height;
    const m = Math.min(S.iw, S.ih);
    const cell = Math.max(S.iw, S.ih) / 56;
    S.cols = Math.max(8, Math.round(S.iw / cell));
    S.rows = Math.max(8, Math.round(S.ih / cell));
    const gw = S.cols + 1, gh = S.rows + 1, n = gw * gh;
    S.n = n;
    S.rest = new Float32Array(n * 2); S.d = new Float32Array(n * 2); S.v = new Float32Array(n * 2);
    S.w = new Float32Array(n); S.tx = new Float32Array(n); S.ty = new Float32Array(n); S.g = new Float32Array(n);
    posArr = new Float32Array(n * 2);
    const uv = new Float32Array(n * 2);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      S.rest[i * 2] = (x / S.cols) * S.iw; S.rest[i * 2 + 1] = (y / S.rows) * S.ih;
      uv[i * 2] = x / S.cols; uv[i * 2 + 1] = y / S.rows;
    }
    const idx = new Uint16Array(S.cols * S.rows * 6);
    let k = 0;
    for (let y = 0; y < S.rows; y++) for (let x = 0; x < S.cols; x++) {
      const a = y * gw + x, b = a + 1, c = a + gw, e = c + 1;
      idx[k++] = a; idx[k++] = b; idx[k++] = c; idx[k++] = b; idx[k++] = e; idx[k++] = c;
    }
    idxCount = idx.length;
    gl.bindBuffer(gl.ARRAY_BUFFER, bufUv); gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufIdx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // 칠하기 마스크 (긴 변 256)
    const ms = 256 / Math.max(S.iw, S.ih);
    mask.width = Math.max(2, Math.round(S.iw * ms)); mask.height = Math.max(2, Math.round(S.ih * ms));
    mctx.clearRect(0, 0, mask.width, mask.height);

    S.circles = opts.circles
      ? opts.circles.map((c) => ({ ...c }))
      : [{ x: S.iw * 0.33, y: S.ih * 0.6, r: m * 0.17 }, { x: S.iw * 0.67, y: S.ih * 0.6, r: m * 0.17 }];
    S.useCircles = true; $('#useCircles').checked = true;
    $('#cheekSize').value = Math.round((S.circles[0].r / m) * 100);
    history.length = 0; updateUndo();
    S.grabs.clear();
    layout();
    buildWeights();
    setMode(opts.mode || 'circles');
  }

  function layout() {
    const margin = 0.12;
    const s = Math.min((S.W * (1 - margin * 2)) / S.iw, (S.H * (1 - margin * 2)) / S.ih);
    S.rect = { x: (S.W - S.iw * s) / 2, y: (S.H - S.ih * s) / 2, s };
    S.awake = true;
  }

  function setRatio(key) {
    const [w, h] = RATIOS[key];
    S.W = w; S.H = h;
    glc.width = ovc.width = w; glc.height = ovc.height = h;
    stageEl.style.setProperty('--arn', String(w / h));
    $$('#ratio button').forEach((b) => b.classList.toggle('on', b.dataset.ratio === key));
    if (S.img) layout();
  }

  // 마스크(원 + 칠) → 꼭짓점별 말랑함 가중치
  const wtmp = document.createElement('canvas');
  const wctx = wtmp.getContext('2d', { willReadFrequently: true });
  function buildWeights() {
    const gw = S.cols + 1, gh = S.rows + 1, n = S.n;
    wtmp.width = gw; wtmp.height = gh;
    wctx.clearRect(0, 0, gw, gh);
    wctx.drawImage(mask, 0, 0, gw, gh);
    const a = wctx.getImageData(0, 0, gw, gh).data;
    let w = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let v = a[i * 4 + 3] / 255;
      if (S.useCircles) {
        const px = S.rest[i * 2], py = S.rest[i * 2 + 1];
        for (const c of S.circles) {
          const q = Math.hypot(px - c.x, py - c.y) / c.r;
          const e = Math.min(1, Math.max(0, (q - 0.68) / (1.04 - 0.68)));
          v = Math.max(v, 1 - e * e * (3 - 2 * e));
        }
      }
      w[i] = v;
    }
    // 경계를 부드럽게 (3×3 박스 블러 2회)
    for (let pass = 0; pass < 2; pass++) {
      const o = new Float32Array(n);
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        let sum = 0, cnt = 0;
        for (let yy = Math.max(0, y - 1); yy <= Math.min(gh - 1, y + 1); yy++)
          for (let xx = Math.max(0, x - 1); xx <= Math.min(gw - 1, x + 1); xx++) { sum += w[yy * gw + xx]; cnt++; }
        o[y * gw + x] = sum / cnt;
      }
      w = o;
    }
    S.w = w;
    S.hasSoft = false;
    for (let i = 0; i < n; i++) if (w[i] > 0.3) { S.hasSoft = true; break; }
    resetSim();
  }

  function resetSim() {
    S.d.fill(0); S.v.fill(0); S.grabs.clear(); S.awake = true;
  }

  // ───────── 물리 ─────────
  const lerp = (a, b, p) => a + (b - a) * p;
  function params() {
    const m = Math.min(S.iw, S.ih);
    const freq = lerp(6, 1.8, S.set.soft / 100);
    const k = (2 * Math.PI * freq) ** 2;
    const zeta = 0.4 * Math.pow(0.125, S.set.jiggle / 100); // 0.4(금방 멈춤) → 0.05(오래 출렁)
    return {
      k, c: 2 * zeta * Math.sqrt(k), kc: k * 12,
      R: lerp(0.12, 0.5, S.set.reach / 100) * m,
      L: lerp(0.15, 0.6, S.set.stretch / 100) * m,
    };
  }
  const KG = 1600, CG = 2 * Math.sqrt(KG);

  function weightAt(ix, iy) {
    const gx = Math.round((ix / S.iw) * S.cols), gy = Math.round((iy / S.ih) * S.rows);
    if (gx < 0 || gy < 0 || gx > S.cols || gy > S.rows) return 0;
    return S.w[gy * (S.cols + 1) + gx];
  }

  function makeGrab(ix, iy) {
    const { R } = params();
    const idx = [], f = [];
    for (let i = 0; i < S.n; i++) {
      if (S.w[i] < 0.02) continue;
      const q = Math.hypot(S.rest[i * 2] - ix, S.rest[i * 2 + 1] - iy) / R;
      if (q >= 1) continue;
      const e = 1 - q * q;
      idx.push(i); f.push(e * e);
    }
    return { ox: ix, oy: iy, rawx: 0, rawy: 0, dx: 0, dy: 0, idx, f, anim: null };
  }

  function setGrabPull(grab, rx, ry) {
    const { L } = params();
    const len = Math.hypot(rx, ry);
    grab.rawx = rx; grab.rawy = ry;
    if (len < 1e-6) { grab.dx = grab.dy = 0; return; }
    const eff = L * (1 - Math.exp(-len / L)); // 멀리 당길수록 더 버팀
    grab.dx = (rx / len) * eff; grab.dy = (ry / len) * eff;
  }

  function releaseGrab(id) {
    const g = S.grabs.get(id);
    if (!g) return;
    S.grabs.delete(id);
    const { L } = params();
    boing(Math.min(1, Math.hypot(g.dx, g.dy) / (L * 0.8)));
  }

  function simulate(dt) {
    const { n, d, v, w, tx, ty, g } = S;
    const gw = S.cols + 1, gh = S.rows + 1;
    const { k, c, kc } = params();
    tx.fill(0); ty.fill(0); g.fill(0);
    for (const grab of S.grabs.values()) {
      for (let j = 0; j < grab.idx.length; j++) {
        const i = grab.idx[j], f = grab.f[j];
        tx[i] += grab.dx * f * w[i]; ty[i] += grab.dy * f * w[i];
        if (f > g[i]) g[i] = f;
      }
    }
    const steps = Math.max(1, Math.ceil(dt * 300));
    const h = dt / steps;
    let energy = 0;
    for (let s = 0; s < steps; s++) {
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        const i = y * gw + x, i2 = i * 2;
        if (w[i] < 0.02) { d[i2] = d[i2 + 1] = v[i2] = v[i2 + 1] = 0; continue; }
        let mx = 0, my = 0, cnt = 0;
        if (x > 0) { mx += d[i2 - 2]; my += d[i2 - 1]; cnt++; }
        if (x < gw - 1) { mx += d[i2 + 2]; my += d[i2 + 3]; cnt++; }
        if (y > 0) { mx += d[i2 - gw * 2]; my += d[i2 - gw * 2 + 1]; cnt++; }
        if (y < gh - 1) { mx += d[i2 + gw * 2]; my += d[i2 + gw * 2 + 1]; cnt++; }
        mx /= cnt; my /= cnt;
        let ax = -k * d[i2] - c * v[i2] + kc * (mx - d[i2]);
        let ay = -k * d[i2 + 1] - c * v[i2 + 1] + kc * (my - d[i2 + 1]);
        const gi = g[i];
        if (gi > 0) {
          ax = (1 - gi) * ax + gi * (KG * (tx[i] - d[i2]) - CG * v[i2]);
          ay = (1 - gi) * ay + gi * (KG * (ty[i] - d[i2 + 1]) - CG * v[i2 + 1]);
        }
        v[i2] += ax * h; v[i2 + 1] += ay * h;
      }
      for (let i = 0; i < n * 2; i++) d[i] += v[i] * h;
    }
    for (let i = 0; i < n * 2; i++) energy = Math.max(energy, Math.abs(d[i]), Math.abs(v[i]) * 0.02);
    return energy;
  }

  // ───────── 효과음 ─────────
  let ac = null;
  function boing(strength) {
    if (!S.sound || strength < 0.08) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      const now = ac.currentTime;
      const o = ac.createOscillator(), gain = ac.createGain();
      const f0 = 240 + 220 * strength;
      o.type = 'sine';
      o.frequency.setValueAtTime(f0, now);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.5, now + 0.09);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.85, now + 0.2);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.42, now + 0.42);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.06 + 0.22 * strength, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.46);
      o.connect(gain).connect(ac.destination);
      o.start(now); o.stop(now + 0.5);
    } catch (_) { /* 소리는 없어도 됨 */ }
  }

  // ───────── 모드 ─────────
  function setMode(mode) {
    if (mode === 'play') {
      buildWeights();
      if (!S.hasSoft) toast(t('errNoSoft'));
    } else {
      stopAuto();
      resetSim();
    }
    S.mode = mode;
    $$('#modeTabs button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    $$('.mode-pane').forEach((p) => { p.hidden = p.dataset.pane !== mode; });
    ovc.classList.toggle('paint', mode === 'paint');
    S.touched = false;
    updateHint();
    drawOverlay();
  }
  function updateHint() {
    const el = $('#hint');
    el.textContent = t(S.mode === 'play' ? 'hintPlay' : S.mode === 'circles' ? 'hintCircles' : 'hintPaint');
    el.classList.toggle('gone', S.touched);
  }

  // ───────── 오버레이 (원 / 칠) ─────────
  let brushPos = null;
  function drawOverlay() {
    octx.clearRect(0, 0, S.W, S.H);
    if (S.mode === 'play') return;
    const { x, y, s } = S.rect;
    if (S.mode === 'paint') {
      octx.globalAlpha = 0.5;
      octx.imageSmoothingEnabled = true;
      octx.drawImage(mask, x, y, S.iw * s, S.ih * s);
      octx.globalAlpha = 1;
    }
    if (S.mode === 'circles' || S.useCircles) {
      const strong = S.mode === 'circles';
      S.circles.forEach((c) => {
        const cx = x + c.x * s, cy = y + c.y * s, r = c.r * s;
        if (strong) { octx.fillStyle = 'rgba(91,75,219,.16)'; octx.beginPath(); octx.arc(cx, cy, r, 0, 6.2832); octx.fill(); }
        octx.setLineDash([12, 9]);
        octx.lineWidth = strong ? 7 : 4; octx.strokeStyle = 'rgba(255,255,255,.95)';
        octx.beginPath(); octx.arc(cx, cy, r, 0, 6.2832); octx.stroke();
        octx.lineWidth = strong ? 4 : 2; octx.strokeStyle = strong ? '#5b4bdb' : 'rgba(91,75,219,.7)';
        octx.beginPath(); octx.arc(cx, cy, r, 0, 6.2832); octx.stroke();
        octx.setLineDash([]);
        if (strong) {
          octx.fillStyle = '#fff'; octx.beginPath(); octx.arc(cx, cy, 9, 0, 6.2832); octx.fill();
          octx.fillStyle = '#5b4bdb'; octx.beginPath(); octx.arc(cx, cy, 5.5, 0, 6.2832); octx.fill();
        }
      });
    }
    if (S.mode === 'paint' && brushPos) {
      octx.lineWidth = 3; octx.strokeStyle = 'rgba(35,32,43,.8)';
      octx.beginPath(); octx.arc(x + brushPos.x * s, y + brushPos.y * s, brushRadius() * s, 0, 6.2832); octx.stroke();
    }
  }
  const brushRadius = () => (Number($('#brushSize').value) / 100) * Math.min(S.iw, S.ih) * 0.5;

  // ───────── 되돌리기 ─────────
  function snapshot() {
    history.push({
      circles: S.circles.map((c) => ({ ...c })), useCircles: S.useCircles,
      mask: mctx.getImageData(0, 0, mask.width, mask.height),
    });
    if (history.length > 30) history.shift();
    updateUndo();
  }
  function undo() {
    const h = history.pop();
    if (!h) return;
    S.circles = h.circles; S.useCircles = h.useCircles;
    $('#useCircles').checked = h.useCircles;
    mctx.putImageData(h.mask, 0, 0);
    $('#cheekSize').value = Math.round((S.circles[0].r / Math.min(S.iw, S.ih)) * 100);
    updateUndo();
    buildWeights();
    drawOverlay();
  }
  function updateUndo() { $('#btnUndo').disabled = history.length === 0; }

  // ───────── 포인터 ─────────
  function toImg(e) {
    const r = ovc.getBoundingClientRect();
    const sx = ((e.clientX - r.left) * S.W) / r.width, sy = ((e.clientY - r.top) * S.H) / r.height;
    return { x: (sx - S.rect.x) / S.rect.s, y: (sy - S.rect.y) / S.rect.s };
  }
  const drags = new Map(); // pointerId → 편집 드래그 상태

  function paintLine(a, b) {
    const k = mask.width / S.iw;
    mctx.globalCompositeOperation = S.tool === 'erase' ? 'destination-out' : 'source-over';
    mctx.strokeStyle = PAINT; mctx.fillStyle = PAINT;
    mctx.lineCap = 'round'; mctx.lineJoin = 'round';
    mctx.lineWidth = brushRadius() * 2 * k;
    mctx.beginPath(); mctx.moveTo(a.x * k, a.y * k); mctx.lineTo(b.x * k + 0.01, b.y * k + 0.01); mctx.stroke();
    mctx.globalCompositeOperation = 'source-over';
  }

  ovc.addEventListener('pointerdown', (e) => {
    if (!S.img) return;
    e.preventDefault();
    try { ovc.setPointerCapture(e.pointerId); } catch (_) {}
    const p = toImg(e);
    if (!S.touched) { S.touched = true; updateHint(); }

    if (S.mode === 'play') {
      stopAuto();
      let ox = p.x, oy = p.y;
      if (weightAt(p.x, p.y) < 0.1) {
        // 근처의 말랑한 꼭짓점을 찾아 거기를 잡음
        const { R } = params();
        let best = -1, bd = (R * 0.7) ** 2;
        for (let i = 0; i < S.n; i++) {
          if (S.w[i] < 0.4) continue;
          const dd = (S.rest[i * 2] - p.x) ** 2 + (S.rest[i * 2 + 1] - p.y) ** 2;
          if (dd < bd) { bd = dd; best = i; }
        }
        if (best < 0) { toast(t(S.hasSoft ? 'grabSoft' : 'errNoSoft')); return; }
        ox = S.rest[best * 2]; oy = S.rest[best * 2 + 1];
      }
      const grab = makeGrab(ox, oy);
      grab.start = p;
      S.grabs.set(e.pointerId, grab);
      S.awake = true;
      ovc.classList.add('grabbing');
    } else if (S.mode === 'circles') {
      const tol = Math.max(18 / S.rect.s, 0);
      let hit = null;
      S.circles.forEach((c, i) => {
        const dist = Math.hypot(p.x - c.x, p.y - c.y);
        if (Math.abs(dist - c.r) < Math.max(tol, c.r * 0.16)) hit = hit && hit.type === 'move' ? hit : { type: 'resize', i };
        else if (dist < c.r && (!hit || hit.type !== 'move')) hit = { type: 'move', i, ox: p.x - c.x, oy: p.y - c.y };
      });
      if (hit) { snapshot(); drags.set(e.pointerId, hit); }
    } else if (S.mode === 'paint') {
      snapshot();
      drags.set(e.pointerId, { type: 'paint', last: p });
      paintLine(p, p);
      brushPos = p;
      drawOverlay();
    }
  });

  ovc.addEventListener('pointermove', (e) => {
    if (!S.img) return;
    const p = toImg(e);
    if (S.mode === 'play') {
      const grab = S.grabs.get(e.pointerId);
      if (grab && grab.start) { setGrabPull(grab, p.x - grab.start.x, p.y - grab.start.y); S.awake = true; }
      return;
    }
    const dr = drags.get(e.pointerId);
    if (S.mode === 'paint') {
      brushPos = e.pointerType === 'touch' && !dr ? null : p;
      if (dr) { paintLine(dr.last, p); dr.last = p; }
      drawOverlay();
      return;
    }
    if (!dr) return;
    const m = Math.min(S.iw, S.ih);
    const c = S.circles[dr.i];
    if (dr.type === 'move') {
      c.x = Math.min(S.iw, Math.max(0, p.x - dr.ox));
      c.y = Math.min(S.ih, Math.max(0, p.y - dr.oy));
    } else {
      c.r = Math.min(m * 0.6, Math.max(m * 0.05, Math.hypot(p.x - c.x, p.y - c.y)));
    }
    drawOverlay();
  });

  const endPointer = (e) => {
    if (S.grabs.has(e.pointerId)) {
      releaseGrab(e.pointerId);
      if (S.grabs.size === 0) ovc.classList.remove('grabbing');
    }
    if (drags.has(e.pointerId)) {
      drags.delete(e.pointerId);
      buildWeights();
      drawOverlay();
    }
  };
  ovc.addEventListener('pointerup', endPointer);
  ovc.addEventListener('pointercancel', endPointer);
  ovc.addEventListener('pointerleave', () => { if (S.mode === 'paint' && drags.size === 0) { brushPos = null; drawOverlay(); } });

  // ───────── 자동으로 당기기 ─────────
  let auto = null;
  function softCenters() {
    if (S.useCircles) {
      const cs = S.circles.filter((c) => weightAt(c.x, c.y) > 0.3).map((c) => ({ x: c.x, y: c.y }));
      if (cs.length) return cs.sort((a, b) => a.x - b.x);
    }
    // 칠한 영역: 좌/우 절반의 무게중심
    const acc = [[0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < S.n; i++) {
      const w = S.w[i]; if (w < 0.3) continue;
      const side = S.rest[i * 2] < S.iw / 2 ? 0 : 1;
      acc[side][0] += S.rest[i * 2] * w; acc[side][1] += S.rest[i * 2 + 1] * w; acc[side][2] += w;
    }
    return acc.filter((a) => a[2] > 0).map((a) => ({ x: a[0] / a[2], y: a[1] / a[2] }));
  }
  function startAuto() {
    if (S.mode !== 'play') setMode('play');
    const centers = softCenters();
    if (!centers.length) { toast(t('errNoSoft')); return; }
    stopAuto();
    const plan = centers.length > 1 ? [[centers[0]], [centers[1]], centers] : [centers, centers, centers];
    auto = { plan, step: -1, next: performance.now(), ids: [] };
    $('#btnAuto').classList.add('busy');
    S.awake = true;
  }
  function stopAuto() {
    if (!auto) return;
    auto.ids.forEach((id) => S.grabs.delete(id));
    auto = null;
    $('#btnAuto').classList.remove('busy');
  }
  function tickAuto(now) {
    if (!auto) return;
    if (auto.ids.length && now >= auto.releaseAt) {
      auto.ids.forEach(releaseGrab); auto.ids = [];
      auto.next = now + 950;
    }
    if (!auto.ids.length && now >= auto.next) {
      auto.step++;
      if (auto.step >= auto.plan.length) { stopAuto(); return; }
      const { L } = params();
      auto.plan[auto.step].forEach((c, j) => {
        const side = Math.abs(c.x - S.iw / 2) < S.iw * 0.06 ? 0 : Math.sign(c.x - S.iw / 2);
        const dir = side === 0 ? [0, 1] : [side * 0.93, 0.36];
        const grab = makeGrab(c.x, c.y);
        grab.anim = { start: now, dur: 420, tx: dir[0] * L * 1.5, ty: dir[1] * L * 1.5 };
        const id = `auto${auto.step}-${j}`;
        S.grabs.set(id, grab); auto.ids.push(id);
      });
      auto.releaseAt = now + 560;
    }
    S.awake = true;
  }

  // ───────── 녹화 ─────────
  const MAX_REC = 15000, GIF_MAX_FRAMES = 80, GIF_DELAY = 100;
  let rec = null;
  const gifCv = document.createElement('canvas');
  const gifCtx = gifCv.getContext('2d', { willReadFrequently: true });
  let lastResult = null;

  function pickMime() {
    if (!window.MediaRecorder) return null;
    return ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
      .find((m) => MediaRecorder.isTypeSupported(m)) || null;
  }
  function startRec() {
    const mime = pickMime();
    if (!mime || !glc.captureStream) { toast(t('errRec')); return; }
    if (S.mode !== 'play') setMode('play');
    const stream = glc.captureStream(30);
    const mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
    const chunks = [];
    const k = 360 / Math.max(S.W, S.H);
    gifCv.width = Math.round(S.W * k); gifCv.height = Math.round(S.H * k);
    rec = { mr, chunks, mime, t0: performance.now(), frames: [], lastGif: -1e9 };
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = () => {
      stream.getTracks().forEach((tr) => tr.stop());
      const done = rec; rec = null;
      updateRecButton();
      $('#recBadge').hidden = true;
      showResult(new Blob(done.chunks, { type: done.mime.split(';')[0] }), done);
    };
    mr.start(250);
    $('#recBadge').hidden = false;
    updateRecButton();
    S.awake = true;
  }
  function stopRec() { if (rec && rec.mr.state !== 'inactive') rec.mr.stop(); }
  function updateRecButton() {
    const b = $('#btnRec');
    b.classList.toggle('on', !!rec);
    b.querySelector('span').textContent = t(rec ? 'stop' : 'rec');
  }
  function tickRec(now) {
    if (!rec) return;
    const el = now - rec.t0;
    $('#recTime').textContent = `0:${String(Math.floor(el / 1000)).padStart(2, '0')}`;
    if (rec.frames.length < GIF_MAX_FRAMES && now - rec.lastGif >= GIF_DELAY - 4) {
      rec.lastGif = now;
      gifCtx.drawImage(glc, 0, 0, gifCv.width, gifCv.height);
      rec.frames.push(gifCtx.getImageData(0, 0, gifCv.width, gifCv.height));
    }
    if (el >= MAX_REC) stopRec();
  }

  const stamp = () => {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  };
  function showResult(blob, done) {
    if (lastResult) { URL.revokeObjectURL(lastResult.url); if (lastResult.gifUrl) URL.revokeObjectURL(lastResult.gifUrl); }
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    const name = `mallang-${stamp()}`;
    const url = URL.createObjectURL(blob);
    lastResult = { blob, url, name, ext, frames: done.frames, gw: gifCv.width, gh: gifCv.height, gifUrl: null };
    const v = $('#resultVideo');
    v.hidden = false; v.src = url;
    $('#resultGif').hidden = true;
    $('#dlVideo').href = url; $('#dlVideo').download = `${name}.${ext}`;
    $('#dlGif').hidden = true; $('#btnGif').hidden = false; $('#btnGif').disabled = false;
    $('#btnGif').textContent = t('makeGif');
    $('#resultInfo').textContent = `${ext.toUpperCase()} · ${S.W}×${S.H} · ${(blob.size / 1048576).toFixed(1)}MB`;
    const file = new File([blob], `${name}.${ext}`, { type: blob.type });
    $('#btnShare').hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
    lastResult.file = file;
    $('#result').showModal();
  }
  async function makeGif() {
    if (!lastResult || !lastResult.frames.length) return;
    const b = $('#btnGif');
    b.disabled = true;
    const blob = await window.encodeGif(lastResult.frames, lastResult.gw, lastResult.gh, GIF_DELAY,
      (p) => { b.textContent = t('gifWorking', { p: Math.round(p * 100) }); });
    lastResult.gifUrl = URL.createObjectURL(blob);
    const img = $('#resultGif');
    img.src = lastResult.gifUrl; img.hidden = false;
    $('#resultVideo').hidden = true; $('#resultVideo').pause();
    const a = $('#dlGif');
    a.href = lastResult.gifUrl; a.download = `${lastResult.name}.gif`; a.hidden = false;
    b.hidden = true;
    $('#resultInfo').textContent = `GIF · ${lastResult.gw}×${lastResult.gh} · ${(blob.size / 1048576).toFixed(1)}MB`;
  }

  function savePng() {
    render();
    glc.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `mallang-${stamp()}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast(t('savedPng'));
    }, 'image/png');
  }

  // ───────── 사진 불러오기 ─────────
  async function loadFile(file) {
    if (!file || !/^image\//.test(file.type)) { toast(t('errImage')); return; }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const k = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
      const cv = document.createElement('canvas');
      cv.width = Math.max(2, Math.round(img.naturalWidth * k));
      cv.height = Math.max(2, Math.round(img.naturalHeight * k));
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      setImage(cv, { mode: 'circles' });
    } catch (_) {
      toast(t('errImage'));
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  function loadSample() {
    const s = window.drawSample();
    setImage(s.canvas, { circles: s.circles, mode: 'play' });
  }

  // ───────── 메인 루프 ─────────
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(1 / 30, Math.max(0.001, (now - last) / 1000));
    last = now;
    if (S.img) {
      tickAuto(now);
      for (const g of S.grabs.values()) {
        if (!g.anim) continue;
        const p = Math.min(1, (now - g.anim.start) / g.anim.dur);
        const e = 1 - (1 - p) ** 3;
        setGrabPull(g, g.anim.tx * e, g.anim.ty * e);
      }
      if (S.awake || rec) {
        const energy = S.mode === 'play' ? simulate(dt) : 0;
        render();
        if (energy < 0.02 && S.grabs.size === 0 && !auto) S.awake = false;
      }
      tickRec(now);
    }
    requestAnimationFrame(frame);
  }

  // ───────── UI 연결 ─────────
  function bindUi() {
    $('#lang').addEventListener('change', (e) => {
      lang = e.target.value;
      try { localStorage.setItem('mallang.lang', lang); } catch (_) {}
      applyLang();
    });
    $('#btnLoad').addEventListener('click', () => $('#file').click());
    $('#file').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });
    $('#btnSample').addEventListener('click', loadSample);
    $$('#modeTabs button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
    $$('[data-done]').forEach((b) => b.addEventListener('click', () => setMode('play')));

    $('#btnRec').addEventListener('click', () => (rec ? stopRec() : startRec()));
    $('#btnAuto').addEventListener('click', () => (auto ? stopAuto() : startAuto()));
    $('#btnPng').addEventListener('click', savePng);
    $('#btnUndo').addEventListener('click', undo);
    $('#btnSound').addEventListener('click', (e) => {
      S.sound = !S.sound;
      e.currentTarget.setAttribute('aria-pressed', String(S.sound));
      if (S.sound) boing(0.5);
    });

    // 볼 크기: 드래그 한 번에 되돌리기 한 칸
    let sliding = false;
    $('#cheekSize').addEventListener('input', (e) => {
      if (!sliding) { snapshot(); sliding = true; }
      const r = (Number(e.target.value) / 100) * Math.min(S.iw, S.ih);
      S.circles.forEach((c) => { c.r = r; });
      drawOverlay();
    });
    $('#cheekSize').addEventListener('change', () => { sliding = false; buildWeights(); });

    $$('#brushTool button').forEach((b) => b.addEventListener('click', () => {
      S.tool = b.dataset.tool;
      $$('#brushTool button').forEach((x) => x.classList.toggle('on', x === b));
    }));
    $('#btnFill').addEventListener('click', () => {
      snapshot();
      mctx.fillStyle = PAINT; mctx.fillRect(0, 0, mask.width, mask.height);
      buildWeights(); drawOverlay();
    });
    $('#btnClear').addEventListener('click', () => {
      snapshot();
      mctx.clearRect(0, 0, mask.width, mask.height);
      buildWeights(); drawOverlay();
    });
    $('#useCircles').addEventListener('change', (e) => {
      snapshot();
      S.useCircles = e.target.checked;
      buildWeights(); drawOverlay();
    });

    // 배경
    const sw = $('#swatches');
    const setBg = (hex, el) => {
      S.bg = hex; S.awake = true;
      [...sw.children].forEach((c) => c.classList.toggle('on', c === el));
    };
    BGS.forEach((hex, i) => {
      const b = document.createElement('button');
      b.style.background = hex; b.title = hex; b.setAttribute('aria-label', hex);
      if (i === 0) b.classList.add('on');
      b.addEventListener('click', () => setBg(hex, b));
      sw.appendChild(b);
    });
    const custom = document.createElement('label');
    custom.title = 'custom';
    const ci = document.createElement('input');
    ci.type = 'color'; ci.value = '#9ad1b0'; ci.setAttribute('aria-label', 'custom color');
    ci.addEventListener('input', () => setBg(ci.value, custom));
    custom.appendChild(ci); sw.appendChild(custom);

    $$('#ratio button').forEach((b) => b.addEventListener('click', () => {
      if (rec) return;
      setRatio(b.dataset.ratio); drawOverlay();
    }));

    // 말랑함 설정
    const map = { sSoft: 'soft', sJiggle: 'jiggle', sReach: 'reach', sStretch: 'stretch' };
    Object.entries(map).forEach(([id, key]) => {
      $(`#${id}`).addEventListener('input', (e) => { S.set[key] = Number(e.target.value); S.awake = true; });
    });
    $('#btnResetSet').addEventListener('click', () => {
      S.set = { ...DEFAULTS };
      Object.entries(map).forEach(([id, key]) => { $(`#${id}`).value = S.set[key]; });
    });

    // 결과 창
    $('#btnClose').addEventListener('click', () => $('#result').close());
    $('#result').addEventListener('close', () => { $('#resultVideo').pause(); });
    $('#btnGif').addEventListener('click', makeGif);
    $('#btnShare').addEventListener('click', async () => {
      try { await navigator.share({ files: [lastResult.file] }); } catch (_) { /* 취소 */ }
    });

    // 끌어다 놓기 / 붙여넣기
    let dragDepth = 0;
    const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth++; document.body.classList.add('dragging'); } });
    window.addEventListener('dragleave', (e) => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
    window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
      loadFile(e.dataTransfer.files[0]);
    });
    window.addEventListener('paste', (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (item) loadFile(item.getAsFile());
    });
  }

  // ───────── 시작 ─────────
  bindUi();
  applyLang();
  if (initGl()) {
    setRatio('9:16');
    loadSample();
    requestAnimationFrame(frame);
  }

  // 디버깅/테스트용
  window.__mallang = { S, startAuto, setMode, simulate, makeGrab, setGrabPull, releaseGrab, render };
})();
