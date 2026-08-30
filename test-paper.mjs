// Verifies the paper-quad homography math and paper detection heuristic
// added for the "real photo" phase. No camera/DOM needed -- synthetic quads.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const core = require("./core.js");

let failures = 0;
function assert(cond, label) {
  if (cond) console.log("  ok  " + label);
  else { console.log("  FAIL " + label); failures++; }
}
console.log("== paper quad homography + detection ==");

/* ---------- 1. homography round-trip: axis-aligned rectangle ---------- */
{
  const quad = [[10, 10], [110, 10], [110, 210], [10, 210]]; // TL,TR,BR,BL
  const warped = core.warpQuadToRect(makeCheckerboard(140, 240), quad, 50, 100);
  assert(warped.width === 50 && warped.height === 100, "warp produces requested output size");
  // corner pixels of the destination should sample from very near the quad's corners
  const topLeftPx = pixelAt(warped, 0, 0);
  assert(topLeftPx[3] > 0, "top-left destination pixel is inside the source (non-transparent)");
}

/* ---------- 2. homography round-trip: rotated + skewed quad ---------- */
{
  // A trapezoid: simulates a paper photographed at a shallow angle (far edge narrower).
  const quad = [[40, 20], [260, 20], [300, 220], [0, 220]];
  const src = makeCheckerboard(320, 240);
  const warped = core.warpQuadToRect(src, quad, 100, 100);
  let nonTransparent = 0;
  for (let i = 0; i < warped.width * warped.height; i++) if (warped.data[i * 4 + 3] > 0) nonTransparent++;
  assert(nonTransparent / (warped.width * warped.height) > 0.9, "trapezoid warp fills most of the output (no NaN holes)");
}

/* ---------- 3. paper detection on a synthetic "photo": light paper on a dark desk ---------- */
{
  const rng = core.mulberry32(42);
  const photo = makeDeskWithPaper(400, 300, { x: 60, y: 40, w: 260, h: 200 }, rng);
  const res = core.detectPaperQuad(photo);
  assert(res.found, `paper detected on high-contrast desk (confidence ${res.confidence.toFixed(2)})`);
  if (res.found) {
    const cx = res.corners.reduce((a, p) => a + p[0], 0) / 4;
    const cy = res.corners.reduce((a, p) => a + p[1], 0) / 4;
    assert(Math.abs(cx - 190) < 40 && Math.abs(cy - 140) < 40, `detected quad centered near paper center (${cx.toFixed(0)},${cy.toFixed(0)})`);
  }
}

/* ---------- 4. paper detection at a rotation ---------- */
{
  const rng = core.mulberry32(7);
  const photo = makeRotatedPaper(400, 300, 18 * Math.PI / 180, rng);
  const res = core.detectPaperQuad(photo);
  assert(res.found, `paper detected when rotated ~18deg (confidence ${res.confidence.toFixed(2)})`);
}

/* ---------- 5. low-contrast scene: should NOT falsely claim high confidence ---------- */
{
  const rng = core.mulberry32(3);
  const photo = makeUniformNoise(300, 300, rng); // no paper at all
  const res = core.detectPaperQuad(photo);
  assert(!res.found || res.confidence < 0.6, "uniform noise scene does not yield a confident paper detection");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);

/* ---------------- fixture builders ---------------- */

function makeImg(w, h, fill = 255) {
  const data = new Uint8ClampedArray(w * h * 4).fill(fill);
  for (let i = 0; i < w * h; i++) data[i * 4 + 3] = 255;
  return { width: w, height: h, data };
}
function pixelAt(img, x, y) {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}
function makeCheckerboard(w, h) {
  const img = makeImg(w, h, 255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const on = ((x >> 4) + (y >> 4)) % 2 === 0;
    const i = (y * w + x) * 4;
    const v = on ? 40 : 220;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
  }
  return img;
}
function makeDeskWithPaper(w, h, rect, rng) {
  const img = makeImg(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    // dark, slightly saturated "wood desk"
    img.data[i] = 90 + ((rng() * 20) | 0); img.data[i + 1] = 60 + ((rng() * 15) | 0); img.data[i + 2] = 35;
  }
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
    const i = (y * w + x) * 4;
    const v = 245 - ((rng() * 8) | 0);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
  }
  return img;
}
function makeRotatedPaper(w, h, angle, rng) {
  const img = makeImg(w, h);
  for (let i = 0; i < w * h; i++) {
    img.data[i * 4] = 90; img.data[i * 4 + 1] = 60; img.data[i * 4 + 2] = 35;
  }
  const cx = w / 2, cy = h / 2, pw = 180, ph = 240;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // rotate sample point back into paper-local space
    const lx = (x - cx) * cos + (y - cy) * sin;
    const ly = -(x - cx) * sin + (y - cy) * cos;
    if (Math.abs(lx) < pw / 2 && Math.abs(ly) < ph / 2) {
      const i = (y * w + x) * 4;
      const v = 245 - ((rng() * 8) | 0);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    }
  }
  return img;
}
function makeUniformNoise(w, h, rng) {
  const img = makeImg(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = 100 + ((rng() * 155) | 0);
    img.data[i * 4] = v; img.data[i * 4 + 1] = v * 0.6; img.data[i * 4 + 2] = v * 0.3;
  }
  return img;
}
