(function(root, factory) {
  var api = factory(
    typeof require === "function" ? require("../engine/friends.js") : root.MallangIdleFriends,
    typeof require === "function" ? require("../engine/balance.js") : root.MallangIdleBalance,
    typeof require === "function" ? require("./companions.js") : root.MallangIdleCompanions
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MallangIdleAchievements = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function(Friends, Bal, Companions) {
  var B = Bal.BALANCE;
  var ALL = [
    { id: "egg", name: "첫 만남", test: (s) => s.hatch.count >= B.achievements.firstHatchCount },
    { id: "three", name: "옹기종기", test: (s) => s.hatch.owned.length >= B.achievements.collectionCount },
    { id: "six", name: "모두의 친구", test: (s) => s.hatch.owned.length >= Companions.length },
    { id: "star", name: "반짝 마음", test: (s) => Object.values(s.friends.levels).some((lv) => Friends.stars(lv) >= B.achievements.starCount) },
    { id: "thirty", name: "씩씩한 발걸음", test: (s) => s.safeStage >= B.achievements.clearStage },
    { id: "ten", name: "별빛 산책가", test: (s) => s.dungeon && s.dungeon.best >= B.achievements.trialBest }
  ];
  function claim(s, id) {
    var a = ALL.find((a2) => a2.id === id);
    if (!a || !a.test(s) || s.achievementClaimed[id]) return false;
    s.achievementClaimed[id] = true;
    return true;
  }
  return { ALL, claim };
});
