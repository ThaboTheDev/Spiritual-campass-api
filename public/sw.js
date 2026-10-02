const CACHE="tshk-compass-sub-v2";
const CORE=["/","/index.html","/config.js","/member.js","/geo.js","/engine.js","/lang.js","/app.js","/reset.html","/logo.png","/manifest.webmanifest","/icon-192.png","/icon-512.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()));});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
function navKey(url){return url.pathname==="/"||url.pathname==="/index.html"?"/index.html":url.pathname+(url.pathname.endsWith(".html")?"":".html");}
self.addEventListener("fetch",e=>{
  const req=e.request; if(req.method!=="GET")return;
  const url=new URL(req.url);
  // map tiles: network only, never cached
  if(url.hostname.endsWith("openstreetmap.org"))return;
  // membership API and PayFast: always live, never cached
  if(url.pathname.startsWith("/api/")||url.hostname.endsWith("payfast.co.za")||url.hostname.endsWith("supabase.co"))return;
  if(url.origin===location.origin){
    // same-origin files: network first so updates arrive, cached copy when offline
    // /reset is a navigation too, and must not fall back to the app shell
    const key=req.mode==="navigate"?navKey(url):req;
    e.respondWith(fetch(req).then(r=>{if(r.ok){const cp=r.clone();caches.open(CACHE).then(c=>c.put(key,cp));}return r;}).catch(()=>caches.match(key)));
    return;
  }
  // fonts, map library and other cross-origin files: cache after first use
  e.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(r=>{if(r.ok){const cp=r.clone();caches.open(CACHE).then(c=>c.put(req,cp));}return r;}).catch(()=>hit)));
});
