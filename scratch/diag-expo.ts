import { getStageDef } from "../src/game/track/stages";
import { TrackSpline } from "../src/game/track/TrackSpline";
const spline=new TrackSpline(getStageDef("salita-cosola"));
const all=spline.getAllSamples();
let flips=0,prev=all[0].exposure;
const dd:number[]=[];
for(const s of all){ if(s.exposure!==prev){flips++;prev=s.exposure;} dd.push(s.dropDepth??40); }
console.log("exposure flips along stage:",flips);
console.log("dropDepth min/max",Math.min(...dd),Math.max(...dd));
let ddJump=0; for(let i=1;i<dd.length;i++) ddJump=Math.max(ddJump,Math.abs(dd[i]-dd[i-1]));
console.log("max dropDepth jump between adjacent samples",ddJump);
const counts:Record<string,number>={}; for(const s of all) counts[s.exposure]=(counts[s.exposure]||0)+1;
console.log(counts);
let hwmin=Infinity,hwmax=0; for(const s of all){hwmin=Math.min(hwmin,s.halfWidth);hwmax=Math.max(hwmax,s.halfWidth);}
console.log("halfWidth",hwmin,hwmax);
