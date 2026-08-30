// Verify the FK / bone-matrix math used in index.html against core's golden joints.
// (Same equations, DOM-free copy — keep in sync with Character.solve/deform.)
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const core = require("./core.js");

const HIER = {
  neck:"root", head:"neck",
  shoulder_left:"neck", elbow_left:"shoulder_left", hand_left:"elbow_left",
  shoulder_right:"neck", elbow_right:"shoulder_right", hand_right:"elbow_right",
  hip_left:"root", knee_left:"hip_left", foot_left:"knee_left",
  hip_right:"root", knee_right:"hip_right", foot_right:"knee_right",
};
const ORDER = ["neck","head","shoulder_left","elbow_left","hand_left",
  "shoulder_right","elbow_right","hand_right","hip_left","knee_left","foot_left",
  "hip_right","knee_right","foot_right"];

function solve(J0, restOffset, pose){
  const P={}, A={};
  P.root=[J0.root[0]+(pose.rootDX||0), J0.root[1]+(pose.rootDY||0)];
  A.root=pose.root||0;
  for(const j of ORDER){
    const p=HIER[j], off=restOffset[j], a=A[p];
    const c=Math.cos(a), s=Math.sin(a);
    P[j]=[P[p][0]+off[0]*c-off[1]*s, P[p][1]+off[0]*s+off[1]*c];
    A[j]=a+(pose[j]||0);
  }
  return P;
}
const walk = t => { const p=t*7, sw=Math.sin(p);
  return { hip_left:sw*0.55, hip_right:-sw*0.55,
    knee_left:Math.max(0,Math.sin(p-1.4))*0.9, knee_right:Math.max(0,Math.sin(p+1.74))*0.9,
    shoulder_left:-sw*0.4, shoulder_right:sw*0.4,
    elbow_left:-0.25, elbow_right:0.25,
    rootDY:Math.abs(Math.cos(p))*-2.2, root:0.04 }; };

// golden stick figure via core
function makeImage(w,h){ return {width:w,height:h,data:new Uint8ClampedArray(w*h*4).fill(255)}; }
function line(img,x0,y0,x1,y1,th=4){
  const steps=Math.ceil(Math.hypot(x1-x0,y1-y0))*2;
  for(let i=0;i<=steps;i++){const t=i/steps,cx=x0+(x1-x0)*t,cy=y0+(y1-y0)*t;
    for(let dy=-th;dy<=th;dy++)for(let dx=-th;dx<=th;dx++){
      if(dx*dx+dy*dy>th*th)continue;
      const x=Math.round(cx+dx),y=Math.round(cy+dy);
      if(x<0||y<0||x>=img.width||y>=img.height)continue;
      const p=(y*img.width+x)*4; img.data[p]=img.data[p+1]=img.data[p+2]=30;}}}
const img=makeImage(400,400);
for(let a=0;a<Math.PI*2;a+=0.02) line(img,200+Math.cos(a)*35,90+Math.sin(a)*35,200+Math.cos(a+0.02)*35,90+Math.sin(a+0.02)*35);
line(img,200,125,200,240); line(img,200,160,130,210); line(img,200,160,270,210);
line(img,200,240,150,340); line(img,200,240,250,340);
const r=core.extractCharacter(img);
const J0=r.joints;
const restOffset={};
for(const [c,p] of Object.entries(HIER)) restOffset[c]=[J0[c][0]-J0[p][0], J0[c][1]-J0[p][1]];

let failures=0;
const assert=(c,l)=>{ if(c)console.log("  ok  "+l); else{console.log("  FAIL "+l);failures++;} };

console.log("== FK / walk cycle ==");
// rest pose reproduces rest joints
const rest=solve(J0,restOffset,{});
assert(Object.keys(rest).every(j=>Math.hypot(rest[j][0]-J0[j][0],rest[j][1]-J0[j][1])<1e-9),
  "zero pose reproduces rest joints exactly");

// walk over one cycle: finite, feet oscillate, bone lengths preserved
let minFL=1e9,maxFL=-1e9, allFinite=true, lenOK=true;
const bones=core.BONES;
const len0={}; bones.forEach(([n,a,b])=>len0[n]=Math.hypot(J0[a][0]-J0[b][0],J0[a][1]-J0[b][1]));
for(let t=0;t<1.0;t+=0.02){
  const P=solve(J0,restOffset,walk(t));
  for(const j in P){ if(!isFinite(P[j][0])||!isFinite(P[j][1])) allFinite=false; }
  minFL=Math.min(minFL,P.foot_left[0]); maxFL=Math.max(maxFL,P.foot_left[0]);
  for(const [n,a,b] of bones){
    const L=Math.hypot(P[a][0]-P[b][0],P[a][1]-P[b][1]);
    if(Math.abs(L-len0[n])>1e-6) lenOK=false;
  }
}
assert(allFinite,"all joints finite through walk cycle");
assert(maxFL-minFL>10,`left foot swings (${(maxFL-minFL).toFixed(1)}px)`);
assert(lenOK,"bone lengths preserved by FK (no stretching)");

// bone matrix (rest seg -> posed seg) maps endpoints exactly
const P=solve(J0,restOffset,walk(0.3));
let mapOK=true;
for(const [n,a,b] of bones){
  const a0=J0[a],b0=J0[b],a1=P[a],b1=P[b];
  const th=Math.atan2(b1[1]-a1[1],b1[0]-a1[0])-Math.atan2(b0[1]-a0[1],b0[0]-a0[0]);
  const c=Math.cos(th),s=Math.sin(th);
  const M=[c,-s,a1[0]-c*a0[0]+s*a0[1], s,c,a1[1]-s*a0[0]-c*a0[1]];
  const map=p=>[M[0]*p[0]+M[1]*p[1]+M[2], M[3]*p[0]+M[4]*p[1]+M[5]];
  const A=map(a0),B=map(b0);
  if(Math.hypot(A[0]-a1[0],A[1]-a1[1])>1e-6) mapOK=false;
  if(Math.hypot(B[0]-b1[0],B[1]-b1[1])>1e-6) mapOK=false;
}
assert(mapOK,"skinning matrices map bone endpoints exactly");

console.log(failures===0?"\nALL PASS":`\n${failures} FAILURES`);
process.exit(failures===0?0:1);
