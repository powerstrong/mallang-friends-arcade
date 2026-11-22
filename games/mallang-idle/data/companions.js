(function(root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MallangIdleCompanions = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  return [
    { id: "acorn", name: "도토리", art: "assets/mob-acorn.png" },
    { id: "jelly", name: "젤리", art: "assets/mob-jelly.png" },
    { id: "cloud", name: "구름", art: "assets/mob-cloudpuff.png" },
    { id: "mouse", name: "태엽 생쥐", art: "assets/mob-springmouse.png" },
    { id: "fairy", name: "꽃 요정", art: "assets/mob-petalfairy.png" },
    { id: "star", name: "별똥 아기", art: "assets/mob-stardrop.png" }
  ];
});
