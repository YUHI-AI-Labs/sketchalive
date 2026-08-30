// Golden-path test: synthesize a stick figure raster -> run full pipeline -> assert sanity.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const core = require("./core.js");

function makeImage(w, h) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255); // white paper
  return { width: w, height: h, data };
}
function drawLine(img, x0, y0, x1, y1, thick = 4) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) * 2;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = x0 + (x1 - x0) * t, cy = y0 + (y1 - y0) * t;
    for (let dy = -thick; dy <= thick; dy++) {
      for (let dx = -thick; dx <= thick; dx++) {
        if (dx * dx + dy * dy > thick * thick) continue;
        const x = Math.round(cx + dx), y = Math.round(cy + dy);
        if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
        const p = (y * img.width + x) * 4;
        img.data[p] = img.data[p + 1] = img.data[p + 2] = 30; // dark ink
      }
    }
  }
}
function drawCircle(img, cx, cy, r, thick = 4) {
  for (let a = 0; a < Math.PI * 2; a += 0.02) {
    drawLine(img, cx + Math.cos(a) * r, cy + Math.sin(a) * r,
                  cx + Math.cos(a + 0.02) * r, cy + Math.sin(a + 0.02) * r, thick);
  }
}

// ---- stick figure: head circle, torso, two arms, two legs ----
const img = makeImage(400, 400);
drawCircle(img, 200, 90, 35);          // head
drawLine(img, 200, 125, 200, 240);     // torso
drawLine(img, 200, 160, 130, 210);     // left arm
drawLine(img, 200, 160, 270, 210);     // right arm
drawLine(img, 200, 240, 150, 340);     // left leg
drawLine(img, 200, 240, 250, 340);     // right leg

const t0 = Date.now();
const r = core.extractCharacter(img);
const ms = Date.now() - t0;

let failures = 0;
function assert(cond, label) {
  if (cond) console.log("  ok  " + label);
  else { console.log("  FAIL " + label); failures++; }
}

console.log("== SketchAlive core golden path ==");
assert(r.ok, "detection succeeds");
assert(r.confidence > 0.5, `confidence sane (${r.confidence.toFixed(2)})`);
assert(r.bbox.w > 100 && r.bbox.h > 200, `bbox covers figure (${JSON.stringify(r.bbox)})`);

const J = r.joints;
assert(Math.abs(J.head[0] - 200) < 30, `head x near 200 (${J.head[0].toFixed(0)})`);
assert(J.head[1] < J.neck[1] && J.neck[1] < J.root[1], "head above neck above root");
assert(J.hand_left[0] < J.root[0] && J.hand_right[0] > J.root[0], "hands on correct sides");
assert(J.foot_left[1] > 300 && J.foot_right[1] > 300, "feet near bottom");
assert(J.foot_left[0] < J.root[0] && J.foot_right[0] > J.root[0], "feet on correct sides");
assert(!r.traits.arms_missing && !r.traits.legs_missing, "no missing-limb flags");

assert(r.mesh.vertices.length > 20, `mesh has vertices (${r.mesh.vertices.length})`);
assert(r.mesh.triangles.length > 20, `mesh has triangles (${r.mesh.triangles.length})`);
const allWeighted = r.mesh.vertices.every(v => {
  const s = v.weights.reduce((a, o) => a + o.w, 0);
  return Math.abs(s - 1) < 1e-6 && v.weights.every(o => o.bone >= 0 && o.bone < 10);
});
assert(allWeighted, "all vertices skinned, weights sum to 1");
assert(ms < 1000, `pipeline fast enough on 400px image (${ms}ms)`);

// ---- easter egg cases must not crash ----
const noArms = makeImage(300, 300);
drawCircle(noArms, 150, 60, 25);
drawLine(noArms, 150, 85, 150, 180);
drawLine(noArms, 150, 180, 120, 260);
drawLine(noArms, 150, 180, 180, 260);
const r2 = core.extractCharacter(noArms);
assert(r2.ok && r2.traits.arms_missing, "armless figure -> ok + arms_missing trait");

const scribble = makeImage(300, 300);
const rng = core.mulberry32(12345); // fixed seed: deterministic test, not flaky
for (let i = 0; i < 30; i++) {
  drawLine(scribble, 50 + rng() * 200, 50 + rng() * 200,
                     50 + rng() * 200, 50 + rng() * 200, 2);
}
const r3 = core.extractCharacter(scribble);
assert(r3.ok, "ugly scribble still rigs (Nature has made a mistake)");

const blank = makeImage(200, 200);
const r4 = core.extractCharacter(blank);
assert(!r4.ok && r4.reason === "no_ink", "blank page fails gracefully");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
