import { getStageDef } from "../src/game/track/stages";
import { TrackSpline } from "../src/game/track/TrackSpline";
import { terrainHeightAt } from "../src/game/track/Terrain";

const spline = new TrackSpline(getStageDef("salita-cosola"));
const all = spline.getAllSamples();
console.log("samples", all.length, "length m", all[all.length-1].s.toFixed(0));
let ymin=Infinity,ymax=-Infinity;
for (const s of all){ if(s.y<ymin)ymin=s.y; if(s.y>ymax)ymax=s.y; }
console.log("road y range", ymin.toFixed(1), ymax.toFixed(1), "alt range", all[0].altitude, all[all.length-1].altitude);

// replicate corridor width computation
const TERRAIN_ROWS_TARGET=900, MAX_CORRIDOR=260, MIN_CORRIDOR=26, CORRIDOR_CLEARANCE=0.44, SELF_IGN=160;
const stride=Math.max(1,Math.ceil(all.length/TERRAIN_ROWS_TARGET));
const core=[] as any[]; for(let i=0;i<all.length;i+=stride) core.push(all[i]);
if(core[core.length-1]!==all[all.length-1]) core.push(all[all.length-1]);
const APRON_LENGTH=140,APRON_STEP=20;
const apron=(end:any,dir:number)=>{const out=[] as any[];const tx=Math.sin(end.heading)*dir,tz=Math.cos(end.heading)*dir;
for(let d=APRON_STEP;d<=APRON_LENGTH;d+=APRON_STEP) out.push({...end,x:end.x+tx*d,z:end.z+tz*d,exposure:"none",dropDepth:0});return out;};
const samples=[...apron(core[0],-1).reverse(),...core,...apron(core[core.length-1],1)];
const n=samples.length;
const ch=new Float32Array(n);
for(let i=0;i<n;i++){let nearest=Infinity;
 for(let k=0;k<n;k++){ if(Math.abs(samples[k].s-samples[i].s)<SELF_IGN) continue;
  const dx=samples[k].x-samples[i].x, dz=samples[k].z-samples[i].z; const d2=dx*dx+dz*dz; if(d2<nearest)nearest=d2;}
 const gap=nearest===Infinity?MAX_CORRIDOR*2:Math.sqrt(nearest);
 ch[i]=Math.max(MIN_CORRIDOR,Math.min(MAX_CORRIDOR,gap*CORRIDOR_CLEARANCE));}
const MAXD=2.5;
for(let i=1;i<n;i++) ch[i]=Math.min(ch[i],ch[i-1]+MAXD);
for(let i=n-2;i>=0;i--) ch[i]=Math.min(ch[i],ch[i+1]+MAXD);
const sm=new Float32Array(n); const R=10;
for(let i=0;i<n;i++){let s=0,c=0;for(let k=Math.max(0,i-R);k<=Math.min(n-1,i+R);k++){s+=ch[k];c++;}sm[i]=s/c;}
let wmin=Infinity,wmax=-Infinity,wsum=0; const hist:Record<string,number>={};
for(let i=0;i<n;i++){wmin=Math.min(wmin,sm[i]);wmax=Math.max(wmax,sm[i]);wsum+=sm[i];
 const b=Math.floor(sm[i]/25)*25; hist[b]=(hist[b]||0)+1;}
console.log("rows",n,"corridor half min/mean/max",wmin.toFixed(1),(wsum/n).toFixed(1),wmax.toFixed(1));
console.log("hist(25m bins)",JSON.stringify(hist));

// Row spacing along route
let dmin=Infinity,dmax=-Infinity;
for(let i=1;i<n;i++){const dx=samples[i].x-samples[i-1].x,dz=samples[i].z-samples[i-1].z;const d=Math.hypot(dx,dz);dmin=Math.min(dmin,d);dmax=Math.max(dmax,d);}
console.log("row spacing min/max", dmin.toFixed(1), dmax.toFixed(1));

// Outer-edge height vs road: how far does the corridor rim hang below/above
let dropMax=0, dropIdx=-1, riseMax=0;
const edgeYs:number[]=[];
for(let i=0;i<n;i++){const s=samples[i];
 for(const sgn of [-1,1]){
  const lat=sgn*(s.halfWidth+1.2+sm[i]);
  const y=terrainHeightAt(s,lat);
  edgeYs.push(y);
  const rel=y-s.y;
  if(rel<dropMax){} if(-rel>dropMax){dropMax=-rel;dropIdx=i;}
  if(rel>riseMax) riseMax=rel;
 }}
console.log("corridor rim: max drop below road",dropMax.toFixed(1),"m at row",dropIdx,"road y",samples[dropIdx]?.y.toFixed(1),"maxrise",riseMax.toFixed(1));

// Steepness of the rim quad: adjacent rows outer edge height delta vs horizontal delta
let steepCount=0, worst=0, worstI=-1;
for(let i=1;i<n;i++){
 for(const sgn of [-1,1]){
  const a=samples[i-1],b=samples[i];
  const la=sgn*(a.halfWidth+1.2+sm[i-1]), lb=sgn*(b.halfWidth+1.2+sm[i]);
  const ax=a.x+a.normalX*la, az=a.z+a.normalZ*la, ay=terrainHeightAt(a,la);
  const bx=b.x+b.normalX*lb, bz=b.z+b.normalZ*lb, by=terrainHeightAt(b,lb);
  const horiz=Math.hypot(bx-ax,bz-az), vert=Math.abs(by-ay);
  const slope=vert/Math.max(0.01,horiz);
  if(slope>2){steepCount++;}
  if(slope>worst){worst=slope;worstI=i;}
 }}
console.log("rim quads with slope>2 (near-vertical panels):",steepCount,"of",(n-1)*2,"worst slope",worst.toFixed(1),"at row",worstI);

// Vegetation: how far out are trees scattered vs corridor width at that station?
let outside=0,total=0,maxOver=0;
const smAt=(s:any)=>{ // nearest row
 let bi=0,bd=Infinity; for(let i=0;i<n;i++){const d=Math.abs(samples[i].s-s.s); if(d<bd){bd=d;bi=i;}} return sm[bi];};
for(let i=2;i<all.length-2;i+=3){
 const s=all[i]; const num=(i%5===0)?2:1;
 for(let k=0;k<num;k++){
  const hash=Math.sin(i*12.9898+k*78.233)*43758.5453; const rand=hash-Math.floor(hash);
  const dist=s.halfWidth+10+rand*140+k*12;
  total++;
  const w=s.halfWidth+1.2+smAt(s);
  if(dist>w){outside++; maxOver=Math.max(maxOver,dist-w);}
 }}
console.log("vegetation placements outside corridor mesh:",outside,"/",total,"max overhang m",maxOver.toFixed(1));
