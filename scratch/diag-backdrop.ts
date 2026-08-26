import { getStageDef } from "../src/game/track/stages";
import { TrackSpline } from "../src/game/track/TrackSpline";
const spline = new TrackSpline(getStageDef("salita-cosola"));
const all = spline.getAllSamples();
const routeStride=Math.max(1,Math.floor(all.length/220));
const route:any[]=[]; for(let i=0;i<all.length;i+=routeStride) route.push(all[i]);
let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity,floor=Infinity;
for(const s of route){minX=Math.min(minX,s.x);maxX=Math.max(maxX,s.x);minZ=Math.min(minZ,s.z);maxZ=Math.max(maxZ,s.z);floor=Math.min(floor,s.y);}
console.log("route bbox", (maxX-minX).toFixed(0),"x",(maxZ-minZ).toFixed(0),"floor",floor.toFixed(0),"routePts",route.length,"stride",routeStride);
const margin=1400; minX-=margin;maxX+=margin;minZ-=margin;maxZ+=margin;
const gridSize=72; const stepX=(maxX-minX)/(gridSize-1), stepZ=(maxZ-minZ)/(gridSize-1);
console.log("backdrop grid step",stepX.toFixed(0),"x",stepZ.toFixed(0),"m");
const nearestRoute=(wx:number,wz:number)=>{let best=Infinity,bestY=floor;for(const r of route){const dx=wx-r.x,dz=wz-r.z;const d2=dx*dx+dz*dz;if(d2<best){best=d2;bestY=r.y;}}return{dist:Math.sqrt(best),y:bestY};};
const RIDGE_START=260,RIDGE_FULL=1100,DROP=45;
const ys:number[]=[]; let inside=0;
for(let gz=0;gz<gridSize;gz++)for(let gx=0;gx<gridSize;gx++){
 const wx=minX+gx*stepX, wz=minZ+gz*stepZ; const nr=nearestRoute(wx,wz);
 const t=Math.max(0,Math.min(1,(nr.dist-RIDGE_START)/(RIDGE_FULL-RIDGE_START))); const blend=t*t*(3-2*t);
 const relief=Math.sin(wx*0.0022+0.8)*150+Math.cos(wz*0.0018+1.4)*130+Math.sin((wx+wz)*0.0042)*70+Math.cos((wx-wz)*0.0035)*45;
 ys.push(nr.y-DROP+blend*(170+relief*0.55));
 if(nr.dist<RIDGE_START) inside++;
}
// max neighbour height delta -> jaggedness
let maxd=0,cnt=0;
for(let gz=0;gz<gridSize;gz++)for(let gx=0;gx<gridSize-1;gx++){const d=Math.abs(ys[gz*gridSize+gx+1]-ys[gz*gridSize+gx]);if(d>maxd)maxd=d;if(d>150)cnt++;}
console.log("grid verts within RIDGE_START of route:",inside,"of",gridSize*gridSize);
console.log("max adjacent-vertex height jump",maxd.toFixed(0),"m ; cells jumping >150m:",cnt);
console.log("backdrop y range",Math.min(...ys).toFixed(0),Math.max(...ys).toFixed(0));
