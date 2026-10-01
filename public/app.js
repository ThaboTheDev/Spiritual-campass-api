/* ---------- Ekuphumuleni ---------- */
const TARGET={lat:-29.07547,lon:27.62453,name:"Ekuphumuleni"};

/* ---------- State ---------- */
const S={loc:null,heading:null,dispDial:0,dispPtr:0,declination:0,bearing:null,distKm:null,sensor:"off",aligned:false,beta:0,gamma:0,lastEvt:0,chip:null,sunWhy:null};
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
  if(typeof renderReadouts==="function"){renderReadouts();render();renderSun();}
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

/* ---------- Location ---------- */
function setLocation(lat,lon,name,source,acc){
  S.loc={lat,lon,name,source,acc};
  S.bearing=initialBearing(lat,lon,TARGET.lat,TARGET.lon);
  S.distKm=haversineKm(lat,lon,TARGET.lat,TARGET.lon);
  S.declination=wmmDeclination(lat,lon,0,decimalYear(new Date()));
  try{localStorage.setItem("tshk-loc",JSON.stringify({lat,lon,name,source}));}catch(e){}
  renderReadouts();render();
}
function fmtCoord(lat,lon){return `${Math.abs(lat).toFixed(4)}° ${lat<0?"S":"N"}, ${Math.abs(lon).toFixed(4)}° ${lon<0?"W":"E"}`;}
function renderReadouts(){
  const chip=$("chip-loc");
  if(!S.loc){chip.className="chip";$("chip-loc-t").textContent=bi("Location: not set",T("loc_unset"));return;}
  const src=S.loc.source==="gps"?`GPS${S.loc.acc?` ±${Math.round(S.loc.acc)} m`:""}`:S.loc.source==="town"?bi("town",T("loc_town")):"typed";
  chip.className="chip on";$("chip-loc-t").textContent=`Location: ${src}`;
  $("ro-bearing").innerHTML=`${S.bearing.toFixed(1)}°`;
  $("ro-dist").innerHTML=S.distKm<10?`${S.distKm.toFixed(2)} <small>km</small>`:`${Math.round(S.distKm).toLocaleString("en-ZA")} <small>km</small>`;
  $("ro-mag").innerHTML=`${norm(S.bearing-S.declination).toFixed(1)}°`;
  $("ro-dec").innerHTML=`${S.declination>=0?"+":"−"}${Math.abs(S.declination).toFixed(1)}° <small>${S.declination<0?"W":"E"}</small>`;
  $("ro-loc").textContent=`${S.loc.name?S.loc.name+" · ":""}${fmtCoord(S.loc.lat,S.loc.lon)}`;
  const tm=document.getElementById("target-mark");if(tm)tm.setAttribute("transform",`rotate(${S.bearing.toFixed(2)} 100 100)`);
}
function requestGPS(){
  if(!navigator.geolocation){$("gps-note").textContent="This browser has no location service. Choose a town or type coordinates.";return;}
  $("gps-note").textContent=bi("Finding your position…",T("gps_finding"));
  navigator.geolocation.getCurrentPosition(p=>{
    setLocation(p.coords.latitude,p.coords.longitude,"",
      "gps",p.coords.accuracy);
    $("gps-note").textContent=bi(`Position found (±${Math.round(p.coords.accuracy)} m).`,T("gps_found"));
    renderSun();
    if(!S.gpsWatch)S.gpsWatch=navigator.geolocation.watchPosition(w=>{
      if(w.coords.accuracy<80&&S.loc&&S.loc.source==="gps"){S.loc.lat=w.coords.latitude;S.loc.lon=w.coords.longitude;S.loc.acc=w.coords.accuracy;S.bearing=initialBearing(S.loc.lat,S.loc.lon,TARGET.lat,TARGET.lon);S.distKm=haversineKm(S.loc.lat,S.loc.lon,TARGET.lat,TARGET.lon);renderReadouts();}
      if((S.sensor==="none"||S.sensor==="rel"&&S.relOffset==null)&&typeof w.coords.heading==="number"&&!isNaN(w.coords.heading)&&w.coords.speed>0.8)useHeading(w.coords.heading,"gps",true);
    },()=>{},{enableHighAccuracy:true,maximumAge:5000});
  },err=>{
    $("gps-note").textContent="Location was not available ("+(err.code===1?"permission refused":"no fix")+"). Choose a town or type coordinates below.";
    if(!S.loc)setState(bi("Set your location",T("set_loc")),bi("Open the Location tab",T("open_loc_tab")));
  },{enableHighAccuracy:true,timeout:20000,maximumAge:60000});
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
function renderSun(){
  const card=$("suncard");if(card.hidden||!S.loc)return;
  const sp=sunPosition(new Date(),S.loc.lat,S.loc.lon);
  $("sun-az").innerHTML=`${Math.round(sp.az)}° <small>${compass16(sp.az)}</small>`;
  $("sun-alt").innerHTML=`${Math.round(sp.alt)}°`;
  if(sp.alt<-1){$("sun-turn").textContent=bi("The sun is below the horizon now. Use a hand compass with the magnetic bearing, or try again in daylight.",T("sun_night"));$("sun-shadow").textContent="—";$("btn-suncal").hidden=true;return;}
  const d=signedDiff(S.bearing,sp.az),abs=Math.round(Math.abs(d)),dir=d>0?"right":"left",dirZu=T(d>0?"right":"left");
  $("sun-turn").textContent=abs<=3?bi("Face the sun: Ekuphumuleni is straight ahead.",T("sun_ahead")):bi(`Face the sun, then turn ${abs}° to the ${dir}.`,T("sun_turn",{n:abs,dir:dirZu}));
  const sh=norm(sp.az+180),ds=signedDiff(S.bearing,sh),abs2=Math.round(Math.abs(ds));
  $("sun-shadow").textContent=`A stick's shadow points to ${Math.round(sh)}° (${compass16(sh)}). Stand facing along the shadow, then turn ${abs2}° to the ${ds>0?"right":"left"}.`;
  $("btn-suncal").hidden=!(S.sensor==="rel");
}
setInterval(renderSun,30000);

/* ---------- Compass engine ----------
   Sources, best first: 1 iPhone webkitCompassHeading  2 Android AbsoluteOrientationSensor
   3 absolute deviceorientation  4 relative orientation + sun/north calibration
   5 GPS course while walking  6 no sensor: sun guidance + hand-compass bearing.
   Heading = the direction the user faces: the top edge of the screen when the phone is flat,
   blending smoothly into the back of the phone as it is raised upright, in portrait or landscape.
   Readings are smoothed on the unit circle (no jump at 359/0) and drawn once per screen frame. */
const D2R=Math.PI/180,R2D=180/Math.PI;
const SRC={ios:"iPhone compass",aos:"Android compass",abs:"compass",rel:"turn sensor + calibration",gps:"GPS (walking)"};
S.relRaw=null;S.relOffset=null;S.aos=null;S.aosOn=false;S.sawRel=false;S.started=false;S.lowAcc=false;S.lastText=0;S.lastRound=null;
function screenAngle(){return (screen.orientation&&typeof screen.orientation.angle==="number")?screen.orientation.angle:(typeof window.orientation==="number"?window.orientation:0);}
/* facing vector from device axes expressed in Earth coordinates (E,N,Up) */
function facing(xE,xN,xU,yE,yN,yU,zE,zN,zU,th){
  const st=Math.sin(th),ct=Math.cos(th);
  const tE=st*xE+ct*yE,tN=st*xN+ct*yN,tU=st*xU+ct*yU;     // top edge of the screen
  const w=tU*tU;                                          // 0 when flat, 1 when upright
  return norm(Math.atan2(tE-w*zE,tN-w*zN)*R2D);           // add the back of the phone as it rises
}
function headingFromEuler(alpha,beta,gamma){
  const a=alpha*D2R,b=(beta||0)*D2R,g=(gamma||0)*D2R;
  const ca=Math.cos(a),sa=Math.sin(a),cb=Math.cos(b),sb=Math.sin(b),cg=Math.cos(g),sg=Math.sin(g);
  return facing(ca*cg-sa*sb*sg, sa*cg+ca*sb*sg, -cb*sg,
                -sa*cb, ca*cb, sb,
                ca*sg+sa*sb*cg, sa*sg-ca*sb*cg, cb*cg, screenAngle()*D2R);
}
function headingFromQuat(q){ // device(screen) -> Earth, Earth x east, y north, z up
  const [x,y,z,w]=q;
  return facing(1-2*(y*y+z*z), 2*(x*y+w*z), 2*(x*z-w*y),
                2*(x*y-w*z), 1-2*(x*x+z*z), 2*(y*z+w*x),
                2*(x*z+w*y), 2*(y*z-w*x), 1-2*(x*x+y*y), 0);
}
/* smoothing */
const SM={x:0,y:1,init:false,t:0};
function feedHeading(h){
  const now=performance.now(),r=h*D2R,cx=Math.sin(r),cy=Math.cos(r);
  if(!SM.init){SM.x=cx;SM.y=cy;SM.init=true;}
  else{const dt=Math.min(.5,Math.max(.001,(now-SM.t)/1000));
    const gap=Math.abs(signedDiff(h,Math.atan2(SM.x,SM.y)*R2D));
    const tau=gap>45?.06:.14;                            // follow big turns quickly, calm small jitter
    const k=1-Math.exp(-dt/tau);SM.x+=k*(cx-SM.x);SM.y+=k*(cy-SM.y);}
  SM.t=now;
}
function useHeading(value,source,isTrue){
  const h=isTrue?value:norm(value+S.declination);
  S.lastEvt=Date.now();feedHeading(h);
  if(S.sensor!=="on"||S.src!==source){S.sensor="on";S.src=source;setChipCmp("on","Compass: on · "+SRC[source],"cmp_on");$("nocompass").hidden=true;if(source!=="rel")$("suncard").hidden=true;}
  startLoop();
}
let loopOn=false;
function startLoop(){if(loopOn)return;loopOn=true;requestAnimationFrame(frame);}
function frame(){
  if(SM.init&&S.sensor==="on"){
    S.heading=norm(Math.atan2(SM.x,SM.y)*R2D);
    drawNeedle();
    const now=performance.now(),rd=Math.round(S.heading);
    if(rd!==S.lastRound&&now-S.lastText>90){S.lastRound=rd;S.lastText=now;render();}
  }
  drawBubble();
  requestAnimationFrame(frame);
}
function drawNeedle(){
  if(S.heading==null)return;
  const d1=signedDiff(-S.heading,S.dispDial);if(Math.abs(d1)>.05){S.dispDial+=d1;$("dial").style.transform=`rotate(${S.dispDial.toFixed(2)}deg)`;}
  if(S.loc){const d2=signedDiff(norm(S.bearing-S.heading),S.dispPtr);if(Math.abs(d2)>.05){S.dispPtr+=d2;$("pointer").style.transform=`rotate(${S.dispPtr.toFixed(2)}deg)`;}}
}
function drawBubble(){
  const gx=Math.max(-1,Math.min(1,S.gamma/30)),gy=Math.max(-1,Math.min(1,S.beta/30));
  $("bubble").style.transform=`translate(calc(-50% + ${(gx*22).toFixed(1)}px), calc(-50% + ${(gy*22).toFixed(1)}px))`;
}
function onOrientation(e){
  if(e.alpha===0&&e.beta===0&&e.gamma===0)return;          // placeholder events from phones without sensors
  if(typeof e.beta==="number"){S.beta=e.beta;S.gamma=e.gamma||0;}
  if(S.aosOn)return;                                      // Android orientation sensor already drives the dial
  if(typeof e.webkitCompassHeading==="number"&&!isNaN(e.webkitCompassHeading)&&e.webkitCompassHeading>=0){
    const acc=e.webkitCompassAccuracy,low=typeof acc==="number"&&(acc<0||acc>25);
    if(low!==S.lowAcc){S.lowAcc=low;$("calib").hidden=!low;}
    useHeading(norm(e.webkitCompassHeading+screenAngle()),"ios",false);return;}
  if(typeof e.alpha!=="number"||isNaN(e.alpha))return;
  const h=headingFromEuler(e.alpha,e.beta,e.gamma);
  if(e.absolute===true||e.type==="deviceorientationabsolute"){useHeading(h,"abs",false);return;}
  S.sawRel=true;S.relRaw=h;                                // relative only: usable once calibrated
  if(S.src==="abs"||S.src==="ios")return;
  if(S.relOffset!=null)useHeading(norm(h+S.relOffset),"rel",true);
}
function startAbsoluteSensor(){
  if(!("AbsoluteOrientationSensor" in window))return;
  try{
    if(!S.aos){
      const sensor=new AbsoluteOrientationSensor({frequency:30,referenceFrame:"screen"});
      sensor.addEventListener("reading",()=>{if(!sensor.quaternion)return;S.aosOn=true;useHeading(headingFromQuat(sensor.quaternion),"aos",true);});
      sensor.addEventListener("error",()=>{S.aosOn=false;});
      S.aos=sensor;
    }
    S.aos.start();
  }catch(e){S.aos=null;S.aosOn=false;}
}
function setChipCmp(cls,t,key){S.chip=[cls,t,key];$("chip-cmp").className="chip "+cls;$("chip-cmp-t").textContent=bi(t,key?T(key):"");}
function showNoCompass(){$("nocompass").hidden=false;$("suncard").hidden=false;renderSunWhy();renderSun();render();}
function startSensors(){
  if(S.started)return;S.started=true;
  const listen=()=>{
    if("ondeviceorientationabsolute" in window)window.addEventListener("deviceorientationabsolute",onOrientation,true);
    window.addEventListener("deviceorientation",onOrientation,true);
    startAbsoluteSensor();
    setChipCmp("warn","Compass: waiting for sensor…","cmp_wait");
    setTimeout(()=>{
      if(S.sensor==="on")return;
      if(S.sawRel){S.sensor="rel";setChipCmp("warn","Compass: needs calibration","cmp_cal");S.sunWhy="rel";$("btn-northcal").hidden=false;}
      else{S.sensor="none";setChipCmp("bad","Compass: not available","cmp_none");S.sunWhy="none";}
      showNoCompass();
    },4000);
  };
  if(typeof DeviceOrientationEvent!=="undefined"&&typeof DeviceOrientationEvent.requestPermission==="function"){
    DeviceOrientationEvent.requestPermission().then(r=>{if(r==="granted")listen();else{S.sensor="denied";S.sunWhy="none";setChipCmp("bad","Compass: permission refused","cmp_denied");showNoCompass();}})
      .catch(()=>{S.sensor="denied";S.sunWhy="none";setChipCmp("bad","Compass: permission refused · reload the page and allow motion access","cmp_denied");showNoCompass();});
  }else listen();
  keepAwake();
}
/* sensor stopped (screen lock, app switch, phone put down in some browsers) */
setInterval(()=>{
  if(S.sensor==="on"&&!document.hidden&&Date.now()-S.lastEvt>3000){S.sensor="paused";S.src=null;setChipCmp("warn","Compass: paused · move the phone","cmp_paused");if(S.aos)startAbsoluteSensor();}
},1000);
document.addEventListener("visibilitychange",()=>{
  if(document.hidden)return;
  SM.init=false;                                          // start fresh, no spinning catch-up
  if(S.started){if(S.aos)startAbsoluteSensor();keepAwake();}
});
/* keep the screen on while aligning */
let wakeLock=null;
async function keepAwake(){try{if("wakeLock" in navigator&&!document.hidden&&(!wakeLock||wakeLock.released))wakeLock=await navigator.wakeLock.request("screen");}catch(e){}}
$("btn-suncal").addEventListener("click",()=>{if(S.relRaw==null||!S.loc)return;const sp=sunPosition(new Date(),S.loc.lat,S.loc.lon);S.relOffset=norm(sp.az-S.relRaw);SM.init=false;useHeading(sp.az,"rel",true);$("btn-suncal").hidden=true;$("btn-northcal").hidden=true;});
$("btn-northcal").addEventListener("click",()=>{if(S.relRaw==null)return;S.relOffset=norm(-S.relRaw);SM.init=false;useHeading(0,"rel",true);$("btn-suncal").hidden=true;$("btn-northcal").hidden=true;});
$("btn-start").addEventListener("click",()=>{
  $("btn-start").disabled=true;$("btn-start").innerHTML='Compass running <small data-t="btn_running" data-pre="· "></small>';applyLang();
  startSensors();
  if(!S.loc||S.loc.source!=="gps")requestGPS();
});
/* in-app browsers (Facebook, Instagram, some WhatsApp links) often block the compass */
(function inApp(){
  const ua=navigator.userAgent||"";
  if(!/FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Snapchat|TikTok|; wv\)/i.test(ua))return;
  $("inapp").hidden=false;
  if(/Android/i.test(ua)){const b=$("btn-chrome");b.hidden=false;b.href=`intent://${location.host}${location.pathname}#Intent;scheme=https;package=com.android.chrome;end`;}
})();

/* ---------- Rendering ---------- */
function setState(main,sub){$("state-main").textContent=main;$("state-sub").textContent=sub;}
function render(){
  const wrap=$("dialwrap"),st=$("state"),turn=$("turnbox");
  $("hub-deg").textContent=S.heading==null||S.sensor!=="on"?"—":`${Math.round(S.heading)}°`;
  const live=S.heading!=null&&S.sensor==="on";
  if(live)drawNeedle();
  if(S.loc&&live){
    const delta=signedDiff(S.bearing,S.heading);const abs=Math.abs(delta);
    const aligned=S.aligned?abs<=5:abs<=3;                 // hysteresis: no flicker at the edge
    if(aligned&&!S.aligned){try{navigator.vibrate&&navigator.vibrate(60);}catch(e){}}
    S.aligned=aligned;
    wrap.classList.toggle("aligned",aligned);st.classList.toggle("aligned",aligned);turn.classList.toggle("aligned",aligned);
    const dir=delta>0?"right":"left",dirZu=T(delta>0?"right":"left"),n=Math.round(abs);
    if(aligned){setState("Facing Ekuphumuleni",T("facing"));
      $("turn-num").innerHTML=`${n}<small>°</small>`;$("turn-say").textContent="Aligned with Ekuphumuleni";$("turn-zu").textContent=T("msamo_aligned");}
    else{setState(`Turn ${n}° to the ${dir}`,T("turn_state",{n,dir:dirZu}));
      $("turn-num").innerHTML=`${n}<small>°</small>`;$("turn-say").textContent=`Turn the msamo ${n}° to the ${dir}`;$("turn-zu").textContent=T("turn_msamo",{n,dir:dirZu});}
  }else if(S.loc&&(S.sensor==="none"||S.sensor==="denied")){
    setState(`Ekuphumuleni is at ${Math.round(S.bearing)}° true`,`Hand compass: ${Math.round(norm(S.bearing-S.declination))}° magnetic`);
    S.dispPtr=0;S.dispDial=-S.bearing;$("pointer").style.transform="rotate(0deg)";$("dial").style.transform=`rotate(${-S.bearing}deg)`;$("hub-deg").textContent=`${Math.round(S.bearing)}°`;
    $("turn-say").textContent="No compass sensor";$("turn-zu").textContent=T("hand_compass",{n:Math.round(norm(S.bearing-S.declination))});
  }else if(S.loc&&S.sensor==="paused"){setState("Move the phone to wake the compass",T("cmp_paused"));
  }else if(S.loc&&S.sensor==="rel"){setState(`Ekuphumuleni is at ${Math.round(S.bearing)}° true`,bi("Tap Set below to calibrate",T("cmp_cal")));
  }else if(S.loc&&S.started){setState("Waiting for the compass sensor…",T("cmp_wait"));
  }else if(S.loc){setState("Start the compass to point the arrow",T("btn_start"));S.dispPtr=S.bearing;$("pointer").style.transform=`rotate(${S.bearing}deg)`;}
  else if(S.sensor==="on"){setState(bi("Set your location",T("set_loc")),"Waiting for GPS, or use the Location tab");}
  else if(S.sensor==="off"){setState("Start the compass to begin",T("state_start"));}
  // level bubble (position drawn every frame; state text here)
  const flat=live&&Math.abs(S.beta)<8&&Math.abs(S.gamma)<8;$("bubble").classList.toggle("flat",flat);
  $("level-t").textContent=!live?"Level":flat?bi("Flat",T("flat")):bi("Tilted",T("tilted"));
}

/* ---------- Location tab ---------- */
(function fillTowns(){
  const sel=$("town");
  for(const [grp,list] of TOWNS){const og=document.createElement("optgroup");og.label=grp;for(const [n,la,lo] of list){const o=document.createElement("option");o.value=`${la},${lo}`;o.textContent=n;og.appendChild(o);}sel.appendChild(og);}
})();
$("btn-gps").addEventListener("click",requestGPS);
$("btn-town").addEventListener("click",()=>{const sel=$("town");if(!sel.value){sel.focus();return;}const [la,lo]=sel.value.split(",").map(Number);setLocation(la,lo,sel.options[sel.selectedIndex].textContent,"town");showView("compass");});
$("btn-manual").addEventListener("click",()=>{const la=parseFloat($("lat").value),lo=parseFloat($("lon").value);if(isNaN(la)||isNaN(lo)||Math.abs(la)>90||Math.abs(lo)>180){$("lat").focus();return;}setLocation(la,lo,"","typed");showView("compass");});

/* ---------- Centres map & list ---------- */
const C={map:null,markers:[],user:null,ready:false};
const esc=t=>String(t).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const dirUrl=c=>`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(c.a)}&destination_place_id=&travelmode=driving`;
const mapsUrl=c=>`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.a)}`;
const telHref=p=>"tel:"+p.replace(/[^+\d]/g,"");
function popupHtml(c,i){
  const km=C.user?` <small>${fmtKm(haversineKm(C.user.lat,C.user.lon,c.la,c.lo))}</small>`:"";
  return `<div class="pp"><b>${esc(c.n)}${km}</b><span class="adr">${esc(c.a)}</span><div class="acts"><a href="${dirUrl(c)}" target="_blank" rel="noopener">Directions</a>${c.p?`<a class="q" href="${telHref(c.p)}">Call ${esc(c.p)}</a>`:""}</div></div>`;
}
function fmtKm(k){return k<10?k.toFixed(1)+" km":Math.round(k).toLocaleString("en-ZA")+" km";}
function initMap(){
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
  const go=(lat,lon)=>{C.user={lat,lon};const list=allCentres().sort((a,b)=>a.km-b.km).slice(0,8);$("c-search").value="";$("c-status").textContent=bi("The 8 centres closest to you",T("nearest8"));renderCentres(list,"near");if(C.map){C.map.setView([lat,lon],9);L.circleMarker([lat,lon],{radius:7,color:"#fff",weight:2,fillColor:"#2f7a4a",fillOpacity:1}).addTo(C.map).bindPopup(esc(bi("You are here",T("here"))));}};
  if(S.loc&&S.loc.source==="gps"){go(S.loc.lat,S.loc.lon);}
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

/* ---------- Boot ---------- */
(function boot(){
  LANG=detectLang();
  $("lang").addEventListener("change",()=>{LANG=$("lang").value;try{localStorage.setItem("tshk-lang",LANG);}catch(e){}applyLang();});
  try{const s=JSON.parse(localStorage.getItem("tshk-loc")||"null");if(s&&isFinite(s.lat)&&isFinite(s.lon))setLocation(s.lat,s.lon,s.name||"",s.source==="gps"?"gps":s.source||"typed");}catch(e){}
  applyLang();
})();
