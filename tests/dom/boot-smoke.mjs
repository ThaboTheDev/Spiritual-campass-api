/* Boot smoke for the compass page (public/app.js over public/engine.js).
   Loads the real script order of index.html into jsdom and checks that boot
   renders without throwing and that the hardened UI is wired (travel toggle,
   diagnostics, bubbles). Not a behaviour test — that is tests/unit/engine.test.js. */
import { readFileSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";

let fails = 0;
const ok = (name, cond) => { console.log((cond ? "PASS " : "FAIL ") + name); if (!cond) fails++; };

const vc = new VirtualConsole();
let bootError = null;
vc.on("jsdomError", (e) => { bootError = e; });

const dom = new JSDOM(readFileSync("public/index.html", "utf8"), {
  runScripts: "outside-only", url: "https://localhost/", pretendToBeVisual: true, virtualConsole: vc,
});
const w = dom.window;

// browser APIs jsdom lacks — present in every target browser
w.matchMedia = w.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
w.navigator.geolocation = { getCurrentPosition() {}, watchPosition() { return 1; }, clearWatch() {} };
w.fetch = async (url) => ({ ok: true, status: 200, json: async () => ({ regions: [], centres: [] }), headers: { get: () => null } });
w.HTMLFormElement.prototype.submit = function () { w.__formPosted = this.action; };

/* Classic scripts share one global lexical scope (top-level const TOWNS etc.);
   window.eval does not, so evaluate the bundle as one program like the page does. */
try {
  w.eval(["config.js", "lang.js", "geo.js", "engine.js", "member.js", "app.js"]
    .map((f) => readFileSync("public/" + f, "utf8")).join("\n;\n"));
} catch (e) {
  console.log("FAIL loading scripts: " + e.message); fails++; console.log(fails + " check(s) failed"); process.exit(1);
}

ok("boot does not throw", !bootError);
ok("engine + geo attached", typeof w.TSHKEngine === "object" && typeof w.TSHKGeo === "object");
ok("dial ticks built", w.document.querySelectorAll("#dialsvg *").length > 20);
ok("towns populated", w.document.querySelectorAll("#town option").length > 50);
ok("chips rendered", /Location|indawo|Malo|Incende/i.test(w.document.getElementById("chip-loc-t").textContent));
ok("travel button present", !!w.document.getElementById("btn-travel"));
ok("diagnostics body present", !!w.document.getElementById("diag-body"));
ok("level bubble box id wired", !!w.document.getElementById("bubble-box"));

// applyLang runs over the new keys without throwing
try { w.applyLang("zu"); ok("applyLang(za) fills travel chip", w.document.getElementById("btn-travel").textContent.length > 3); }
catch (e) { ok("applyLang(za) fills travel chip", false); }

// toggle travel mode and re-render
try {
  w.setTravelMode(true);
  ok("travel mode note shown", !w.document.getElementById("travel-note").hidden);
  ok("travel mode chip says travel", /travel|uhambo|kuyenda|ulubendo/i.test(w.document.getElementById("chip-cmp-t").textContent));
  w.setTravelMode(false);
  ok("travel mode exits", w.document.getElementById("travel-note").hidden);
} catch (e) { ok("travel toggle runs", false); console.log("  travel error: " + e.message); }

ok("hub shows placeholder until a heading arrives", w.document.getElementById("hub-deg").textContent === "—");
console.log(fails === 0 ? "All checks passed" : fails + " check(s) failed");
process.exit(fails ? 1 : 0);
