/* ============================================================
   info-feeds.js — shared live-data module (weather + trains)
   Lifted from Command Centre / Calendar apps so every app uses
   the exact same sources. No API keys, all client-side:
   • Weather : Open-Meteo daily forecast (lat 35.79, lon 140.06, JST)
   • Trains  : hardcoded weekday timetables (Sōbu / Monorail legs)
               + live delay status from ODPT TrainInformation
   Exposes window.WF_FEEDS.
   ============================================================ */
(function () {
  "use strict";

  /* ---------------- WEATHER (Open-Meteo) ---------------- */
  var WX_LABELS = {
    0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Fog",
    51: "Drizzle", 53: "Drizzle", 55: "Drizzle",
    61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
    71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
    80: "Showers", 81: "Showers", 82: "Heavy showers",
    85: "Snow showers", 86: "Snow showers",
    95: "Thunderstorm", 96: "Thunderstorm", 99: "Thunderstorm"
  };
  var RAIN_CODES = [51, 53, 55, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99];

  function loadWeather() {
    return fetch("https://api.open-meteo.com/v1/forecast?latitude=35.79&longitude=140.06&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=Asia%2FTokyo&forecast_days=7")
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) {
        var byDate = {};
        var days = d.daily;
        for (var i = 0; i < days.time.length; i++) {
          var code = days.weathercode[i];
          byDate[days.time[i]] = {
            code: code,
            label: WX_LABELS[code] || "Mixed",
            tMax: Math.round(days.temperature_2m_max[i]),
            tMin: Math.round(days.temperature_2m_min[i]),
            rainy: RAIN_CODES.indexOf(code) >= 0
          };
        }
        var todayKey = days.time[0];
        return { today: byDate[todayKey], byDate: byDate };
      });
  }

  /* ---------------- TRAINS: weekday timetables ---------------- */
  // 下総中山→秋葉原 (総武線 三鷹方面 weekday)
  var SOBU_AM = [700,703,706,709,712,715,718,720,723,725,728,731,733,736,738,741,744,747,750,752,755,758,800,803,806,809,811,814,818,822,826,830,834,837,840,844,848,852,856,900,904,908,912,916,920,925,930,935,940,945,950,955,1000,1005,1010,1016,1022,1028,1034,1040,1046,1052,1058];
  // 流通センター→浜松町 (モノレール weekday)
  var MONO_PM = [1702,1707,1712,1717,1722,1727,1732,1737,1742,1747,1752,1757,1802,1807,1812,1817,1822,1827,1832,1837,1842,1847,1852,1857,1902,1907,1912,1918,1924,1930,1936,1942,1948,1954,2000,2006,2012,2018,2025,2032,2039,2046,2053,2100,2108,2116,2125,2135,2145,2155,2205,2220,2240];
  var WALK_AM = 13, WALK_PM = 12; // fallback walk minutes (no GPS)

  function toMin(t) { return Math.floor(t / 100) * 60 + (t % 100); }
  function ttStr(t) { return String(Math.floor(t / 100)).padStart(2, "0") + ":" + String(t % 100).padStart(2, "0"); }

  /* Next catchable trains for the current leg of the commute.
     Morning → Sōbu 下総中山→秋葉原; evening → Monorail 流通センター→浜松町. */
  function nextTrains(now) {
    now = now || new Date();
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var dow = now.getDay();
    if (dow === 0 || dow === 6) return { leg: null, note: "weekday timetable only" };
    var isAM = nowMin < 12 * 60;
    var tt = isAM ? SOBU_AM : MONO_PM;
    var walk = isAM ? WALK_AM : WALK_PM;
    var trains = [];
    for (var i = 0; i < tt.length && trains.length < 3; i++) {
      var m = toMin(tt[i]);
      if (m > nowMin + walk) trains.push({ time: ttStr(tt[i]), inMin: m - nowMin });
    }
    return {
      leg: isAM ? "sobu" : "monorail",
      label: isAM ? "総武線 下総中山→秋葉原" : "モノレール 流通センター→浜松町",
      walk: walk,
      trains: trains,
      note: trains.length ? null : "no more trains in timetable"
    };
  }

  /* ---------------- TRAINS: live delay status (ODPT) ---------------- */
  var LINES = {
    sobu: "odpt.Railway:JR-East.ChuoSobuLocal",
    yamanote: "odpt.Railway:JR-East.Yamanote",
    keihin: "odpt.Railway:JR-East.KeihinTohokuNegishi",
    monorail: "odpt.Railway:TokyoMonorail.HanedaAirportLine"
  };
  var LINE_NAMES = { sobu: "総武線", yamanote: "山手線", keihin: "京浜東北線", monorail: "モノレール" };
  var _delayCache = null, _delayFetched = 0, DELAY_TTL = 120000;

  function checkDelays() {
    if (_delayCache && Date.now() - _delayFetched < DELAY_TTL) return Promise.resolve(_delayCache);
    return fetch("https://api-public.odpt.org/api/v4/odpt:TrainInformation.json")
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) {
        var out = { sobu: { ok: true, text: "" }, yamanote: { ok: true, text: "" }, keihin: { ok: true, text: "" }, monorail: { ok: true, text: "" } };
        data.forEach(function (item) {
          var rail = item["odpt:railway"] || "";
          var status = item["odpt:trainInformationStatus"] || {};
          var text = item["odpt:trainInformationText"] || {};
          var statusJa = typeof status === "object" ? (status.ja || "") : (status || "");
          var textJa = typeof text === "object" ? (text.ja || "") : (text || "");
          var isNormal = !statusJa || statusJa.indexOf("平常") >= 0;
          for (var key in LINES) {
            if (rail === LINES[key] && !isNormal) out[key] = { ok: false, text: textJa || statusJa };
          }
        });
        _delayCache = out; _delayFetched = Date.now();
        return out;
      });
  }

  window.WF_FEEDS = {
    loadWeather: loadWeather,
    nextTrains: nextTrains,
    checkDelays: checkDelays,
    LINE_NAMES: LINE_NAMES
  };
})();
