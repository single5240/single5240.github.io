/* app_button_test.c industry profile, algorithm v2. Negative press is mapped
 * to a positive magnitude by Tests. Browser input is synthetic, not ADC data. */
(function (FG) {
  "use strict";
  function ButtonTest() {
    this.state = 0; this.count = 0; this.fp = 0; this.fc = 0; this.fr = 0;
    this.valid = false; this.error = ""; this.history = [];
  }
  ButtonTest.prototype.enter = function (state, tick) {
    this.state = state; this.stateTick = tick; this.count = 0;
  };
  ButtonTest.prototype.confirm = function (condition) {
    this.count = condition ? this.count + 1 : 0;
    return this.count >= 8;
  };
  ButtonTest.prototype.fail = function (error) {
    this.error = error; this.state = 7; this.valid = false; return 2;
  };
  ButtonTest.prototype.addSample = function (force, start, tick, overload) {
    if (this.state >= 6) return 0;
    if (this.state > 0) {
      if (overload) return this.fail("OVERLOAD");
      if (tick - this.startTick >= 10000) return this.fail("TOTAL TIMEOUT");
      if (tick - this.stateTick >= 4000) return this.fail(["", "NO FP", "NO FC", "NO RELEASE", "NO FR", "TIMEOUT"][this.state]);
    }
    var threshold = function (reference) { return Math.max(100, Math.ceil(reference / 10)); };
    switch (this.state) {
      case 0:
        if (this.confirm(force > 0 && force >= start)) {
          this.startTick = tick; this.fpCandidate = force; this.enter(1, tick); return 1;
        }
        break;
      case 1:
        if (force > this.fpCandidate) { this.fpCandidate = force; this.count = 0; }
        if (this.confirm(this.fpCandidate - force >= threshold(this.fpCandidate))) {
          this.fp = this.fpCandidate; this.fcCandidate = force; this.enter(2, tick);
        }
        break;
      case 2:
        if (force < this.fcCandidate) { this.fcCandidate = force; this.count = 0; }
        if (this.confirm(force - this.fcCandidate >= threshold(this.fp))) {
          this.fc = this.fcCandidate; this.endCandidate = force; this.enter(3, tick);
        }
        break;
      case 3:
        if (force > this.endCandidate) { this.endCandidate = force; this.count = 0; }
        if (tick - this.stateTick < 50) { this.count = 0; break; }
        if (this.confirm(this.endCandidate - force >= threshold(this.endCandidate))) {
          this.frCandidate = force; this.history = []; this.returnTick = null; this.enter(4, tick);
        }
        break;
      case 4:
        if (force < this.frCandidate) { this.frCandidate = force; this.history = []; }
        this.history.push(force - this.frCandidate >= threshold(this.fp) ? 1 : 0);
        if (this.history.length > 8) this.history.shift();
        if (this.history.reduce(function (sum, n) { return sum + n; }, 0) >= 5) {
          this.fr = this.frCandidate; this.postFrPeak = force; this.extraValley = force;
          this.extraDropSeen = false; this.enter(5, tick);
        } else if (force >= 0 && force <= 150) {
          if (this.returnTick === null) this.returnTick = tick;
          else if (tick - this.returnTick >= 20) return this.fail("NO FR");
        } else this.returnTick = null;
        break;
      case 5:
        if (tick - this.stateTick >= 50) {
          if (!this.extraDropSeen) {
            this.postFrPeak = Math.max(this.postFrPeak, force);
            if (this.postFrPeak - force >= threshold(this.postFrPeak)) {
              this.extraDropSeen = true; this.extraValley = force;
            }
          } else {
            this.extraValley = Math.min(this.extraValley, force);
            if (force >= this.fp && force - this.extraValley >= threshold(this.fp)) return this.fail("MULTI CLICK");
          }
        }
        if (this.confirm(force >= 0 && force <= 150)) {
          if (this.fp <= 0 || this.fc < 0 || this.fr < 0 || this.fc > this.fp || this.fr > this.fp) return this.fail("FORMULA");
          this.cc = Math.floor(((this.fp - this.fc) * 1000 + this.fp / 2) / this.fp);
          this.cr = Math.floor(((this.fp - this.fr) * 1000 + this.fp / 2) / this.fp);
          this.valid = true; this.state = 6; return 2;
        }
        break;
    }
    return 0;
  };
  FG.ButtonTest = ButtonTest;
})(window.FG = window.FG || {});
