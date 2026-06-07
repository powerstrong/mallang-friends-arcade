/* SquadModel — 부대 상태(수 vs 질의 핵심 모델)
 *
 * 설계 전제(스펙 리뷰 핵심): DPS = 머릿수 × 화력 로 두면 항상 큰 수가 정답이라
 * "선택 긴장"이 죽는다. 그래서 **동시 사격 사수 상한(SHOOTER_CAP)**을 둔다.
 *   - 화력(dps)에 기여하는 건 상한까지의 유닛뿐.
 *   - 상한을 넘는 잉여 유닛은 화력이 아니라 "맞아도 버티는 체력(피해 흡수)"이 된다.
 *   → 머릿수(생존) vs 화력(돌파)이 자연히 갈린다.
 * amount는 내부적으로 실수 허용(보스 드레인 등). 사수/표시에선 정수화. */
(function (global) {
  var SHOOTER_CAP = 12;
  var DMG_PER_SHOOTER = 7; // 화력 1, 사수 1당 초당 데미지

  function SquadModel(amount, power) {
    this.amount = amount;
    this.power = power;
  }
  SquadModel.prototype.count = function () { return Math.max(0, Math.round(this.amount)); };
  SquadModel.prototype.activeShooters = function () {
    return Math.min(Math.floor(this.amount), SHOOTER_CAP);
  };
  SquadModel.prototype.dps = function () {
    return this.activeShooters() * this.power * DMG_PER_SHOOTER;
  };
  SquadModel.prototype.add = function (n) { this.amount = Math.max(0, this.amount + n); };
  SquadModel.prototype.mul = function (f) { this.amount = Math.max(0, Math.round(this.amount * f)); };
  SquadModel.prototype.lose = function (n) { this.amount = Math.max(0, this.amount - n); };
  SquadModel.prototype.addPower = function (n) { this.power += n; };

  /* 부대 포메이션 오프셋: 대장 중심으로 위(적 방향)로 쌓이는 둥근 블록.
   * 반환 = [{dx, dy}, ...] (대장 기준 상대좌표). */
  function formation(n) {
    var out = [];
    var perRow = Math.min(7, Math.max(1, Math.ceil(Math.sqrt(n * 1.3))));
    var sp = 24;
    for (var i = 0; i < n; i++) {
      var row = Math.floor(i / perRow);
      var col = i % perRow;
      var cnt = Math.min(perRow, n - row * perRow);
      out.push({ dx: (col - (cnt - 1) / 2) * sp, dy: -row * sp * 0.82 });
    }
    return out;
  }

  global.SquadModel = SquadModel;
  global.MAR_SHOOTER_CAP = SHOOTER_CAP;
  global.MARFormation = formation;
})(window);
