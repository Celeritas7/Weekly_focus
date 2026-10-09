/* Weekly Focus — v98.6 Code tab: small, fast syntax highlighter (no libraries).
   WFCodeHL.lines(code, lang) → array of HTML strings, one per source line (tokens split at newlines). */
(function () {
  "use strict";
  var DQ = /"(?:[^"\\\n]|\\.)*"/.source, SQ = /'(?:[^'\\\n]|\\.)*'/.source, BT = /`(?:[^`\\]|\\[\s\S])*`/.source;
  var SL = /\/\/[^\n]*/.source, BL = /\/\*[\s\S]*?\*\//.source;
  var NUM = /\b(?:0x[\da-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/.source;
  var FN = /[A-Za-z_$][\w$]*(?=\s*\()/.source;
  function kw(s) { return "\\b(?:" + s.trim().split(/\s+/).join("|") + ")\\b"; }
  var K = {
    js: "break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return super switch this throw try typeof var void while with yield async await of static get set null undefined true false",
    ts: "interface type enum implements private public protected readonly declare namespace abstract as any number string boolean unknown never keyof",
    java: "abstract boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public return short static super switch synchronized this throw throws try void volatile while true false null var",
    cs: "abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while var async await",
    py: "False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield self",
    sh: "if then else elif fi for while do done case esac in function return local export echo cd set unset exit source alias read",
    sql: "select from where and or not insert into values update set delete create table alter drop index view on join left right inner outer full cross group by order having limit offset as distinct union all exists in is null like ilike between case when then else end primary key foreign references default unique check constraint begin commit rollback grant revoke to with returning function returns language security definer trigger before after for each row execute procedure policy using enable disable level if replace cascade asc desc true false declare"
  };
  var DEF = {
    JavaScript: [["com", SL + "|" + BL], ["str", DQ + "|" + SQ + "|" + BT], ["kw", kw(K.js)], ["num", NUM], ["fn", FN]],
    TypeScript: [["com", SL + "|" + BL], ["str", DQ + "|" + SQ + "|" + BT], ["kw", kw(K.js + " " + K.ts)], ["num", NUM], ["fn", FN]],
    Java: [["com", SL + "|" + BL], ["str", DQ + "|" + SQ], ["kw", kw(K.java)], ["num", NUM], ["fn", FN]],
    "C#": [["com", SL + "|" + BL], ["str", DQ + "|" + SQ], ["kw", kw(K.cs)], ["num", NUM], ["fn", FN]],
    Python: [["com", /#[^\n]*/.source], ["str", /"""[\s\S]*?"""|'''[\s\S]*?'''/.source + "|" + DQ + "|" + SQ], ["kw", kw(K.py)], ["num", NUM], ["fn", FN]],
    Shell: [["com", /(?<![\w$])#[^\n]*/.source], ["str", DQ + "|" + SQ], ["var", /\$\{?[\w@#?*!]+\}?/.source], ["kw", kw(K.sh)], ["num", NUM]],
    SQL: [["com", /--[^\n]*/.source + "|" + BL], ["str", /'(?:[^']|'')*'/.source], ["kw", kw(K.sql)], ["num", NUM]],
    CSS: [["com", BL], ["str", DQ + "|" + SQ], ["kw", /@[\w-]+|!important/.source], ["num", /#[\da-fA-F]{3,8}\b|(?<![\w-])-?\d*\.?\d+(?:px|em|rem|vh|vw|vmin|vmax|ms|s|deg|fr|%)?/.source], ["attr", /[\w-]+(?=\s*:[^:{;\n]*[;}\n])/.source]],
    JSON: [["attr", DQ + /(?=\s*:)/.source], ["str", DQ], ["kw", /\b(?:true|false|null)\b/.source], ["num", /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/.source]],
    HTML: [["com", /<!--[\s\S]*?-->/.source], ["tag", /<\/?[A-Za-z][\w:-]*|\/?>/.source], ["attr", /[\w:-]+(?=\s*=\s*["'])/.source], ["str", /(?<==\s*)(?:"[^"\n]*"|'[^'\n]*')/.source]]
  };
  var RX = {};
  function rx(lang) {
    if (!DEF[lang]) return null;
    if (!RX[lang]) RX[lang] = { re: new RegExp(DEF[lang].map(function (r) { return "(" + r[1] + ")"; }).join("|"), lang === "SQL" ? "gi" : "g"), types: DEF[lang].map(function (r) { return r[0]; }) };
    return RX[lang];
  }
  function esc(s) { return s.replace(/[&<>]/g, function (c) { return c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"; }); }
  function lines(code, lang) {
    var out = [], cur = "", R = rx(lang);
    function emit(type, text) {
      var parts = text.split("\n");
      for (var i = 0; i < parts.length; i++) {
        if (i) { out.push(cur); cur = ""; }
        if (parts[i]) cur += type ? '<span class="hl-' + type + '">' + esc(parts[i]) + "</span>" : esc(parts[i]);
      }
    }
    if (!R) { emit("", code); out.push(cur); return out; }
    var re = R.re, last = 0, m; re.lastIndex = 0;
    while ((m = re.exec(code))) {
      if (m[0] === "") { re.lastIndex++; continue; }
      if (m.index > last) emit("", code.slice(last, m.index));
      var t = ""; for (var g = 1; g < m.length; g++) if (m[g] !== undefined) { t = R.types[g - 1]; break; }
      emit(t, m[0]); last = re.lastIndex;
    }
    if (last < code.length) emit("", code.slice(last));
    out.push(cur); return out;
  }
  var EXT = { js: "JavaScript", mjs: "JavaScript", cjs: "JavaScript", jsx: "JavaScript", ts: "TypeScript", tsx: "TypeScript", py: "Python", sql: "SQL", html: "HTML", htm: "HTML", xml: "HTML", svg: "HTML", vue: "HTML", css: "CSS", scss: "CSS", less: "CSS", json: "JSON", webmanifest: "JSON", sh: "Shell", bash: "Shell", zsh: "Shell", bat: "Shell", cmd: "Shell", ps1: "Shell", java: "Java", kt: "Java", cs: "C#" };
  function langFromName(n) { var m = /\.([\w]+)$/.exec(n || ""); return (m && EXT[m[1].toLowerCase()]) || "Text"; }
  window.WFCodeHL = { lines: lines, langFromName: langFromName };
})();
