/* Weekly Focus — v121: a tiny .zip writer (stored, no compression), used by the Code tab and the share page.
   WFZip.blob([{ path: "a/b.txt" | "a/" (folder), data: Uint8Array, u: ms }]) → Blob. Names are UTF-8 (flag 0x0800). */
(function () {
  "use strict";
  var CRC_T = null;
  function crc32(b) {
    if (!CRC_T) { CRC_T = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c >>> 0; } }
    var x = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) x = CRC_T[(x ^ b[i]) & 255] ^ (x >>> 8); return (x ^ 0xFFFFFFFF) >>> 0;
  }
  function dosTime(ms) {
    var d = new Date(ms || Date.now()); if (d.getFullYear() < 1980) d = new Date(1980, 0, 1);
    return { t: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), d: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
  }
  function zipBlob(entries) {
    var enc = new TextEncoder(), parts = [], central = [], off = 0;
    entries.forEach(function (e) {
      var nm = enc.encode(e.path), d = e.data || new Uint8Array(0), crc = crc32(d), t = dosTime(e.u);
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, t.t, true); h.setUint16(12, t.d, true); h.setUint32(14, crc, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true);
      h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
      parts.push(h.buffer, nm, d);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, t.t, true); c.setUint16(14, t.d, true); c.setUint32(16, crc, true); c.setUint32(20, d.length, true); c.setUint32(24, d.length, true);
      c.setUint16(28, nm.length, true); c.setUint16(30, 0, true); c.setUint16(32, 0, true); c.setUint16(34, 0, true); c.setUint16(36, 0, true);
      c.setUint32(38, /\/$/.test(e.path) ? 0x10 : 0, true); c.setUint32(42, off, true);
      central.push(c.buffer, nm); off += 30 + nm.length + d.length;
    });
    var cs = 0; central.forEach(function (x) { cs += x.byteLength; });
    var z = new DataView(new ArrayBuffer(22));
    z.setUint32(0, 0x06054b50, true); z.setUint16(8, entries.length, true); z.setUint16(10, entries.length, true); z.setUint32(12, cs, true); z.setUint32(16, off, true);
    return new Blob(parts.concat(central, [z.buffer]), { type: "application/zip" });
  }
  window.WFZip = { blob: zipBlob, crc32: crc32 };
})();
