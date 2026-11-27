/* ATP usage counter — shared by the ATP Events app and the event sites.

   Add to any ATP site with one line, changing data-site for each site:
     <script src="https://eventsapp.atppickleballclub.com.au/usage.js" data-site="intraclub" defer></script>

   What it records, anonymously, in the ATP Events Firebase (usage/<site>_<date>):
   - opens: opening the site, or coming back to it after 5+ minutes away
   - phones: different phones that day (each phone counted once per day)
   - which half hour each open happened in (Sydney time)
   - for event sites: whether people came from the Events app or a QR code / direct link
   No names, logins or personal details. Only the committee can read the numbers. */
(function () {
  var me = document.currentScript;
  var SITE = me && me.getAttribute("data-site");
  if (!SITE || !/^[a-z0-9-]{2,20}$/.test(SITE)) return;
  if (location.protocol !== "https:") return;            // not when testing from a file

  var KEY = "AIzaSyAykyvBpr-3H4_gCm--8tDN2IhV-2EFfj0";
  var PROJECT = "atp-events";
  var AWAY = 5 * 60 * 1000;                               // away this long = a new open

  function get(store, k) { try { return window[store].getItem(k); } catch (e) { return null; } }
  function set(store, k, v) { try { window[store].setItem(k, v); } catch (e) {} }
  function del(store, k) { try { window[store].removeItem(k); } catch (e) {} }

  // How they got here. The Events app adds ?from=app to its event links;
  // remembered for this tab so later re-opens still count as "from the app".
  var via = null;
  if (SITE !== "app") {
    try { if (new URLSearchParams(location.search).get("from") === "app") set("sessionStorage", "atpUsageFrom", "app"); } catch (e) {}
    via = get("sessionStorage", "atpUsageFrom") === "app" ? "app" : "direct";
  }

  function sydneyNow() {
    var p = {};
    new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    return { date: p.year + "-" + p.month + "-" + p.day, box: "h" + p.hour + (Number(p.minute) < 30 ? "00" : "30") };
  }

  var lastCount = 0;
  function count() {
    if (Date.now() - lastCount < 3000) return;              // same open seen twice
    lastCount = Date.now();
    var t = sydneyNow();
    var dayKey = "atpUsage_" + SITE + "_" + t.date;
    var wayKey = dayKey + "_" + via;
    var newPhone = !get("localStorage", dayKey);                 // first visit today at all
    var newWay = !!via && !get("localStorage", wayKey);           // first visit today this way in
    if (newPhone) set("localStorage", dayKey, "1");
    if (newWay) set("localStorage", wayKey, "1");

    // "phones" counts each phone once a day. The way-in rows count a phone once
    // for each way it arrived, so a phone that used both shows in both rows.
    var fields = ["opens", t.box];
    if (via) fields.push(via === "app" ? "viaApp" : "direct");
    if (newPhone) fields.push("phones");
    if (newWay) fields.push(via === "app" ? "phonesViaApp" : "phonesDirect");

    function undo() { if (newPhone) del("localStorage", dayKey); if (newWay) del("localStorage", wayKey); }

    var name = "projects/" + PROJECT + "/databases/(default)/documents/usage/" + SITE + "_" + t.date;
    var body = { writes: [{
      update: { name: name, fields: { site: { stringValue: SITE }, date: { stringValue: t.date } } },
      updateMask: { fieldPaths: ["site", "date"] },
      updateTransforms: fields.map(function (f) { return { fieldPath: f, increment: { integerValue: "1" } }; })
    }] };
    try {
      fetch("https://firestore.googleapis.com/v1/projects/" + PROJECT + "/databases/(default)/documents:commit?key=" + KEY, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true
      }).then(function (r) { if (!r.ok) undo(); }).catch(undo);
    } catch (e) {}

    // Tidy up this site's markers from earlier days.
    try {
      for (var i = localStorage.length - 1; i >= 0; i--) {
        var k = localStorage.key(i);
        if (k && k.indexOf("atpUsage_" + SITE + "_") === 0 && k.indexOf(dayKey) !== 0) localStorage.removeItem(k);
      }
    } catch (e) {}
  }

  // Reloading or moving between pages within 5 minutes is the same visit.
  function recent() { var t = Number(get("sessionStorage", "atpUsageSeen_" + SITE) || 0); return Date.now() - t < AWAY; }
  function seen() { set("sessionStorage", "atpUsageSeen_" + SITE, String(Date.now())); }
  window.addEventListener("pagehide", seen);

  var hiddenAt = 0;
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { hiddenAt = Date.now(); seen(); return; }
    if (hiddenAt && Date.now() - hiddenAt >= AWAY) count();
    seen();
    hiddenAt = 0;
  });
  window.addEventListener("pageshow", function (e) { if (e.persisted && !recent()) count(); });   // back/forward to a saved page
  if (!recent()) count();
  seen();
})();
