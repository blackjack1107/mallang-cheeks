// 작은 GIF89a 인코더: 전체 프레임 공통 팔레트(미디언 컷) + LZW
window.encodeGif = async function encodeGif(frames, width, height, delayMs, onProgress) {
  // 1) 15비트 히스토그램
  const hist = new Uint32Array(32768);
  const stride = Math.max(1, Math.floor(frames.length / 12));
  for (let f = 0; f < frames.length; f += stride) {
    const d = frames[f].data;
    for (let i = 0; i < d.length; i += 8) hist[((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3)]++;
  }
  const bins = [];
  for (let i = 0; i < 32768; i++) if (hist[i]) bins.push(i);

  // 2) 미디언 컷
  const makeBox = (list) => {
    let r0 = 31, r1 = 0, g0 = 31, g1 = 0, b0 = 31, b1 = 0, count = 0;
    for (const v of list) {
      const r = v >> 10, g = (v >> 5) & 31, b = v & 31;
      if (r < r0) r0 = r; if (r > r1) r1 = r;
      if (g < g0) g0 = g; if (g > g1) g1 = g;
      if (b < b0) b0 = b; if (b > b1) b1 = b;
      count += hist[v];
    }
    const dr = r1 - r0, dg = g1 - g0, db = b1 - b0;
    const axis = dr >= dg && dr >= db ? 0 : dg >= db ? 1 : 2;
    return { list, count, range: Math.max(dr, dg, db), axis };
  };
  const chan = [(v) => v >> 10, (v) => (v >> 5) & 31, (v) => v & 31];
  const boxes = [makeBox(bins)];
  while (boxes.length < 256) {
    let best = -1, bestScore = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.list.length < 2) continue;
      const score = b.count * (b.range + 1);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) break;
    const b = boxes[best];
    const key = chan[b.axis];
    b.list.sort((x, y) => key(x) - key(y));
    let acc = 0, cut = 1;
    for (let i = 0; i < b.list.length - 1; i++) {
      acc += hist[b.list[i]];
      if (acc >= b.count / 2) { cut = i + 1; break; }
      cut = i + 1;
    }
    boxes.splice(best, 1, makeBox(b.list.slice(0, cut)), makeBox(b.list.slice(cut)));
  }
  const palette = new Uint8Array(768);
  boxes.forEach((b, i) => {
    let r = 0, g = 0, bl = 0, n = 0;
    for (const v of b.list) {
      const h = hist[v];
      r += (v >> 10) * h; g += ((v >> 5) & 31) * h; bl += (v & 31) * h; n += h;
    }
    n = n || 1;
    palette[i * 3] = Math.round((r / n) * 8.226);
    palette[i * 3 + 1] = Math.round((g / n) * 8.226);
    palette[i * 3 + 2] = Math.round((bl / n) * 8.226);
  });
  const nColors = boxes.length;

  // 3) 색 → 팔레트 인덱스 (지연 캐시)
  const cache = new Int16Array(32768).fill(-1);
  const nearest = (v) => {
    const r = (v >> 10) * 8.226, g = ((v >> 5) & 31) * 8.226, b = (v & 31) * 8.226;
    let bi = 0, bd = Infinity;
    for (let i = 0; i < nColors; i++) {
      const dr = palette[i * 3] - r, dg = palette[i * 3 + 1] - g, db = palette[i * 3 + 2] - b;
      const dd = dr * dr + dg * dg + db * db;
      if (dd < bd) { bd = dd; bi = i; }
    }
    return bi;
  };

  // 4) LZW
  const lzw = (idx) => {
    const out = [];
    const minCode = 8, clear = 256, eoi = 257;
    let codeSize = minCode + 1, next = eoi + 1, cur = 0, bits = 0;
    let dict = new Map();
    const emit = (code) => {
      cur |= code << bits; bits += codeSize;
      while (bits >= 8) { out.push(cur & 255); cur >>>= 8; bits -= 8; }
    };
    emit(clear);
    let prefix = idx[0];
    for (let i = 1; i < idx.length; i++) {
      const k = idx[i];
      const key = (prefix << 8) | k;
      const hit = dict.get(key);
      if (hit !== undefined) { prefix = hit; continue; }
      emit(prefix);
      if (next < 4096) {
        dict.set(key, next++);
        if (next > (1 << codeSize) && codeSize < 12) codeSize++;
      } else {
        emit(clear);
        dict = new Map(); codeSize = minCode + 1; next = eoi + 1;
      }
      prefix = k;
    }
    emit(prefix); emit(eoi);
    if (bits > 0) out.push(cur & 255);
    return out;
  };

  // 5) 파일 쓰기
  const parts = [];
  const push = (arr) => parts.push(arr instanceof Uint8Array ? arr : Uint8Array.from(arr));
  const le = (n) => [n & 255, (n >> 8) & 255];
  push([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...le(width), ...le(height), 0xf7, 0, 0]);
  push(palette);
  push([0x21, 0xff, 0x0b, 0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, 0x03, 0x01, 0, 0, 0]);
  const delay = Math.max(2, Math.round(delayMs / 10));
  const idx = new Uint8Array(width * height);
  for (let f = 0; f < frames.length; f++) {
    const d = frames[f].data;
    for (let p = 0, i = 0; p < idx.length; p++, i += 4) {
      const v = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
      let c = cache[v];
      if (c < 0) { c = nearest(v); cache[v] = c; }
      idx[p] = c;
    }
    push([0x21, 0xf9, 0x04, 0x00, ...le(delay), 0, 0]);
    push([0x2c, 0, 0, 0, 0, ...le(width), ...le(height), 0]);
    push([8]);
    const data = lzw(idx);
    for (let o = 0; o < data.length; o += 255) {
      const n = Math.min(255, data.length - o);
      const block = new Uint8Array(n + 1);
      block[0] = n;
      for (let j = 0; j < n; j++) block[j + 1] = data[o + j];
      parts.push(block);
    }
    push([0]);
    if (onProgress) onProgress((f + 1) / frames.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  push([0x3b]);
  return new Blob(parts, { type: 'image/gif' });
};
