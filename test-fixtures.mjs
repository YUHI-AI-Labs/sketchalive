// "Real-photo-like" synthetic fixtures (Phase 1 fixture list from the brief).
//
// IMPORTANT HONESTY NOTE: none of these are actual camera photos. They are
// programmatically synthesized approximations of real-world artifacts
// (shadow gradients, ruled lines, off-body joints, colored ink, background
// texture, multiple drawings, non-stick-figure doodles) built the same way
// test-core.mjs builds its golden path. They exercise the code paths that
// real photos would stress, but they cannot prove the thresholds
// (inkMask's Otsu clamp, assembleCreature's merge radius, detectPaperQuad's
// saturation cutoff) are correctly tuned for an actual iPhone/Android photo.
// That tuning pass against real photos is still the top item in HANDOFF.md.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const core = require("./core.js");

let failures = 0;
function assert(cond, label) {
  if (cond) console.log("  ok  " + label);
  else { console.log("  FAIL " + label); failures++; }
}
console.log("== real-photo-like fixtures (synthetic) ==");

function makeImage(w, h, rng) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let i = 0; i < w * h; i++) data[i * 4 + 3] = 255;
  return { width: w, height: h, data };
}
function drawLine(img, x0, y0, x1, y1, thick, rgb, rng) {
  const [r, g, b] = rgb || [30, 30, 30];
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) * 2;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const wob = rng ? (rng() - 0.5) * 2 : 0;
    const cx = x0 + (x1 - x0) * t + wob, cy = y0 + (y1 - y0) * t + wob;
    for (let dy = -thick; dy <= thick; dy++) for (let dx = -thick; dx <= thick; dx++) {
      if (dx * dx + dy * dy > thick * thick) continue;
      const x = Math.round(cx + dx), y = Math.round(cy + dy);
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      const p = (y * img.width + x) * 4;
      img.data[p] = r; img.data[p + 1] = g; img.data[p + 2] = b;
    }
  }
}
function drawCircle(img, cx, cy, r, thick, rgb, rng) {
  for (let a = 0; a < Math.PI * 2; a += 0.03) {
    drawLine(img, cx + Math.cos(a) * r, cy + Math.sin(a) * r,
      cx + Math.cos(a + 0.03) * r, cy + Math.sin(a + 0.03) * r, thick, rgb, rng);
  }
}
function stickFigure(img, cx, cy0, scale, opts) {
  opts = opts || {};
  const rgb = opts.rgb, rng = opts.rng, gapHead = opts.gapHead || 0;
  const s = scale;
  drawCircle(img, cx, cy0 + 30 * s - gapHead, 32 * s, 4, rgb, rng);
  drawLine(img, cx, cy0 + 60 * s, cx, cy0 + 170 * s, 4, rgb, rng);
  if (!opts.oneArm) drawLine(img, cx, cy0 + 80 * s, cx - 65 * s, cy0 + 130 * s, 4, rgb, rng);
  drawLine(img, cx, cy0 + 80 * s, cx + 65 * s, cy0 + 130 * s, 4, rgb, rng);
  drawLine(img, cx, cy0 + 170 * s, cx - 55 * s, cy0 + 260 * s, 4, rgb, rng);
  drawLine(img, cx, cy0 + 170 * s, cx + 55 * s, cy0 + 260 * s, 4, rgb, rng);
}

/* 1. blank paper + black pen (baseline sanity, high thick lines) */
{
  const rng = core.mulberry32(1);
  const img = makeImage(400, 400);
  stickFigure(img, 200, 30, 1, { rng });
  const r = core.extractCharacter(img);
  assert(r.ok && !r.traits.arms_missing, "plain black-pen figure extracts cleanly");
}

/* 2. angled/rotated figure (simulates off-angle phone shot before paper correction) */
{
  const rng = core.mulberry32(2);
  const w = 420, h = 420;
  const tmp = makeImage(w, h);
  stickFigure(tmp, 210, 30, 1, { rng });
  const angle = 12 * Math.PI / 180;
  const img = makeImage(w, h);
  const cx = w / 2, cy = h / 2, cos = Math.cos(angle), sin = Math.sin(angle);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.round(cx + (x - cx) * cos + (y - cy) * sin);
    const sy = Math.round(cy - (x - cx) * sin + (y - cy) * cos);
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
    const si = (sy * w + sx) * 4, di = (y * w + x) * 4;
    img.data[di] = tmp.data[si]; img.data[di + 1] = tmp.data[si + 1]; img.data[di + 2] = tmp.data[si + 2];
  }
  const r = core.extractCharacter(img);
  assert(r.ok, "12deg-rotated figure still extracts (ok=true)");
}

/* 3. shadow across half the page (linear darkening gradient) */
{
  const rng = core.mulberry32(3);
  const img = makeImage(400, 400);
  stickFigure(img, 200, 30, 1, { rng });
  for (let y = 0; y < 400; y++) for (let x = 0; x < 400; x++) {
    if (x < 160) { // shadow on the left third
      const i = (y * 400 + x) * 4;
      const shade = 0.55 + 0.35 * (x / 160);
      img.data[i] = img.data[i] * shade; img.data[i + 1] = img.data[i + 1] * shade; img.data[i + 2] = img.data[i + 2] * shade;
    }
  }
  const r = core.extractCharacter(img);
  assert(r.ok, "figure with a shadow gradient across the page still extracts");
}

/* 4. ruled notebook lines (faint, should not be read as ink) */
{
  const rng = core.mulberry32(4);
  const img = makeImage(400, 400);
  for (let y = 40; y < 400; y += 32) drawLine(img, 10, y, 390, y, 1, [220, 225, 235], null);
  stickFigure(img, 200, 30, 1, { rng });
  const r = core.extractCharacter(img);
  assert(r.ok && !r.traits.not_humanoid, "ruled-notebook background does not fragment the figure into >5 components");
}

/* 5. head detached from torso by a visible gap -- the HANDOFF #2 regression test */
{
  const rng = core.mulberry32(5);
  const img = makeImage(400, 400);
  stickFigure(img, 200, 30, 1, { rng, gapHead: 18 });
  const r = core.extractCharacter(img);
  assert(r.ok, "figure with head detached from body still extracts");
  if (r.ok) {
    assert(r.debug.componentCount >= 2, `head+body were separate components pre-merge (count=${r.debug.componentCount})`);
    assert(r.bbox.y < 60, `merged bbox still includes the detached head near the top (bbox.y=${r.bbox.y})`);
  }
}

/* 6. colored pen (blue ink, not near-black) */
{
  const rng = core.mulberry32(6);
  const img = makeImage(400, 400);
  stickFigure(img, 200, 30, 1, { rng, rgb: [30, 60, 210] });
  const r = core.extractCharacter(img);
  assert(r.ok && !r.traits.arms_missing, "blue-pen figure extracts via saturation rescue");
}

/* 7. strong background texture reaching the frame edges (simulated wood grain) */
{
  const rng = core.mulberry32(7);
  const img = makeImage(400, 400);
  for (let y = 0; y < 400; y++) for (let x = 0; x < 400; x++) {
    if (x < 20 || x > 380 || y < 20 || y > 380) { // grain only in a border strip around the "paper"
      const i = (y * 400 + x) * 4;
      const v = 150 + ((rng() * 60) | 0);
      img.data[i] = v; img.data[i + 1] = v * 0.75; img.data[i + 2] = v * 0.45;
    }
  }
  stickFigure(img, 200, 30, 1, { rng });
  const r = core.extractCharacter(img);
  assert(r.ok, "border wood-grain texture does not prevent extraction");
  assert(r.bbox.x > 15 && r.bbox.y > 15, "chosen figure bbox is not the border grain frame");
}

/* 8. two separate drawings on one page -- must not merge them into one creature */
{
  const rng = core.mulberry32(8);
  const img = makeImage(500, 400);
  stickFigure(img, 150, 20, 0.8, { rng });
  stickFigure(img, 400, 20, 0.8, { rng }); // far away, same size -- a second doodle
  const r = core.extractCharacter(img);
  assert(r.ok, "page with two separate doodles still extracts one creature without crashing");
  if (r.ok) assert(r.bbox.w < 300, `assembled bbox did not span both far-apart doodles (w=${r.bbox.w})`);
}

/* 9. non-stick-figure doodle (a blobby house shape, not a person) */
{
  const rng = core.mulberry32(9);
  const img = makeImage(400, 400);
  drawLine(img, 120, 250, 120, 380, 4, null, rng);
  drawLine(img, 280, 250, 280, 380, 4, null, rng);
  drawLine(img, 120, 380, 280, 380, 4, null, rng);
  drawLine(img, 120, 250, 200, 160, 4, null, rng);
  drawLine(img, 280, 250, 200, 160, 4, null, rng);
  drawLine(img, 180, 300, 180, 350, 3, null, rng);
  drawLine(img, 220, 300, 220, 350, 3, null, rng);
  const r = core.extractCharacter(img);
  assert(r.ok, "non-humanoid doodle (a house) still rigs without crashing (spec: never hard-fail)");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
