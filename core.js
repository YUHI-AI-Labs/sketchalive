/*
 * SketchAlive core pipeline (browser + node compatible, zero deps)
 *
 *   raw RGBA pixels ({ width, height, data })
 *     -> ink mask (Otsu threshold + saturation rescue)
 *     -> largest connected component (paper-frame rejection)
 *     -> bounding box
 *     -> heuristic humanoid joints (15 joints)
 *     -> traits + easter-egg flags
 *     -> deformable grid mesh with 2-bone linear blend skinning weights
 *
 * No canvas / DOM usage in here so the whole pipeline is unit-testable in node.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SketchAliveCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const JOINT_NAMES = [
    "head", "neck",
    "shoulder_left", "elbow_left", "hand_left",
    "shoulder_right", "elbow_right", "hand_right",
    "root",
    "hip_left", "knee_left", "foot_left",
    "hip_right", "knee_right", "foot_right",
  ];

  // Skinning bones: [name, jointA, jointB]
  const BONES = [
    ["torso",      "root",           "neck"],
    ["head",       "neck",           "head"],
    ["uarm_left",  "shoulder_left",  "elbow_left"],
    ["larm_left",  "elbow_left",     "hand_left"],
    ["uarm_right", "shoulder_right", "elbow_right"],
    ["larm_right", "elbow_right",    "hand_right"],
    ["thigh_left", "hip_left",       "knee_left"],
    ["shin_left",  "knee_left",      "foot_left"],
    ["thigh_right","hip_right",      "knee_right"],
    ["shin_right", "knee_right",     "foot_right"],
  ];

  /* ---------------- ink mask ---------------- */

  function otsu(hist, total) {
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 127, bestVar = -1;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const v = wB * wF * (mB - mF) * (mB - mF);
      if (v > bestVar) { bestVar = v; best = t; }
    }
    return best;
  }

  // -> { mask: Uint8Array, threshold }
  function inkMask(img) {
    const { width: w, height: h, data } = img;
    const n = w * h;
    const lum = new Uint8Array(n);
    const sat = new Uint8Array(n); // 0..255
    const hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      const l = (r * 77 + g * 150 + b * 29) >> 8;
      lum[i] = l;
      hist[l]++;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      sat[i] = mx === 0 ? 0 : ((mx - mn) * 255 / mx) | 0;
    }
    let t = otsu(hist, n);
    // Guard: on nearly-white pages Otsu can drift high; clamp into sane band.
    t = Math.max(40, Math.min(t, 200));
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      // dark ink, or clearly colored stroke (crayon/marker) that is not near-white
      if (lum[i] < t || (sat[i] > 90 && lum[i] < 230)) mask[i] = 1;
    }
    return { mask, threshold: t };
  }

  /* ---------------- connected components ---------------- */

  // 4-connected component labeling. Returns { labels, comps } where comps is
  // every blob (not just the winner) with its bbox/size/border-touch info,
  // so callers can make a merge decision instead of a single largest-wins pick.
  function labelComponents(mask, w, h) {
    const n = w * h;
    const labels = new Int32Array(n); // 0 = unvisited
    const queue = new Int32Array(n);
    let nextLabel = 0;
    const comps = []; // {label,size,minX,minY,maxX,maxY,borderTouch,cx,cy}
    for (let start = 0; start < n; start++) {
      if (!mask[start] || labels[start]) continue;
      nextLabel++;
      let head = 0, tail = 0;
      queue[tail++] = start;
      labels[start] = nextLabel;
      let size = 0, minX = w, minY = h, maxX = -1, maxY = -1, sx = 0, sy = 0;
      const touched = new Set();
      while (head < tail) {
        const p = queue[head++];
        size++;
        const x = p % w, y = (p / w) | 0;
        sx += x; sy += y;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (x === 0) touched.add("L"); if (x === w - 1) touched.add("R");
        if (y === 0) touched.add("T"); if (y === h - 1) touched.add("B");
        if (x > 0     && mask[p - 1] && !labels[p - 1]) { labels[p - 1] = nextLabel; queue[tail++] = p - 1; }
        if (x < w - 1 && mask[p + 1] && !labels[p + 1]) { labels[p + 1] = nextLabel; queue[tail++] = p + 1; }
        if (y > 0     && mask[p - w] && !labels[p - w]) { labels[p - w] = nextLabel; queue[tail++] = p - w; }
        if (y < h - 1 && mask[p + w] && !labels[p + w]) { labels[p + w] = nextLabel; queue[tail++] = p + w; }
      }
      comps.push({
        label: nextLabel, size, minX, minY, maxX, maxY, borderTouch: touched.size,
        cx: sx / size, cy: sy / size,
      });
    }
    return { labels, comps };
  }

  function isFrameLike(c, w, h) {
    const spanW = (c.maxX - c.minX + 1) / w, spanH = (c.maxY - c.minY + 1) / h;
    return c.borderTouch >= 3 && spanW > 0.9 && spanH > 0.9;
  }

  function maskFromLabels(labels, wantSet, n) {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (wantSet.has(labels[i])) out[i] = 1;
    return out;
  }

  // Largest 4-connected component, skipping "frame like" blobs
  // (paper edge shadows: touch many borders AND span most of the image).
  // Kept for backwards compat / tests; extractCharacter() now uses
  // assembleCreature() below, which does not discard everything but the
  // single biggest blob.
  function largestComponent(mask, w, h) {
    const n = w * h;
    const { labels, comps } = labelComponents(mask, w, h);
    if (!comps.length) return null;
    comps.sort((a, b) => b.size - a.size);
    let chosen = null;
    for (const c of comps) { if (!isFrameLike(c, w, h)) { chosen = c; break; } }
    if (!chosen) chosen = comps[0];
    const out = maskFromLabels(labels, new Set([chosen.label]), n);
    return {
      mask: out,
      bbox: { x: chosen.minX, y: chosen.minY, w: chosen.maxX - chosen.minX + 1, h: chosen.maxY - chosen.minY + 1 },
      size: chosen.size,
    };
  }

  // Distance between two axis-aligned bboxes (0 if they overlap/touch).
  function bboxGap(a, b) {
    const dx = Math.max(a.minX, b.minX) > Math.min(a.maxX, b.maxX)
      ? Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX) : 0;
    const dy = Math.max(a.minY, b.minY) > Math.min(a.maxY, b.maxY)
      ? Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY) : 0;
    return Math.hypot(dx, dy);
  }

  // A "child's free-form doodle" is rarely one connected blob: the head
  // touches the neck by a pixel or two, an arm trails off, a foot is a
  // separate scribble. largestComponent() alone drops all of that (HANDOFF
  // weakness #2/#3). assembleCreature() instead treats the biggest blob as
  // the torso anchor and folds in nearby, plausibly-sized neighbors, while
  // still rejecting far-away marks (a second doodle elsewhere on the page)
  // and paper-frame/shadow blobs.
  function assembleCreature(mask, w, h) {
    const n = w * h;
    const { labels, comps } = labelComponents(mask, w, h);
    const real = comps.filter(c => !isFrameLike(c, w, h));
    if (!real.length) return null;
    real.sort((a, b) => b.size - a.size);
    const core = real[0];
    const coreDiag = Math.hypot(core.maxX - core.minX + 1, core.maxY - core.minY + 1);
    const mergeRadius = Math.max(12, coreDiag * 0.35);
    const sizeFloor = Math.max(6, core.size * 0.004);

    const included = [core];
    const excluded = [];
    for (let i = 1; i < real.length; i++) {
      const c = real[i];
      const gap = bboxGap(core, c);
      const tooSmall = c.size < sizeFloor;
      const tooFar = gap > mergeRadius;
      const tooBig = (c.maxX - c.minX) > coreDiag * 2.5 || (c.maxY - c.minY) > coreDiag * 2.5;
      if (!tooSmall && !tooFar && !tooBig) included.push(c);
      else excluded.push({ ...c, reason: tooFar ? "too_far" : tooSmall ? "too_small" : "too_big", gap });
    }

    const labelSet = new Set(included.map(c => c.label));
    const out = maskFromLabels(labels, labelSet, n);
    let minX = w, minY = h, maxX = -1, maxY = -1, size = 0;
    for (const c of included) {
      if (c.minX < minX) minX = c.minX; if (c.maxX > maxX) maxX = c.maxX;
      if (c.minY < minY) minY = c.minY; if (c.maxY > maxY) maxY = c.maxY;
      size += c.size;
    }
    return {
      mask: out,
      bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
      size,
      componentCount: included.length,
      included: included.map(c => ({ minX: c.minX, minY: c.minY, maxX: c.maxX, maxY: c.maxY, size: c.size })),
      excluded: excluded.map(c => ({ minX: c.minX, minY: c.minY, maxX: c.maxX, maxY: c.maxY, size: c.size, reason: c.reason })),
    };
  }

  function dilate(mask, w, h, radius) {
    let cur = mask;
    for (let r = 0; r < radius; r++) {
      const next = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = y * w + x;
          if (cur[p] ||
              (x > 0 && cur[p - 1]) || (x < w - 1 && cur[p + 1]) ||
              (y > 0 && cur[p - w]) || (y < h - 1 && cur[p + w])) next[p] = 1;
        }
      }
      cur = next;
    }
    return cur;
  }

  function erode(mask, w, h, radius) {
    let cur = mask;
    for (let r = 0; r < radius; r++) {
      const next = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = y * w + x;
          if (cur[p] &&
              (x === 0 || cur[p - 1]) && (x === w - 1 || cur[p + 1]) &&
              (y === 0 || cur[p - w]) && (y === h - 1 || cur[p + w])) next[p] = 1;
        }
      }
      cur = next;
    }
    return cur;
  }

  /* ---------------- paper detection + perspective correction ----------------
   * Zero-dep heuristic, NOT a full Canny/contour pipeline: the paper is
   * assumed to be the largest low-saturation, high-luminance connected blob
   * in frame (works for a light sheet of paper on a contrasting desk; will
   * misfire on a white desk or heavily colored lighting -- that's exactly
   * why the manual 4-corner fallback exists in the UI). Corners are the
   * extreme points of that blob along the 4 diagonal support directions,
   * which approximates a quadrilateral for a moderately rotated/skewed
   * rectangle without needing full contour tracing + polygon fitting.
   */

  function downsample(img, maxDim) {
    const { width: w, height: h, data } = img;
    const k = Math.min(1, maxDim / Math.max(w, h));
    if (k >= 1) return { img, scale: 1 };
    const dw = Math.max(1, Math.round(w * k)), dh = Math.max(1, Math.round(h * k));
    const out = new Uint8ClampedArray(dw * dh * 4);
    for (let y = 0; y < dh; y++) {
      const sy = Math.min(h - 1, Math.round(y / k));
      for (let x = 0; x < dw; x++) {
        const sx = Math.min(w - 1, Math.round(x / k));
        const si = (sy * w + sx) * 4, di = (y * dw + x) * 4;
        out[di] = data[si]; out[di + 1] = data[si + 1]; out[di + 2] = data[si + 2]; out[di + 3] = 255;
      }
    }
    return { img: { width: dw, height: dh, data: out }, scale: dw / w };
  }

  // -> { found, corners: [[x,y]x4] in TL,TR,BR,BL order (original-image px), confidence, debug }
  function detectPaperQuad(img, opts) {
    const maxDim = (opts && opts.maxDim) || 220;
    const { img: small, scale } = downsample(img, maxDim);
    const { width: w, height: h, data } = small;
    const n = w * h;
    const lum = new Uint8Array(n), sat = new Uint8Array(n), hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      const l = (r * 77 + g * 150 + b * 29) >> 8;
      lum[i] = l; hist[l]++;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      sat[i] = mx === 0 ? 0 : ((mx - mn) * 255 / mx) | 0;
    }
    const t = Math.max(90, otsu(hist, n)); // paper should be the brighter side of the split
    let mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (lum[i] >= t && sat[i] < 60) mask[i] = 1;
    mask = erode(mask, w, h, 1);
    mask = dilate(mask, w, h, 2);

    const { comps } = labelComponents(mask, w, h);
    if (!comps.length) return { found: false, corners: null, confidence: 0, debug: { threshold: t, width: w, height: h, mask } };
    comps.sort((a, b) => b.size - a.size);
    const c = comps[0];
    const frameFrac = c.size / n;
    if (frameFrac < 0.06 || frameFrac > 0.97) {
      // too small to trust, or "everything is paper-colored" (no contrast to find an edge with)
      return { found: false, corners: null, confidence: 0.15, debug: { threshold: t, width: w, height: h, mask, chosen: c } };
    }

    // 4-direction support function over the chosen blob's actual pixels
    // (not just its bbox corners, so it still works when the paper is rotated).
    const { labels } = labelComponents(mask, w, h);
    let tl = null, tr = null, br = null, bl = null; // by (x+y) min/max and (x-y) min/max
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (labels[y * w + x] !== c.label) continue;
        const s = x + y, d = x - y;
        if (!tl || s < tl.s) tl = { x, y, s };
        if (!br || s > br.s) br = { x, y, s };
        if (!bl || d < bl.d) bl = { x, y, d };
        if (!tr || d > tr.d) tr = { x, y, d };
      }
    }
    const corners = [tl, tr, br, bl].map(p => [p.x / scale, p.y / scale]);
    const quadArea = Math.abs(shoelace(corners));
    const pixelArea = c.size / (scale * scale);
    const shapeFit = pixelArea > 0 ? Math.min(quadArea, pixelArea) / Math.max(quadArea, pixelArea) : 0;
    const confidence = Math.max(0, Math.min(1, shapeFit)) * (frameFrac > 0.9 ? 0.85 : 1);

    return {
      found: confidence > 0.35,
      corners,
      confidence,
      debug: { threshold: t, width: w, height: h, mask, chosen: c, scale },
    };
  }

  function shoelace(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
      a += x0 * y1 - x1 * y0;
    }
    return a / 2;
  }

  // Projective (not just affine) map from the unit square (u,v ∈ [0,1]) to
  // the quad [P0,P1,P2,P3] = [TL,TR,BR,BL]. Standard "square-to-quad"
  // homography (Heckbert) -- see test-paper.mjs for the round-trip proof.
  function squareToQuadHomography(quad) {
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad;
    const dx1 = x1 - x2, dy1 = y1 - y2;
    const dx2 = x3 - x2, dy2 = y3 - y2;
    const dx3 = x0 - x1 + x2 - x3, dy3 = y0 - y1 + y2 - y3;
    let g, h;
    const det = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) { g = 0; h = 0; }
    else if (Math.abs(det) < 1e-9) { g = 0; h = 0; }
    else { g = (dx3 * dy2 - dx2 * dy3) / det; h = (dx1 * dy3 - dx3 * dy1) / det; }
    const A = x1 - x0 + g * x1, B = x3 - x0 + h * x3, C = x0;
    const D = y1 - y0 + g * y1, E = y3 - y0 + h * y3, F = y0;
    return { A, B, C, D, E, F, G: g, H: h };
  }

  function mapUnitSquareToQuad(hom, u, v) {
    const denom = hom.G * u + hom.H * v + 1;
    return [
      (hom.A * u + hom.B * v + hom.C) / denom,
      (hom.D * u + hom.E * v + hom.F) / denom,
    ];
  }

  function sampleBilinear(img, x, y) {
    const { width: w, height: h, data } = img;
    const x0 = Math.max(0, Math.min(w - 1, Math.floor(x))), y0 = Math.max(0, Math.min(h - 1, Math.floor(y)));
    const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
    const fx = Math.max(0, Math.min(1, x - x0)), fy = Math.max(0, Math.min(1, y - y0));
    const out = [0, 0, 0, 0];
    const wgts = [[x0, y0, (1 - fx) * (1 - fy)], [x1, y0, fx * (1 - fy)], [x0, y1, (1 - fx) * fy], [x1, y1, fx * fy]];
    for (const [sx, sy, wgt] of wgts) {
      const si = (sy * w + sx) * 4;
      out[0] += data[si] * wgt; out[1] += data[si + 1] * wgt; out[2] += data[si + 2] * wgt; out[3] += data[si + 3] * wgt;
    }
    return out;
  }

  // quad: [TL,TR,BR,BL] in `img` pixel coords -> a new outW x outH RGBA image
  // that is `img`'s content warped as if that quad were photographed face-on.
  function warpQuadToRect(img, quad, outW, outH) {
    const hom = squareToQuadHomography(quad);
    const out = new Uint8ClampedArray(outW * outH * 4);
    for (let y = 0; y < outH; y++) {
      const v = (y + 0.5) / outH;
      for (let x = 0; x < outW; x++) {
        const u = (x + 0.5) / outW;
        const [sx, sy] = mapUnitSquareToQuad(hom, u, v);
        const di = (y * outW + x) * 4;
        if (sx < -1 || sy < -1 || sx > img.width || sy > img.height) {
          out[di + 3] = 0; continue;
        }
        const [r, g, b, a] = sampleBilinear(img, sx, sy);
        out[di] = r; out[di + 1] = g; out[di + 2] = b; out[di + 3] = a;
      }
    }
    return { width: outW, height: outH, data: out };
  }

  /* ---------------- deterministic PRNG (for tests / fixtures only) ---------------- */
  // mulberry32 -- tiny, fast, seedable. Used so synthetic "real-photo-like"
  // fixtures (shadows, noise, wobble) are reproducible instead of flaking.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------------- joint heuristics ---------------- */

  function bandCentroid(mask, w, bbox, y0f, y1f) {
    const y0 = bbox.y + Math.floor(bbox.h * y0f);
    const y1 = bbox.y + Math.ceil(bbox.h * y1f);
    let sx = 0, sy = 0, m = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = bbox.x; x < bbox.x + bbox.w; x++) {
        if (mask[y * w + x]) { sx += x; sy += y; m++; }
      }
    }
    return m ? { x: sx / m, y: sy / m, mass: m } : null;
  }

  function bandExtreme(mask, w, bbox, y0f, y1f, side /* -1 left, +1 right */) {
    const y0 = bbox.y + Math.floor(bbox.h * y0f);
    const y1 = bbox.y + Math.ceil(bbox.h * y1f);
    let best = null;
    for (let y = y0; y < y1; y++) {
      for (let x = bbox.x; x < bbox.x + bbox.w; x++) {
        if (!mask[y * w + x]) continue;
        if (!best || (side < 0 ? x < best.x : x > best.x)) best = { x, y };
      }
    }
    return best;
  }

  function estimateJoints(mask, w, h, bbox) {
    const J = {};
    const bx = bbox.x, by = bbox.y, bw = bbox.w, bh = bbox.h;
    const cx = bx + bw / 2;
    const warnings = [];

    const headC = bandCentroid(mask, w, bbox, 0, 0.28) || { x: cx, y: by + bh * 0.1, mass: 0 };
    J.head = [headC.x, by + bh * 0.10];
    J.neck = [headC.x, by + bh * 0.30];
    const rootC = bandCentroid(mask, w, bbox, 0.42, 0.62);
    J.root = [rootC ? rootC.x : cx, by + bh * 0.52];

    // Arms: extreme left/right points in upper-middle band.
    const armBand = [0.24, 0.60];
    const leftHand = bandExtreme(mask, w, bbox, armBand[0], armBand[1], -1);
    const rightHand = bandExtreme(mask, w, bbox, armBand[0], armBand[1], +1);
    const armReach = Math.max(
      leftHand ? J.neck[0] - leftHand.x : 0,
      rightHand ? rightHand.x - J.neck[0] : 0
    );
    const armsMissing = armReach < bw * 0.18;
    const shoulderY = by + bh * 0.33;
    const shoulderDX = Math.max(bw * 0.05, 3);
    J.shoulder_left = [J.neck[0] - shoulderDX, shoulderY];
    J.shoulder_right = [J.neck[0] + shoulderDX, shoulderY];
    if (armsMissing) {
      // stubby arms hanging at the sides; rig must never crash
      J.hand_left = [J.neck[0] - bw * 0.14, by + bh * 0.50];
      J.hand_right = [J.neck[0] + bw * 0.14, by + bh * 0.50];
      warnings.push("arms_missing");
    } else {
      J.hand_left = leftHand ? [leftHand.x, leftHand.y] : [J.neck[0] - bw * 0.3, shoulderY + bh * 0.15];
      J.hand_right = rightHand ? [rightHand.x, rightHand.y] : [J.neck[0] + bw * 0.3, shoulderY + bh * 0.15];
    }
    J.elbow_left = mid(J.shoulder_left, J.hand_left);
    J.elbow_right = mid(J.shoulder_right, J.hand_right);

    // Legs: extreme bottom points on each side of the root column.
    // Guard against misattributing ink that isn't a leg at all: with no legs
    // drawn, the lowest ink in the bottom band is often just the arm tips
    // (if the arms droop) or the torso's own tail end (if it runs to the
    // bbox bottom) -- both would otherwise get mistaken for feet. Reject a
    // candidate that's really just the already-found hand, or that lands on
    // (near) the root column itself (torso tail, not a leg to either side).
    const legBand = [0.72, 1.0];
    let footL = null, footR = null;
    {
      const y0 = by + Math.floor(bh * legBand[0]);
      const rejectRadius = Math.max(bw, bh) * 0.11;
      const nearHand = (x, y) =>
        (leftHand && dist([x, y], [leftHand.x, leftHand.y]) < rejectRadius) ||
        (rightHand && dist([x, y], [rightHand.x, rightHand.y]) < rejectRadius);
      for (let y = y0; y < by + bh; y++) {
        for (let x = bx; x < bx + bw; x++) {
          if (!mask[y * w + x]) continue;
          if (nearHand(x, y)) continue;
          if (x <= J.root[0]) { if (!footL || y > footL.y || (y === footL.y && x < footL.x)) footL = { x, y }; }
          else { if (!footR || y > footR.y || (y === footR.y && x > footR.x)) footR = { x, y }; }
        }
      }
      // Both "feet" landing on (near) the root column means we found the
      // torso's own bottom, not two separate legs -- discard both.
      if (footL && footR && Math.abs(footL.x - J.root[0]) < bw * 0.03 && Math.abs(footR.x - J.root[0]) < bw * 0.03) {
        footL = null; footR = null;
      }
    }
    if (!footL && footR) footL = { x: 2 * J.root[0] - footR.x, y: footR.y };
    if (!footR && footL) footR = { x: 2 * J.root[0] - footL.x, y: footL.y };
    if (!footL) { footL = { x: J.root[0] - bw * 0.12, y: by + bh - 1 }; warnings.push("legs_missing"); }
    if (!footR) footR = { x: J.root[0] + bw * 0.12, y: by + bh - 1 };
    const hipDX = Math.max(bw * 0.05, 3);
    J.hip_left = [J.root[0] - hipDX, J.root[1] + bh * 0.03];
    J.hip_right = [J.root[0] + hipDX, J.root[1] + bh * 0.03];
    J.foot_left = [footL.x, footL.y];
    J.foot_right = [footR.x, footR.y];
    J.knee_left = mid(J.hip_left, J.foot_left);
    J.knee_right = mid(J.hip_right, J.foot_right);

    return { joints: J, warnings, armsMissing };
  }

  function mid(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }

  /* ---------------- traits ---------------- */

  function computeTraits(mask, w, bbox, joints, warnings, componentCount) {
    const headBand = bandCentroid(mask, w, bbox, 0, 0.28);
    const bodyBand = bandCentroid(mask, w, bbox, 0.28, 1.0);
    const headMass = headBand ? headBand.mass : 0;
    const bodyMass = bodyBand ? bodyBand.mass : 1;
    const legLen =
      (dist(joints.hip_left, joints.foot_left) + dist(joints.hip_right, joints.foot_right)) / 2;
    const traits = {
      large_head: headMass / Math.max(1, bodyMass) > 0.55,
      short_legs: legLen / bbox.h < 0.22,
      arms_missing: warnings.includes("arms_missing"),
      legs_missing: warnings.includes("legs_missing"),
      // Not a real classifier -- just "this doesn't geometrically resemble the
      // stick-figure assumption at all" (e.g. a doodle of a house, or a
      // scribble that fragmented into many unrelated blobs). Used only to
      // pick a funnier failure line (spec Phase 3), never to block rigging.
      not_humanoid: (componentCount || 1) > 5,
    };
    // toy personality, deliberately unscientific (spec §26)
    traits.personality =
      traits.not_humanoid ? "confused" :
      traits.large_head ? "dramatic" :
      traits.arms_missing ? "chaotic" :
      traits.short_legs ? "angry" : "cheerful";
    return traits;
  }

  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

  /* ---------------- mesh + skinning ---------------- */

  // Grid mesh over the (dilated) mask, vertices skinned to the 2 nearest bones.
  function buildMesh(mask, w, h, bbox, joints, opts) {
    const cells = (opts && opts.cells) || 18;
    const cell = Math.max(2, Math.ceil(Math.max(bbox.w, bbox.h) / cells));
    const gw = Math.ceil(bbox.w / cell), gh = Math.ceil(bbox.h / cell);

    const boneSegs = BONES.map(([name, a, b]) => ({ name, a: joints[a], b: joints[b] }));

    const keep = new Uint8Array(gw * gh);
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const x0 = bbox.x + gx * cell, y0 = bbox.y + gy * cell;
        const x1 = Math.min(bbox.x + bbox.w, x0 + cell), y1 = Math.min(bbox.y + bbox.h, y0 + cell);
        outer: for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            if (mask[y * w + x]) { keep[gy * gw + gx] = 1; break outer; }
          }
        }
      }
    }

    const vIndex = new Int32Array((gw + 1) * (gh + 1)).fill(-1);
    const vertices = [];
    const triangles = [];
    function vertexAt(gx, gy) {
      const key = gy * (gw + 1) + gx;
      if (vIndex[key] >= 0) return vIndex[key];
      const x = Math.min(bbox.x + bbox.w, bbox.x + gx * cell);
      const y = Math.min(bbox.y + bbox.h, bbox.y + gy * cell);
      const weights = skinWeights(x, y, boneSegs);
      const idx = vertices.length;
      vertices.push({ x, y, u: x, v: y, weights });
      vIndex[key] = idx;
      return idx;
    }
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        if (!keep[gy * gw + gx]) continue;
        const a = vertexAt(gx, gy), b = vertexAt(gx + 1, gy);
        const c = vertexAt(gx, gy + 1), d = vertexAt(gx + 1, gy + 1);
        triangles.push([a, b, c], [b, d, c]);
      }
    }
    return { vertices, triangles, bones: BONES.map(b => ({ name: b[0], a: b[1], b: b[2] })) };
  }

  function skinWeights(x, y, segs) {
    let best = [-1, Infinity], second = [-1, Infinity];
    for (let i = 0; i < segs.length; i++) {
      const d = pointSegDist(x, y, segs[i].a, segs[i].b);
      if (d < best[1]) { second = best; best = [i, d]; }
      else if (d < second[1]) second = [i, d];
    }
    const e = 1e-3;
    const w1 = 1 / ((best[1] + e) * (best[1] + e));
    const w2 = second[0] >= 0 ? 1 / ((second[1] + e) * (second[1] + e)) : 0;
    const s = w1 + w2;
    const out = [{ bone: best[0], w: w1 / s }];
    if (second[0] >= 0 && w2 / s > 0.02) out.push({ bone: second[0], w: w2 / s });
    // renormalize
    const total = out.reduce((a, o) => a + o.w, 0);
    out.forEach(o => (o.w /= total));
    return out;
  }

  function pointSegDist(px, py, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((px - a[0]) * dx + (py - a[1]) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
  }

  /* ---------------- top level ---------------- */

  // img: {width, height, data(Uint8ClampedArray RGBA)}
  // opts.componentMode: "merge" (default) uses assembleCreature (multi-blob
  // union); "largest" keeps the old single-biggest-blob behavior for
  // comparison/debugging.
  function extractCharacter(img, opts) {
    const { width: w, height: h } = img;
    const { mask: rawMask, threshold } = inkMask(img);
    const useMerge = !opts || opts.componentMode !== "largest";
    const comp = useMerge ? assembleCreature(rawMask, w, h) : largestComponent(rawMask, w, h);
    if (!comp || comp.size < 40) {
      return { ok: false, reason: "no_ink", confidence: 0, debug: { threshold, rawMask, width: w, height: h } };
    }
    const bbox = comp.bbox;
    const { joints, warnings, armsMissing } = estimateJoints(comp.mask, w, h, bbox);
    const componentCount = comp.componentCount || 1;
    const traits = computeTraits(comp.mask, w, bbox, joints, warnings, componentCount);

    // confidence: crude but honest — never used to hard-fail (spec §4/§28)
    let confidence = 0.9;
    if (armsMissing) confidence -= 0.2;
    if (traits.legs_missing) confidence -= 0.3;
    if (traits.not_humanoid) confidence -= 0.25;
    const density = comp.size / (bbox.w * bbox.h);
    if (density < 0.02 || density > 0.9) confidence -= 0.2;
    confidence = Math.max(0.05, confidence);

    const meshMask = dilate(comp.mask, w, h, Math.max(2, Math.round(Math.max(bbox.w, bbox.h) / 90)));
    const mesh = buildMesh(meshMask, w, h, bbox, joints, opts);

    return {
      ok: true,
      threshold,
      mask: comp.mask,      // exact ink pixels (for texture alpha)
      meshMask,             // dilated (keeps thin strokes connected)
      bbox,
      joints,
      warnings,
      traits,
      confidence,
      mesh,
      boneDefs: BONES,
      jointNames: JOINT_NAMES,
      debug: {
        threshold, rawMask, width: w, height: h,
        componentCount,
        includedComponents: comp.included || null,
        excludedComponents: comp.excluded || null,
      },
    };
  }

  return {
    extractCharacter, buildMesh, inkMask, dilate, JOINT_NAMES, BONES,
    largestComponent, assembleCreature, labelComponents,
    detectPaperQuad, warpQuadToRect, mulberry32,
    squareToQuadHomography, mapUnitSquareToQuad,
  };
});
