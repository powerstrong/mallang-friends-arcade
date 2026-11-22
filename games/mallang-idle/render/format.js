(function(root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MallangIdleFormat = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  "use strict";
  var UNITS = ["", "만", "억", "조", "경", "해", "자", "양", "구", "간", "정"];
  function format(n, ceil) {
    if (!Number.isFinite(n)) return "아주 많아요";
    n = Math.max(0, ceil ? Math.ceil(n) : n);
    if (n < 1e4) return String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var u = Math.min(UNITS.length - 1, Math.floor(Math.log10(n) / 4)), v = n / Math.pow(1e4, u);
    var x = (ceil ? Math.ceil(v * 100) : Math.floor(v * 100)) / 100;
    if (x >= 1e4 && u < UNITS.length - 1) {
      x = x / 1e4;
      u++;
    }
    return String(x) + UNITS[u];
  }
  return { number: function(n) {
    return format(n, false);
  }, cost: function(n) {
    return format(n, true);
  } };
});
