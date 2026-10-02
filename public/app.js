/* ---------- Ekuphumuleni ---------- */
const TARGET={lat:-29.07547,lon:27.62453,name:"Ekuphumuleni"};
const ENG=TSHKEngine;                       /* pure engine (engine.js) — no DOM in there */
/* Web policy constants (documented; not accuracy claims):
   a GPS fix worse than 25 m radius is "reduced precision" → approximate origin;
   level data older than 500 ms is stale; the device profile is measured, never assumed. */
const REDUCED_PRECISION_M=25, LEVEL_FRESH_MS=500;

/* ---------- State ---------- */
const S={loc:null,locName:"",bearing:null,distM:null,declination:null,declinationInfo:null,
 heading:null,headingState:null,dispDial:0,dispPtr:0,sensor:"off",src:null,mode:"compass",
 aligned:false,beta:0,gamma:0,level:null,levelAt:0,lastEvt:0,chip:null,sunWhy:null,
 settledSince:0,lastOrient:null,lastMotion:null,relReady:false,paused:false};
const $=id=>document.getElementById(id);

let LANG="zu";
function T(key,vars){let t=(LANGS[LANG]||{})[key]||"";if(vars)for(const k in vars)t=t.split("{"+k+"}").join(vars[k]);return t;}
function bi(en,second){return second?en+" · "+second:en;}
function detectLang(){
  try{const s=localStorage.getItem("tshk-lang");if(s&&LANGS[s])return s;}catch(e){}
  for(const l of (navigator.languages||[navigator.language||""])){const c=String(l).toLowerCase().split("-")[0];if(c==="pt")return "pt";if(c==="ny")return "ny";if(c==="bem")return "bem";if(c==="zu")return "zu";}
  return "zu";
}
function renderSunWhy(){
  const en=S.sunWhy==="rel"?"This phone senses turning but not north. Point the top of the phone at the sun and tap Set, or point it north with a hand compass and tap Set.":"This phone is not giving a compass direction, so the app can guide you from the position of the sun instead.";
  $("sun-why").textContent=bi(en,T(S.sunWhy==="rel"?"sunwhy_rel":"sunwhy_none"));
}
function applyLang(){
  document.documentElement.lang=LANG==="en"?"en":"en";
  for(const el of document.querySelectorAll("[data-t]")){const t=T(el.dataset.t);el.textContent=t?(el.dataset.pre||"")+t:"";el.hidden=!t;}
  $("lang").value=LANG;
  $("c-search").placeholder=bi("Search a centre or town",T("search_ph"));
  $("level-s").textContent=bi("Keep the phone flat for an accurate reading",T("level_s"));
  $("arrow-l").textContent=bi("◀ left",T("left"));$("arrow-r").textContent=bi("right",T("right"))+" ▶";
  if(S.chip)setChipCmp(...S.chip);else $("chip-cmp-t").textContent=bi("Compass: off",T("cmp_off"));
  if(S.heading==null){$("turn-zu").textContent=T("turn_wait");}
  if(S.sunWhy)renderSunWhy();
  $("btn-travel").textContent=bi(S.mode==="travel"?"Travel direction: on (GPS course while moving)":"Travel direction (walking or driving)",T("travel_btn"));
  $("travel-note").hidden=S.mode!=="travel";
  if(typeof renderReadouts==="function"){renderReadouts();render();renderSun();renderDiag();}
  if(typeof applySearch==="function"&&$("c-list").children.length)applySearch();
  if(typeof MEMBER!=="undefined")MEMBER.relang();
}


/* ---------- Dial face ---------- */
(function drawDial(){
  const svg=$("dialsvg");let s="";
  for(let d=0;d<360;d+=5){
    const major=d%90===0,mid=d%30===0;const r1=major?84:mid?87:91,r2=97;
    const a=d*Math.PI/180,x1=100+r1*Math.sin(a),y1=100-r1*Math.cos(a),x2=100+r2*Math.sin(a),y2=100-r2*Math.cos(a);
    s+=`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${major?'var(--tick-major)':'var(--tick)'}" stroke-width="${major?2.2:mid?1.6:1}" stroke-linecap="round"/>`;
  }
  const card=[["N",0,"var(--accent)"],["E",90,"var(--tick-major)"],["S",180,"var(--tick-major)"],["W",270,"var(--tick-major)"]];
  for(const [t,d,c] of card){const a=d*Math.PI/180,x=100+72*Math.sin(a),y=100-72*Math.cos(a);s+=`<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="middle" dominant-baseline="central" font-family="IBM Plex Sans,Arial,sans-serif" font-weight="600" font-size="13" fill="${c}">${t}</text>`;}
  for(const d of [30,60,120,150,210,240,300,330]){const a=d*Math.PI/180,x=100+72*Math.sin(a),y=100-72*Math.cos(a);s+=`<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="middle" dominant-baseline="central" font-family="IBM Plex Mono,monospace" font-size="8" fill="var(--tick)">${d}</text>`;}
  s+=`<g id="target-mark" transform="rotate(0 100 100)"><circle cx="100" cy="12" r="7" fill="var(--accent)"/><path d="M100 7.5 L101.5 10.8 L105 11.2 L102.4 13.5 L103.2 17 L100 15.2 L96.8 17 L97.6 13.5 L95 11.2 L98.5 10.8 Z" fill="#fff"/></g>`;
  svg.innerHTML=s;
})();

/* ---------- Location (E4: metadata kept; approximate origins marked) ---------- */
function setLocation(lat,lon,name,fix){
  S.loc=fix;S.locName=name||"";
  S.bearing=initialBearing(lat,lon,TARGET.lat,TARGET.lon);
  S.distM=haversineKm(lat,lon,TARGET.lat,TARGET.lon)*1000;
  const d=ENG.wmm.declinationAt(lat,lon,0,Date.now());
  S.declinationInfo=d;S.declination=d.declinationDeg;   // null = unavailable (polar blackout/expired)
  try{localStorage.setItem("tshk-loc",JSON.stringify({lat,lon,name,source:fix.source,approximate:fix.approximate}));}catch(e){}
  renderReadouts();render();renderSun();renderDiag();
}
function fmtCoord(lat,lon){return `${Math.abs(lat).toFixed(4)}° ${lat<0?"S":"N"}, ${Math.abs(lon).toFixed(4)}° ${lon<0?"W":"E"}`;}
function renderReadouts(){
  const chip=$("chip-loc");
  if(!S.loc){chip.className="chip";$("chip-loc-t").textContent=bi("Location: not set",T("loc_unset"));return;}
  const f=S.loc;
  const src=f.source==="gps"?`GPS${f.accuracyM?` ±${Math.round(f.accuracyM)} m`:""}`:f.source==="town"?bi("town",T("loc_town")):"typed";
  chip.className=f.reliable?"chip on":"chip warn";
  $("chip-loc-t").textContent=`Location: ${src}${f.approximate?" · "+bi("approximate",T("loc_approx_short")):""}`;
  $("ro-bearing").innerHTML=`${S.bearing.toFixed(1)}°`;
  $("ro-dist").innerHTML=S.distM<10000?`${(S.distM/1000).toFixed(2)} <small>km</small>`:`${Math.round(S.distM/1000).toLocaleString("en-ZA")} <small>km</small>`;
  if(S.declination==null)$("ro-mag").innerHTML=`—`;
  else $("ro-mag").innerHTML=`${norm(S.bearing-S.declination).toFixed(1)}°`;
  $("ro-dec").innerHTML=S.declination==null?bi("unavailable here",T("dec_na")):`${S.declination>=0?"+":"−"}${Math.abs(S.declination).toFixed(1)}° <small>${S.declination<0?"W":"E"}</small>`;
  $("ro-loc").textContent=`${S.locName?S.locName+" · ":""}${fmtCoord(S.loc.lat,S.loc.lon)}`;
  const tm=document.getElementById("target-mark");if(tm)tm.setAttribute("transform",`rotate(${S.bearing.toFixed(2)} 100 100)`);
}
function gpsFixFrom(p){
  const c=p.coords||{},acc=typeof c.accuracy==="number"?c.accuracy:null;
  return ENG.location.makeFix({lat:c.latitude,lon:c.longitude,accuracyM:acc,timestampMs:p.timestamp,
    speedMps:typeof c.speed==="number"&&c.speed>=0?c.speed:null,
    courseDeg:typeof c.heading==="number"&&c.heading>=0?c.heading:null,
    courseErrorDeg:typeof c.headingAccuracy==="number"&&c.headingAccuracy>0?c.headingAccuracy:null,
    source:"gps",approximate:acc==null||acc>REDUCED_PRECISION_M});
}
function requestGPS(){
  if(locked())return;
  if(!navigator.geolocation){$("gps-note").textContent="This browser has no location service. Choose a town or type coordinates.";return;}
  $("gps-note").textContent=bi("Finding your position…",T("gps_finding"));
  navigator.geolocation.getCurrentPosition(p=>{
    const f=gpsFixFrom(p);
    setLocation(f.lat,f.lon,"",f);
    $("gps-note").textContent=f.reliable?bi(`Position found (±${Math.round(f.accuracyM)} m).`,T("gps_found")):bi(`Position found, but only to about ±${Math.round(f.accuracyM||0)} m — alignment needs a better fix.`,T("loc_approx"));
    renderSun();
    startGpsWatch();
  },err=>{
    $("gps-note").textContent="Location was not available ("+(err.code===1?"permission refused":"no fix")+") Choose a town or type coordinates below.";
    if(!S.loc)setState(bi("Set your location",T("set_loc")),bi("Open the Location tab",T("open_loc_tab")));
  },{enableHighAccuracy:true,timeout:20000,maximumAge:0});
}
function startGpsWatch(){
  if(S.gpsWatch||!navigator.geolocation)return;
  S.gpsWatch=navigator.geolocation.watchPosition(w=>{
    const f=gpsFixFrom(w);
    // E4: only fresh, reduced-precision-aware fixes move the origin; coarse fixes are kept
    // but marked approximate, never silently treated as fresh GPS.
    if(ENG.location.fixFresh(f,Date.now())&&(!S.loc||!S.loc.reliable||f.reliable||f.accuracyM<(S.loc.accuracyM||Infinity))){
      setLocation(f.lat,f.lon,S.locName,f);
    }
    travelFix(f);
  },()=>{},{enableHighAccuracy:true,maximumAge:0});
}
function stopGpsWatch(){
  if(S.gpsWatch!=null&&navigator.geolocation){try{navigator.geolocation.clearWatch(S.gpsWatch);}catch(e){}}
  S.gpsWatch=null;
}

/* ---------- Sun position (NOAA low-precision algorithm, good to about 0.5°) ---------- */
function sunPosition(date,lat,lon){
  const d2r=Math.PI/180,r2d=180/Math.PI;
  const jd=date.getTime()/86400000+2440587.5,t=(jd-2451545)/36525;
  const L0=norm(280.46646+t*(36000.76983+t*0.0003032));
  const M=norm(357.52911+t*(35999.05029-0.0001537*t));
  const e=0.016708634-t*(0.000042037+0.0000001267*t);
  const C=Math.sin(M*d2r)*(1.914602-t*(0.004817+0.000014*t))+Math.sin(2*M*d2r)*(0.019993-0.000101*t)+Math.sin(3*M*d2r)*0.000289;
  const trueLon=L0+C,omega=125.04-1934.136*t,lam=trueLon-0.00569-0.00478*Math.sin(omega*d2r);
  const eps0=23+(26+((21.448-t*(46.815+t*(0.00059-t*0.001813))))/60)/60,eps=eps0+0.00256*Math.cos(omega*d2r);
  const decl=Math.asin(Math.sin(eps*d2r)*Math.sin(lam*d2r));
  const y=Math.tan(eps*d2r/2)**2;
  const eqt=4*r2d*(y*Math.sin(2*L0*d2r)-2*e*Math.sin(M*d2r)+4*e*y*Math.sin(M*d2r)*Math.cos(2*L0*d2r)-0.5*y*y*Math.sin(4*L0*d2r)-1.25*e*e*Math.sin(2*M*d2r));
  const minutes=date.getUTCHours()*60+date.getUTCMinutes()+date.getUTCSeconds()/60;
  const tst=(minutes+eqt+4*lon+1440)%1440;
  const ha=(tst/4<0?tst/4+180:tst/4-180)*d2r;
  const phi=lat*d2r;
  const cosZ=Math.sin(phi)*Math.sin(decl)+Math.cos(phi)*Math.cos(decl)*Math.cos(ha);
  const zen=Math.acos(Math.max(-1,Math.min(1,cosZ)));
  let az=Math.acos(Math.max(-1,Math.min(1,((Math.sin(phi)*Math.cos(zen))-Math.sin(decl))/(Math.cos(phi)*Math.sin(zen)))))*r2d;
  az=ha>0?norm(az+180):norm(540-az);
  return {az,alt:90-zen*r2d};
}
const compass16=a=>["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"][Math.round(norm(a)/22.5)%16];
/* E2: the sun "straight ahead" claim is gated on the uncertainty budget
   (deviation + heading uncertainty + the NOAA solar model's 0.5° ≤ 3°), never a bare 3°. */
const SUN_MODEL_UNCERTAINTY_DEG=0.5;
function sunAheadClaim(sunAz){
  const hs=S.headingState;if(!hs||S.mode==="travel")return false;
  const u=hs.uncertaintyDeg;
  if(u==null||u<=0||hs.confidence!=="reliable")return false;
  if(hs.issue!=="none"||S.paused)return false;
  return Math.abs(signedDiff(S.bearing,sunAz))+u+SUN_MODEL_UNCERTAINTY_DEG<=ENG.alignment.ALIGN.toleranceDeg;
}
function clockPlausible(){const y=new Date().getFullYear();return y>=2024&&y<=2031;} // device-clock sanity window
function renderSun(){
  const card=$("suncard");if(card.hidden||!S.loc)return;
  const sp=sunPosition(new Date(),S.loc.lat,S.loc.lon);
  $("sun-az").innerHTML=`${Math.round(sp.az)}° <small>${compass16(sp.az)}</small>`;
  $("sun-alt").innerHTML=`${Math.round(sp.alt)}°`;
  $("sun-safe").textContent=bi("Never look directly at the sun.",T("sun_never"));
  if(!clockPlausible()){$("sun-turn").textContent=bi("Check your device clock: the date looks wrong, so the sun position cannot be trusted.",T("clock_warn"));$("sun-shadow").textContent="—";$("btn-suncal").hidden=true;return;}
  if(sp.alt<-1){$("sun-turn").textContent=bi("The sun is below the horizon now. Use a hand compass with the magnetic bearing, or try again in daylight.",T("sun_night"));$("sun-shadow").textContent="—";$("btn-suncal").hidden=true;return;}
  const d=signedDiff(S.bearing,sp.az),abs=Math.round(Math.abs(d)),dir=d>0?"right":"left",dirZu=T(d>0?"right":"left");
  $("sun-turn").textContent=sunAheadClaim(sp.az)?bi("Face the sun: Ekuphumuleni is straight ahead.",T("sun_ahead")):bi(`Face the sun, then turn ${abs}° to the ${dir}.`,T("sun_turn",{n:abs,dir:dirZu}));
  const sh=norm(sp.az+180),ds=signedDiff(S.bearing,sh),abs2=Math.round(Math.abs(ds)),dir2=ds>0?"right":"left";
  $("sun-shadow").textContent=bi(`A stick's shadow points to ${Math.round(sh)}° (${compass16(sh)}). Point the TOP EDGE of the phone opposite the shadow, then turn ${abs2}° to the ${dir2}.`,T("sun_shadow_i",{sh:Math.round(sh),n:abs2,dir:T(dir2)}));
  // G8: sun calibration needs the sun 5°–<80° up and a flat, still phone
  const elevOk=sp.alt>=5&&sp.alt<80,flat=Math.abs(S.beta)<8&&Math.abs(S.gamma)<8&&Date.now()-S.levelAt<LEVEL_FRESH_MS*4;
  $("btn-suncal").hidden=!(S.sensor==="rel"&&elevOk&&flat&&clockPlausible());
}
setInterval(()=>{if(!document.hidden)renderSun();},30000);

/* ---------- Compass engine wiring ----------
   Sources, best first: 1 iPhone webkitCompassHeading  2 Android AbsoluteOrientationSensor
   3 absolute deviceorientation  4 relative orientation (quaternion tracker) + sun/north
   calibration  5 (travel mode only) GPS course while moving  6 no sensor: sun guidance +
   hand-compass bearing.
   Every accepted sample becomes a heading state {value, northReference, timestamp,
   confidence, issue, uncertaintyDeg}; the north reference is explicit per source:
     ios  = magnetic (Apple webkitCompassHeading, +screenAngle() compensates the interface
            rotation; verify per iOS version — some versions may already compensate)
     aos  = magnetic (AbsoluteOrientationSensor on Android is TYPE_ROTATION_VECTOR,
            magnetometer-fused and magnetic-north referenced — NOT true north)
     abs  = magnetic (deviceorientationabsolute alpha is vs the geomagnetic field)
     rel  = whatever the anchor was: 'trueNorth' for a sun anchor, 'magnetic' for a
            hand-compass anchor
     travel (GPS course) = trueNorth but travel direction only — it never drives the dial
            or confirms alignment.
   Declination is added exactly once (engine.toTrue) and only to magnetic samples. */
function screenAngle(){return (screen.orientation&&typeof screen.orientation.angle==="number")?screen.orientation.angle:(typeof window.orientation==="number"?window.orientation:0);}
const SRC={ios:"iPhone compass",aos:"Android compass",abs:"compass",rel:"turn sensor + calibration",gps:"GPS course (travel)"};
const REFNAME={magnetic:"magnetic north",trueNorth:"true north",relative:"relative"};
const smoother=ENG.smoothing.createSmoother();
const relTracker=ENG.rel.createRelTracker();
const ladder=ENG.ladder.createLadder(["ios","aos","abs","rel"]);
const wmmCache=ENG.wmm.createWmmCache((lat,lon,altKm,nowMs)=>ENG.wmm.declinationAt(lat,lon,altKm*1000,nowMs));
let S2={gen:0,started:false,timers:[],aos:null,relSensor:null,mag:null,gyroInt:null,loopOn:false,lastRepaint:0,lastText:0,lastRound:null,profile:{class:"unknown",repaintMs:33,sampleHz:30,probeMs:30000,measured:false},frames:[],field:{measuredF:null},settleAt:0};

function resetSmoothing(reason){smoother.reset();S.settledAt=Date.now();S.aligned=false;}
function pushHeading(value,northRef,timestamp,osAccuracyDeg,source){
  const now=performance.now();
  const trueV=ENG.toTrue(value,northRef,S.declination);
  if(trueV==null){setChipCmp("warn","Compass: declination unavailable here","cmp_model");return;} // never zero
  const q=ENG.quality.assessQuality({sample:{value,timestamp},osAccuracyDeg,
    measuredFieldF:S2.field.measuredF,modelFieldF:S.declinationInfo?S.declinationInfo.f:null,
    modelState:S.declinationInfo?S.declinationInfo.modelState:null,nowMs:now});
  ladder.noteSample(source,Date.now(),{goodQuality:q.issue!=="magneticInterference",provisional:source==="rel"&&!relTracker.hasAnchor()});
  const cur=ladder.current(Date.now());
  if(cur&&cur!==source)return;   // C1: capability ladder arbitration — no ad-hoc gates
  if(S.src!==source||S.northRef!==northRef||S.qualityKey!==q.issue){resetSmoothing("transition");S.src=source;S.northRef=northRef;S.qualityKey=q.issue;}
  const disp=smoother.feed(trueV,now);
  S.heading=disp;
  S.headingState={value:trueV,northReference:northRef,timestamp,confidence:q.confidence,issue:q.issue,uncertaintyDeg:q.uncertaintyDeg,source};
  S.lastEvt=Date.now();
  S.paused=false;
  if(S.sensor!=="on"||S.chipSrc!==source){
    S.sensor="on";S.chipSrc=source;
    setChipCmp("on",`Compass: on · ${SRC[source]} · ${REFNAME[northRef]}`,"cmp_on");
    $("nocompass").hidden=true;if(source!=="rel")$("suncard").hidden=true;
  }
  if(S.chipIssue!==q.issue){S.chipIssue=q.issue;
    if(q.issue==="accuracyUnknown")setChipCmp("warn",`Compass: running · ${SRC[source]} · accuracy unknown`,"cmp_accunk");
    else if(q.issue==="magneticInterference")setChipCmp("bad","Compass: magnetic interference","cmp_interf");
    else if(q.issue==="calibrationRequired")setChipCmp("warn","Compass: needs calibration","cmp_cal");
    else if(q.issue==="modelExpired")setChipCmp("warn","Compass: magnetic model expired","cmp_model");
  }
  startLoop();
}
function onOrientation(e){
  const now=performance.now();
  const r=ENG.samples.orientationSample(e,S.lastOrient,now);
  if(!r.ok){renderDiag.throttled&&renderDiag.throttled();return;}
  S.lastOrient={timestamp:r.timestamp};
  if(typeof e.beta==="number"&&isFinite(e.beta)){S.beta=e.beta;S.gamma=e.gamma||0;S.levelAt=Date.now();} // tilt fallback for the level bubble
  if(typeof e.webkitCompassHeading==="number"){
    pushHeading(norm(r.value+screenAngle()),ENG.ref.MAGNETIC,r.timestamp,r.osAccuracyDeg,"ios");return;
  }
  if(r.kind==="absolute"){pushHeading(r.value,ENG.ref.MAGNETIC,r.timestamp,null,"abs");return;}
  // relative deviceorientation only proves the phone can sense turning (calibration UI)
  S.sawRel=true;
}
/* G1: full 3D quaternion integration for relative tracking (never flat gyro.z).
   Preferred source: RelativeOrientationSensor (OS-fused); fallback: integrating
   DeviceMotionEvent.rotationRate into a quaternion ourselves. */
function onMotion(e){
  const now=performance.now();
  const rr=e.rotationRate;
  if(!rr||!isFinite(rr.alpha||0)&&!isFinite(rr.beta||0)&&!isFinite(rr.gamma||0))return;
  if(S.relSensorLive)return; // RelativeOrientationSensor is better; don't double-integrate
  const dt=S.lastMotion?Math.min(ENG.rel.REL.maxStepSeconds,Math.max(.001,(now-S.lastMotion)/1000)):0.016;
  S.lastMotion=now;
  const d2r=Math.PI/180;
  // rotationRate is deg/s in the device frame: (alpha≈z, beta≈x, gamma≈y)
  const step=ENG.heading.quat.fromRates((rr.beta||0)*d2r,(rr.gamma||0)*d2r,(rr.alpha||0)*d2r,dt);
  S.gyroQ=S.gyroQ?ENG.heading.quat.mul(S.gyroQ,step):step;
  relPush(S.gyroQ,now);
  if(e.accelerationIncludingGravity)levelFromMotion(e.accelerationIncludingGravity);
}
function levelFromMotion(a){
  const g=9.80665,x=typeof a.x==="number"?a.x:0,y=typeof a.y==="number"?a.y:0;
  S.level={gx:Math.max(-1,Math.min(1,x/g)),gy:Math.max(-1,Math.min(1,y/g))};
  S.levelAt=Date.now();
}
function relPush(q,t){
  const r=relTracker.push(q,t);
  if(r.anchorLost){$("btn-northcal").hidden=false;}
  const s=relTracker.sample(t);
  if(s.ok){
    S.relReady=true;
    pushHeading(s.value,s.northReference,s.timestamp,null,"rel");
    if(S.sensor!=="on"){S.sensor="on";}
    $("btn-northcal").hidden=false;$("btn-suncal").hidden=false;
  }else if(s.reason==="noAnchor"||s.reason==="anchorExpired"||s.reason==="integrationGap"){
    S.relReady=true;                                     // the quaternion stream is alive
    $("btn-northcal").hidden=false;
    if(S.sensor!=="on"){S.sensor="rel";S.sunWhy="rel";setChipCmp("warn","Compass: needs calibration","cmp_cal");showNoCompass();}
  }
  startLoop();
}
function startRelativeSensor(){
  const gen=S2.gen;
  if("RelativeOrientationSensor" in window){
    try{
      const s=new RelativeOrientationSensor({frequency:S2.profile.sampleHz,referenceFrame:"device"});
      s.addEventListener("reading",()=>{if(S2.gen!==gen||!s.quaternion)return;S.relSensorLive=true;relPush([s.quaternion[0],s.quaternion[1],s.quaternion[2],s.quaternion[3]],performance.now());});
      s.addEventListener("error",(e)=>{S.relSensorLive=false;ladder.noteError("rel",ENG.ladder.classifySensorError(e.error||e),Date.now());});
      s.start();S2.relSensor=s;
      return;
    }catch(e){ladder.noteError("rel",ENG.ladder.classifySensorError(e),Date.now());}
  }
  // fallback: integrate rotationRate (devicemotion); the motion permission was already
  // requested in the start gesture alongside the orientation one (G4)
  if(typeof DeviceMotionEvent!=="undefined")window.addEventListener("devicemotion",onMotion,true);
}
function startAbsoluteSensor(){
  if(!("AbsoluteOrientationSensor" in window))return;
  const gen=S2.gen;
  try{
    if(!S2.aos){
      const sensor=new AbsoluteOrientationSensor({frequency:S2.profile.sampleHz,referenceFrame:"screen"});
      sensor.addEventListener("reading",()=>{if(S2.gen!==gen||!sensor.quaternion)return;
        pushHeading(ENG.heading.headingFromQuat(sensor.quaternion),ENG.ref.MAGNETIC,performance.now(),null,"aos");});
      sensor.addEventListener("error",(e)=>{ // C2: never swallow — demote with a distinct cause
        const kind=ENG.ladder.classifySensorError(e.error||e);
        ladder.noteError("aos",kind,Date.now());
        S.chipError=kind;setChipCmp("bad",kind==="notAllowed"?"Compass: permission refused":"Compass: sensor not readable","cmp_none");
      });
      S2.aos=sensor;
    }
    S2.aos.start();
  }catch(e){ladder.noteError("aos",ENG.ladder.classifySensorError(e),Date.now());}
}

/* ---------- Travel direction (C5/C6): a separate, explicitly user-selected mode ---------- */
let travelHist=[];
function travelFix(f){
  if(S.mode!=="travel")return;
  const r=ENG.travel.acceptTravelFix(f,travelHist,Date.now());
  if(r.ok&&r.accepted){travelHist.push(r.accepted);if(travelHist.length>8)travelHist.shift();}
  if(!r.usable)return;
  // travel course is TRUE (geodetic) and only ever a travel heading — rotating the phone
  // cannot change it, and it can never confirm prayer/msamo/sun alignment.
  S.heading=norm(r.accepted.course);
  S.headingState={value:S.heading,northReference:ENG.ref.TRUE,timestamp:performance.now(),
    confidence:r.confidence,issue:r.uncertaintyDeg==null?ENG.quality.HeadingIssue.ACCURACY_UNKNOWN:ENG.quality.HeadingIssue.NONE,
    uncertaintyDeg:r.uncertaintyDeg,source:"gps",travel:true};
  S.sensor="on";S.src="gps";S.lastEvt=Date.now();
  setChipCmp("on","Travel direction · GPS course (not the phone's facing)","cmp_travel");
  startLoop();
}
function setTravelMode(on){
  S.mode=on?"travel":"compass";
  if(on){travelHist=[];resetSmoothing("travel");setChipCmp("on","Travel direction · GPS course (not the phone's facing)","cmp_travel");}
  else{resetSmoothing("travel");setChipCmp("warn","Compass: waiting for sensor…","cmp_wait");}
  $("travel-note").hidden=!on;
  $("btn-travel").textContent=bi(on?"Travel direction: on (GPS course while moving)":"Travel direction (walking or driving)",T("travel_btn"));
  render();
}

/* ---------- Session lifecycle (D4/G3): nothing runs hidden; generations fence callbacks ---------- */
function locked(){return window.TSHK_LOCKED===true;}
function setChipCmp(cls,t,key){S.chip=[cls,t,key];$("chip-cmp").className="chip "+cls;$("chip-cmp-t").textContent=bi(t,key?T(key):"");}
function showNoCompass(){$("nocompass").hidden=false;$("suncard").hidden=false;renderSunWhy();renderSun();render();}
function clearTimers(){for(const t of S2.timers)clearInterval(t);S2.timers=[];}
function stopSession(){
  S2.gen+=1;                                  // old callbacks can never touch new state
  clearTimers();
  if(S2.aos){try{S2.aos.stop();}catch(e){}}
  if(S2.relSensor){try{S2.relSensor.stop();}catch(e){}S2.relSensor=null;}
  S.relSensorLive=false;
  window.removeEventListener("devicemotion",onMotion,true);
  window.removeEventListener("deviceorientation",onOrientation,true);
  window.removeEventListener("deviceorientationabsolute",onOrientation,true);
  stopGpsWatch();
  if(wakeLock){try{wakeLock.release();}catch(e){}wakeLock=null;}
  S2.loopOn=false;
}
function startSensors(){
  if(locked())return;
  if(!window.isSecureContext){S.sensor="insecure";S.sunWhy="none";setChipCmp("bad","Compass and location need HTTPS","cmp_insecure");showNoCompass();return;}
  if(S2.started)return;S2.started=true;S2.startedAt=Date.now();
  const gen=S2.gen;
  const listen=()=>{
    if(typeof DeviceOrientationEvent!=="undefined"&&"ondeviceorientationabsolute" in window)window.addEventListener("deviceorientationabsolute",onOrientation,true);
    window.addEventListener("deviceorientation",onOrientation,true);
    startAbsoluteSensor();
    startRelativeSensor();
    setChipCmp("warn","Compass: waiting for sensor…","cmp_wait");
    S2.timers.push(setInterval(()=>tick(gen),1000));
    S2.timers.push(setInterval(()=>renderDiag(),5000));
  };
  // G4/C3: iOS permission must be asked from a real user gesture — and bounded, so the
  // ladder can never hang on a promise that never settles. Once granted, resumes do not
  // re-prompt (there may be no gesture on resume).
  const ask=(api)=>api&&typeof api.requestPermission==="function"?Promise.race([api.requestPermission(),new Promise((res)=>setTimeout(res,ENG.ladder.LADDER.acquireMs))]):Promise.resolve("granted");
  if(S2.permGranted){listen();return;}
  if(typeof DeviceOrientationEvent!=="undefined"&&typeof DeviceOrientationEvent.requestPermission==="function"){
    Promise.all([ask(DeviceOrientationEvent),typeof DeviceMotionEvent!=="undefined"?ask(DeviceMotionEvent):Promise.resolve("granted")])
      .then(([r])=>{if(S2.gen!==gen)return;if(r==="granted"){S2.permGranted=true;listen();}else{S.sensor="denied";S.sunWhy="none";setChipCmp("bad","Compass: permission refused","cmp_denied");showNoCompass();}})
      .catch(()=>{if(S2.gen!==gen)return;S.sensor="denied";S.sunWhy="none";setChipCmp("bad","Compass: permission refused · reload the page and allow motion access","cmp_denied");showNoCompass();});
  }else listen();
  keepAwake();
}
function tick(gen){
  if(gen!==S2.gen)return;
  const now=Date.now();
  // acquire timeout (3 s): decide between "needs calibration" and "not available"
  if(S.sensor!=="on"&&S.sensor!=="rel"&&S.sensor!=="none"&&S.sensor!=="denied"&&now-S2.startedAt>ENG.ladder.LADDER.acquireMs){
    const cur=ladder.current(now),any=ladder.entries().some(e=>e.lastSampleAt);
    if(!cur&&S.relReady){S.sensor="rel";S.sunWhy="rel";setChipCmp("warn","Compass: needs calibration","cmp_cal");$("btn-northcal").hidden=false;showNoCompass();}
    else if(!cur&&!any){S.sensor="none";S.sunWhy="none";setChipCmp("bad","Compass: not available","cmp_none");showNoCompass();}
  }
  if(S.sensor==="on"&&now-S.lastEvt>ENG.ladder.LADDER.staleMs){
    S.sensor="paused";S.src=null;S.paused=true;
    setChipCmp("warn","Compass: paused · move the phone","cmp_paused");
    resetSmoothing("stale");
    const probe=ladder.nextProbe(now,S2.profile.class==="low");
    if(probe==="aos")startAbsoluteSensor();
    if(probe==="rel"&&!S.relSensorLive)startRelativeSensor();
  }
  renderDiag();
  renderSun();
}
function startLoop(){
  if(S2.loopOn)return;S2.loopOn=true;requestAnimationFrame(frame);
}
function frame(){
  const perf=performance.now();
  if(!S2.loopOn)return;
  if(document.hidden||locked()){S2.loopOn=false;return;}
  // D3: measure real frame times before claiming any device class
  if(S2.frameLast&&S2.frames.length<40)S2.frames.push(perf-S2.frameLast);
  S2.frameLast=perf;
  if(!S2.profile.measured&&S2.frames.length>=20){
    S2.profile=ENG.profile.estimateDeviceProfile({deviceMemory:navigator.deviceMemory,hardwareConcurrency:navigator.hardwareConcurrency,frameTimeSamples:S2.frames});
    renderDiag();
  }
  const active=S.sensor==="on"||S.sensor==="rel";
  const animating=Math.abs(ENG.angle.signedDiff(-S.heading||0,S.dispDial))>.05||Date.now()-S.lastEvt<3000;
  if(active&&S.heading!=null&&perf-S2.lastRepaint>=S2.profile.repaintMs){S2.lastRepaint=perf;drawNeedle();drawBubble();}
  const rd=S.heading==null?null:Math.round(S.heading);
  if(rd!==S2.lastRound&&perf-S2.lastText>90){S2.lastRound=rd;S2.lastText=perf;render();}
  if(active&&animating)requestAnimationFrame(frame);else{drawBubble();S2.loopOn=false;}   // stop when nothing runs
}
function drawNeedle(){
  if(S.heading==null)return;
  const d1=ENG.angle.signedDiff(-S.heading,S.dispDial);if(Math.abs(d1)>.05){S.dispDial+=d1;$("dial").style.transform=`rotate(${S.dispDial.toFixed(2)}deg)`;}
  // H2/E3: the target needle only exists with a reliable fix, outside the near-target zone
  const radius=S.loc?ENG.location.errorRadiusNow(S.loc,Date.now()):null;
  const near=S.loc&&S.distM!=null&&S.distM<=ENG.alignment.nearTargetRadiusM(radius);
  const showPtr=S.loc&&S.loc.reliable&&!S.loc.approximate&&!near&&S.mode!=="travel";
  $("pointer").style.opacity=showPtr?"1":"0";
  if(showPtr){const d2=ENG.angle.signedDiff(norm(S.bearing-S.heading),S.dispPtr);if(Math.abs(d2)>.05){S.dispPtr+=d2;$("pointer").style.transform=`rotate(${S.dispPtr.toFixed(2)}deg)`;}}
  else{$("pointer").style.transform="rotate(0deg)";}
}
function drawBubble(){
  // G7: the level bubble is drawn only from FRESH level data — never an invented level phone
  const fresh=Date.now()-S.levelAt<LEVEL_FRESH_MS;
  const box=$("bubble-box");
  if(!fresh||!S.level){box.hidden=true;return;}
  box.hidden=false;
  $("bubble").style.transform=`translate(calc(-50% + ${(S.level.gx*22).toFixed(1)}px), calc(-50% + ${(S.level.gy*22).toFixed(1)}px))`;
}

/* ---------- Alignment + rendering (E1/E2/E3) ---------- */
function headingAgeMs(){const hs=S.headingState;return hs?performance.now()-hs.timestamp:Infinity;}
function alignmentState(deviationDeg,targetBearingUncertaintyDeg,near){
  const hs=S.headingState||{};
  return {headingTrueDeg:S.heading,headingUncertaintyDeg:hs.uncertaintyDeg,confidence:hs.confidence,
    headingAgeMs:headingAgeMs(),settledMs:Date.now()-S.settledAt,
    location:{reliable:!!(S.loc&&S.loc.reliable),approximate:!!(S.loc&&S.loc.approximate),
      ageMs:S.loc&&S.loc.timestampMs!=null?Date.now()-S.loc.timestampMs:Infinity,futureMs:0},
    targets:[{present:S.loc!=null&&S.bearing!=null,nearTarget:!!near,deviationDeg,bearingUncertaintyDeg:targetBearingUncertaintyDeg}],
    isTravelDirection:S.mode==="travel",isRelativeTracking:S.src==="rel",
    paused:S.sensor==="paused",stale:hs.issue==="stale"};
}
function setState(main,sub){$("state-main").textContent=main;$("state-sub").textContent=sub;}
function render(){
  const wrap=$("dialwrap"),st=$("state"),turn=$("turnbox");
  $("hub-deg").textContent=S.heading==null||S.sensor!=="on"?"—":`${Math.round(S.heading)}°`;
  const live=S.heading!=null&&S.sensor==="on";
  if(live)drawNeedle();
  if(S.mode==="travel"&&live){
    wrap.classList.remove("aligned");st.classList.remove("aligned");turn.classList.remove("aligned");
    setState(bi("Travel direction",T("travel_title")),bi("Moving: your course over the ground — not the phone's facing.",T("travel_moving")));
    $("turn-num").innerHTML=`${Math.round(S.heading)}<small>°</small>`;
    $("turn-say").textContent=bi("Travel direction cannot confirm prayer or msamo alignment.",T("travel_not"));
    $("turn-zu").textContent=T("travel_not");
    drawBubble();return;
  }
  const radius=S.loc?ENG.location.errorRadiusNow(S.loc,Date.now()):null;
  const near=S.loc&&S.distM!=null&&S.distM<=ENG.alignment.nearTargetRadiusM(radius);
  const tu=S.loc&&S.distM?ENG.alignment.bearingUncertaintyDeg(radius,S.distM):null;
  if(S.loc&&live&&S.loc.reliable&&!S.loc.approximate){
    const delta=ENG.angle.signedDiff(S.bearing,S.heading),abs=Math.abs(delta);
    const r=ENG.alignment.alignmentConfirms(alignmentState(delta,tu,near));
    if(near){
      wrap.classList.remove("aligned");st.classList.remove("aligned");turn.classList.remove("aligned");S.aligned=false;
      setState(bi("You are at the destination area",T("near_title")),bi("Direction is not shown within "+Math.round(ENG.alignment.nearTargetRadiusM(radius))+" m of Ekuphumuleni.",T("near_target")));
      $("turn-num").innerHTML="—";$("turn-say").textContent=bi("Standing at the destination: direction is undefined here.",T("near_target"));
      $("turn-zu").textContent=T("near_target");
    }else if(r.ok){
      // E1 passed — the ONLY surface that says "aligned", inside the 3° uncertainty budget
      if(!S.aligned){try{navigator.vibrate&&navigator.vibrate(60);}catch(e){}}
      S.aligned=true;
      wrap.classList.add("aligned");st.classList.add("aligned");turn.classList.add("aligned");
      setState("Facing Ekuphumuleni",T("facing"));
      $("turn-num").innerHTML=`${Math.round(abs)}<small>°</small>`;
      $("turn-say").textContent="Aligned with Ekuphumuleni";$("turn-zu").textContent=T("msamo_aligned");
    }else{
      S.aligned=false;
      wrap.classList.remove("aligned");st.classList.remove("aligned");turn.classList.remove("aligned");
      const dir=delta>0?"right":"left",dirZu=T(delta>0?"right":"left"),n=Math.round(abs);
      const hs=S.headingState||{},u=hs.uncertaintyDeg;
      if(u!=null&&hs.confidence==="reliable"){
        setState(`Turn ${n}° to the ${dir}`,T("turn_state",{n,dir:dirZu}));
        $("turn-num").innerHTML=`${n}<small>° ±${Math.round(u)}</small>`;
        $("turn-say").textContent=`Turn the msamo ${n}° to the ${dir}`;$("turn-zu").textContent=T("turn_msamo",{n,dir:dirZu});
      }else{
        setState(bi("Turn toward Ekuphumuleni",T("turn_soft")),T("turn_state",{n,dir:dirZu}));
        $("turn-num").innerHTML=`${n}<small>°</small>`;
        $("turn-say").textContent=bi("Turn the msamo toward Ekuphumuleni (heading not precise yet)",T("turn_msamo_soft"));
        $("turn-zu").textContent=T("turn_msamo_soft");
      }
    }
  }else if(S.loc&&!S.loc.reliable){
    // H2: no needle, no alignment prompt without a reliable fix
    wrap.classList.remove("aligned");st.classList.remove("aligned");turn.classList.remove("aligned");
    setState(bi("Location is approximate",T("loc_approx_short")),bi("Town or typed origins point roughly only — use GPS for msamo alignment.",T("loc_approx")));
    $("turn-num").innerHTML="—";$("turn-say").textContent=bi("Alignment needs a GPS fix",T("loc_approx"));
    $("turn-zu").textContent=T("loc_approx");
  }else if(S.loc&&(S.sensor==="none"||S.sensor==="denied"||S.sensor==="insecure")){
    setState(`Ekuphumuleni is at ${Math.round(S.bearing)}° true`,`Hand compass: ${S.declination==null?"declination unavailable":Math.round(norm(S.bearing-S.declination))+"° magnetic"}`);
    S.dispPtr=0;S.dispDial=-S.bearing;$("pointer").style.transform="rotate(0deg)";$("dial").style.transform=`rotate(${-S.bearing}deg)`;$("hub-deg").textContent=`${Math.round(S.bearing)}°`;
    $("turn-say").textContent="No compass sensor";$("turn-zu").textContent=S.declination==null?T("dec_na"):T("hand_compass",{n:Math.round(norm(S.bearing-S.declination))});
  }else if(S.loc&&S.sensor==="paused"){setState("Move the phone to wake the compass",T("cmp_paused"));
  }else if(S.loc&&S.sensor==="rel"){setState(`Ekuphumuleni is at ${Math.round(S.bearing)}° true`,bi("Tap Set below to calibrate",T("cmp_cal")));
  }else if(S.loc&&S2.started){setState("Waiting for the compass sensor…",T("cmp_wait"));
  }else if(S.loc){setState("Start the compass to point the arrow",T("btn_start"));S.dispPtr=S.bearing;$("pointer").style.transform=`rotate(${S.bearing}deg)`;}
  else if(S.sensor==="on"){setState(bi("Set your location",T("set_loc")),"Waiting for GPS, or use the Location tab");}
  else if(S.sensor==="off"){setState("Start the compass to begin",T("state_start"));}
  drawBubble();
}

/* ---------- Diagnostics (F5/B4/H1: model version, references, quality at runtime) ---------- */
function renderDiag(){
  const el=$("diag-body");if(!el)return;
  const w=S.declinationInfo||{},hs=S.headingState;
  const lines=[
    `WMM model: ${ENG.wmm.WMM.model} · epoch ${ENG.wmm.WMM.epoch} · order ${ENG.wmm.WMM.degree}×${ENG.wmm.WMM.order}`,
    `Valid: ${new Date(ENG.wmm.WMM.validFromMs).toISOString().slice(0,10)} → before ${new Date(ENG.wmm.WMM.validUntilMs).toISOString().slice(0,10)} UTC · state: ${w.modelState||"unknown"}`,
    `Declination here: ${S.declination==null?"unavailable":S.declination.toFixed(2)+"°"}${w.uncertaintyDeg?` ± ${w.uncertaintyDeg.toFixed(2)}° (WMM)`:""} · field zone: ${w.blackout||"unknown"}`,
    `Heading source: ${hs?SRC[hs.source]||hs.source:"—"} · north reference: ${hs?REFNAME[hs.northReference]:"—"}`,
    `Confidence: ${hs?hs.confidence:"—"} · issue: ${hs?hs.issue:"—"} · OS error: ${hs&&hs.uncertaintyDeg!=null?"±"+hs.uncertaintyDeg.toFixed(1)+"°":"unknown (not invented)"}`,
    `Device profile: ${S2.profile.class}${S2.profile.measured?" (measured)":" (not measured — using defaults)"} · repaint ${S2.profile.repaintMs} ms · sample ${S2.profile.sampleHz} Hz`,
    `Field strength: ${S2.field.measuredF!=null?Math.round(S2.field.measuredF)+" nT measured":"not measurable here"} vs ${w.f?Math.round(w.f)+" nT model":"—"} (constant bias can evade this check)`,
    `Location: ${S.loc?`${S.loc.source}${S.loc.reliable?" reliable":" approximate"}${S.loc.accuracyM!=null?" ±"+Math.round(S.loc.accuracyM)+" m":""} · age ${S.loc.timestampMs!=null?Math.round((Date.now()-S.loc.timestampMs)/1000)+" s":"unknown"}`:"not set"}`
  ];
  el.textContent=lines.join("\n");
}
renderDiag.throttled=null;

/* ---------- Location tab ---------- */
(function fillTowns(){
  const sel=$("town");
  for(const [grp,list] of TOWNS){const og=document.createElement("optgroup");og.label=grp;for(const [n,la,lo] of list){const o=document.createElement("option");o.value=`${la},${lo}`;o.textContent=n;og.appendChild(o);}sel.appendChild(og);}
})();
$("btn-gps").addEventListener("click",requestGPS);
$("btn-town").addEventListener("click",()=>{const sel=$("town");if(!sel.value){sel.focus();return;}const [la,lo]=sel.value.split(",").map(Number);
  setLocation(la,lo,sel.options[sel.selectedIndex].textContent,ENG.location.makeFix({lat:la,lon:lo,source:"town",approximate:true,timestampMs:Date.now()}));
  showView("compass");});
$("btn-manual").addEventListener("click",()=>{const la=parseFloat($("lat").value),lo=parseFloat($("lon").value);if(isNaN(la)||isNaN(lo)||Math.abs(la)>90||Math.abs(lo)>180){$("lat").focus();return;}
  setLocation(la,lo,"",ENG.location.makeFix({lat:la,lon:lo,source:"typed",approximate:true,timestampMs:Date.now()}));
  showView("compass");});

/* ---------- Centres map & list ---------- */
const C={map:null,markers:[],user:null,ready:false};
const esc=t=>String(t).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const dirUrl=c=>`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(c.a)}&destination_place_id=&travelmode=driving`;
const mapsUrl=c=>`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.a)}`;
const telHref=p=>"tel:"+p.replace(/[^\+\d]/g,"");
function popupHtml(c,i){
  const km=C.user?` <small>${fmtKm(haversineKm(C.user.lat,C.user.lon,c.la,c.lo))}</small>`:"";
  return `<div class="pp"><b>${esc(c.n)}${km}</b><span class="adr">${esc(c.a)}</span><div class="acts"><a href="${dirUrl(c)}" target="_blank" rel="noopener">Directions</a>${c.p?`<a class="q" href="${telHref(c.p)}">Call ${esc(c.p)}</a>`:""}</div></div>`;
}
function fmtKm(k){return k<10?k.toFixed(1)+" km":Math.round(k).toLocaleString("en-ZA")+" km";}
function initMap(){
  if(locked())return;
  if(C.ready||typeof L==="undefined")return;
  C.ready=true;
  const m=L.map("map",{zoomControl:true,attributionControl:true,tap:false}).setView([-27.5,26.5],5);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'}).addTo(m);
  const capIcon=L.divIcon({className:"",html:'<div class="pin cap"></div>',iconSize:[0,0],popupAnchor:[0,-26]});
  L.marker([TARGET.lat,TARGET.lon],{icon:capIcon,zIndexOffset:1000}).addTo(m).bindPopup(`<div class="pp"><b>Ekuphumuleni</b><span class="adr">Spiritual Capital · 29°04′31.7″S 27°37′28.3″E</span><div class="acts"><a href="https://www.google.com/maps/dir/?api=1&destination=${TARGET.lat},${TARGET.lon}" target="_blank" rel="noopener">Directions</a></div></div>`);
  C.map=m;
  addCentreMarkers();
  setTimeout(()=>m.invalidateSize(),50);
}
function addCentreMarkers(){
  if(!C.map||typeof L==="undefined")return;
  for(const mk of C.markers)mk.remove();C.markers=[];
  const icon=L.divIcon({className:"",html:'<div class="pin"></div>',iconSize:[0,0],popupAnchor:[0,-22]});
  CENTRES.forEach((c,i)=>{const mk=L.marker([c.la,c.lo],{icon,title:c.n}).addTo(C.map).bindPopup(()=>popupHtml(c,i));C.markers.push(mk);});
}
/* called by member.js when /api/centres returns (members only) */
function setCentres(d){REGIONS=d.regions||[];CENTRES=d.centres||[];addCentreMarkers();applySearch();}
function showOnMap(i){
  const c=CENTRES[i];if(!C.map)return;
  window.scrollTo({top:0,behavior:"smooth"});
  C.map.setView([c.la,c.lo],14,{animate:true});C.markers[i].openPopup();
}
function renderCentres(list,mode){
  const root=$("c-list");root.innerHTML="";
  if(!CENTRES.length){root.innerHTML=`<div class="c-empty">${esc(bi("Loading centres…",T("c_loading")))}</div>`;return;}
  if(!list.length){root.innerHTML=`<div class="c-empty">${esc(bi("No centre matches",T("no_match")))}</div>`;return;}
  const groups=new Map();
  if(mode==="near"){groups.set(bi("Nearest to you",T("nearest_you")),list);}
  else{for(const r of REGIONS){const g=list.filter(x=>x.c.r===r);if(g.length)groups.set(r,g);}}
  for(const [title,items] of groups){
    const g=document.createElement("div");g.className="c-group";
    g.innerHTML=`<h2>${esc(title)} <span>· ${items.length}</span></h2>`;
    for(const it of items){
      const c=it.c,i=it.i;
      const el=document.createElement("div");el.className="c-item";
      el.innerHTML=`<div class="n">${esc(c.n)}${it.km!=null?`<small>${fmtKm(it.km)}</small>`:""}</div><div class="b"><button type="button" data-i="${i}">Map</button>${c.p?`<a href="${telHref(c.p)}">Call</a>`:""}<a class="dir" href="${dirUrl(c)}" target="_blank" rel="noopener">Directions</a></div><div class="a">${esc(c.a)}${c.p?` · ${esc(c.p)}`:""}</div>`;
      el.querySelector("button").addEventListener("click",()=>showOnMap(i));
      g.appendChild(el);
    }
    root.appendChild(g);
  }
}
function allCentres(){return CENTRES.map((c,i)=>({c,i,km:C.user?haversineKm(C.user.lat,C.user.lon,c.la,c.lo):null}));}
function applySearch(){
  const q=$("c-search").value.trim().toLowerCase();
  const list=allCentres().filter(x=>!q||(x.c.n+" "+x.c.a+" "+x.c.r).toLowerCase().includes(q));
  $("c-status").textContent=q?`${list.length} centre${list.length===1?"":"s"} match "${$("c-search").value.trim()}"`:bi("All centres, grouped by region",T("c_status_all"));
  renderCentres(list,"all");
}
$("c-search").addEventListener("input",applySearch);
$("btn-near").addEventListener("click",()=>{
  if(locked())return;
  const go=(lat,lon)=>{C.user={lat,lon};const list=allCentres().sort((a,b)=>a.km-b.km).slice(0,8);$("c-search").value="";$("c-status").textContent=bi("The 8 centres closest to you",T("nearest8"));renderCentres(list,"near");if(C.map){C.map.setView([lat,lon],9);L.circleMarker([lat,lon],{radius:7,color:"#fff",weight:2,fillColor:"#2f7a4a",fillOpacity:1}).addTo(C.map).bindPopup(esc(bi("You are here",T("here"))));}};
  if(S.loc&&S.loc.source==="gps"&&S.loc.reliable){go(S.loc.lat,S.loc.lon);}
  else if(navigator.geolocation){$("c-status").textContent="Finding your position…";navigator.geolocation.getCurrentPosition(p=>go(p.coords.latitude,p.coords.longitude),()=>{if(S.loc)go(S.loc.lat,S.loc.lon);else $("c-status").textContent="Location not available. Allow GPS, or set a town under Location, then try again.";},{enableHighAccuracy:true,timeout:15000,maximumAge:60000});}
  else if(S.loc)go(S.loc.lat,S.loc.lon);
});
renderCentres(allCentres(),"all");

/* ---------- Tabs ---------- */
function showView(v){
  for(const s of document.querySelectorAll(".view"))s.hidden=s.id!=="view-"+v;
  for(const t of document.querySelectorAll(".tab"))t.classList.toggle("active",t.dataset.view===v);
  window.scrollTo({top:0});
  if(v==="centres"){initMap();if(C.map)setTimeout(()=>C.map.invalidateSize(),60);}
}
for(const t of document.querySelectorAll(".tab"))t.addEventListener("click",()=>showView(t.dataset.view));

/* ---------- keep the screen on while aligning (optional; never required) ---------- */
let wakeLock=null;
async function keepAwake(){try{if("wakeLock" in navigator&&!document.hidden&&(!wakeLock||wakeLock.released))wakeLock=await navigator.wakeLock.request("screen");}catch(e){}}

/* ---------- Calibration buttons (G1: anchors are session-bound, never persisted) ---------- */
$("btn-suncal").addEventListener("click",()=>{
  if(!S.loc||!S.relReady)return;
  const sp=sunPosition(new Date(),S.loc.lat,S.loc.lon);
  const r=relTracker.setAnchor(sp.az,ENG.ref.TRUE,performance.now());
  if(r.ok){S.sensor="on";resetSmoothing("anchor");$("btn-suncal").hidden=true;$("btn-northcal").hidden=true;}
});
$("btn-northcal").addEventListener("click",()=>{
  if(!S.relReady)return;
  // hand-compass anchor: the top edge points at MAGNETIC north → the anchor is magnetic
  const r=relTracker.setAnchor(0,ENG.ref.MAGNETIC,performance.now());
  if(r.ok){S.sensor="on";resetSmoothing("anchor");$("btn-suncal").hidden=true;$("btn-northcal").hidden=true;}
});
$("btn-travel").addEventListener("click",()=>setTravelMode(S.mode!=="travel"));
$("btn-start").addEventListener("click",()=>{
  $("btn-start").disabled=true;$("btn-start").innerHTML='Compass running <small data-t="btn_running" data-pre="· "></small>';applyLang();
  startSensors();
  if(!S.loc||S.loc.source!=="gps")requestGPS();
});

/* ---------- hidden page: stop sensors, timers, watches and the wake lock (D4) ---------- */
document.addEventListener("visibilitychange",()=>{
  if(document.hidden){stopSession();return;}
  if(S2.started){S2.started=false;resetSmoothing("resume");startSensors();keepAwake();} // fresh session on resume (G3)
});
window.addEventListener("pagehide",()=>stopSession());

/* in-app browsers (Facebook, Instagram, some WhatsApp links) often block the compass */
(function inApp(){
  const ua=navigator.userAgent||"";
  if(!/FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Snapchat|TikTok|; wv\)/i.test(ua))return;
  $("inapp").hidden=false;
  if(/Android/i.test(ua)){const b=$("btn-chrome");b.hidden=false;b.href=`intent://${location.host}${location.pathname}#Intent;scheme=https;package=com.android.chrome;end`;}
})();

/* ---------- Boot ---------- */
(function boot(){
  LANG=detectLang();
  $("lang").addEventListener("change",()=>{LANG=$("lang").value;try{localStorage.setItem("tshk-lang",LANG);}catch(e){}applyLang();});
  if(!window.isSecureContext){S.sensor="insecure";setChipCmp("bad","Compass and location need HTTPS","cmp_insecure");}
  try{const s=JSON.parse(localStorage.getItem("tshk-loc")||"null");
    if(s&&isFinite(s.lat)&&isFinite(s.lon))setLocation(s.lat,s.lon,s.name||"",ENG.location.makeFix({lat:s.lat,lon:s.lon,source:s.source==="gps"?"gps":s.source||"typed",approximate:s.source!=="gps"||s.approximate===true,timestampMs:null}));
  }catch(e){}
  applyLang();
})();
