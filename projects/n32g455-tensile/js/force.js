/* 滑块与力值输入框：演示用的"传感器"。
 *
 * 对外只给出一个有符号毫牛，测量、波形、校正都只读这个值。
 * 规则见《拉力计网页互动演示计划.md》第 6.1 节：
 *   - 滑块顶端 = +FS（拉伸），中点 = 0，底端 = -FS（压缩）
 *   - 松开后约 300 ms 回到 0
 *   - 输入框确认后保持该读数，直到清除、有效的 ZERO，或开始拖动滑块
 *   - 超过 ±FS 钳位
 */
(function (FG) {
  "use strict";

  var RETURN_MS = 300;        /* 松手回零时间 */
  var ZERO_ENTER_DIVISOR = 2000; /* 0.05% FS */
  var ZERO_EXIT_DIVISOR = 1000;  /* 0.1% FS */
  var ZERO_TARE_DIVISOR = 5;    /* 满量程 20% 以上不去皮 */

  function ForceInput(options) {
    this.fullScale = options.fullScale;
    this.simUnit = options.unit !== undefined ? options.unit : 0;
    this.onChange = options.onChange || function () { };
    this.onZeroTrack = options.onZeroTrack || function () { };
    this.onZeroEvent = options.onZeroEvent || function () { };

    this.value = 0;        /* 当前有符号毫牛 */
    this.held = null;      /* 输入框保持的读数，null 表示未保持 */
    this.dragging = false;
    this.returning = false;
    this.returnFrom = 0;
    this.returnStart = 0;
    this.atZero = true;    /* 零点回滞后的显示状态 */
  }

  ForceInput.prototype.setFullScale = function (fullScale) {
    if (fullScale > 0) {
      this.fullScale = fullScale;
    }
    this.clamp();
    if (this.held !== null) this.held = this.value;
  };

  ForceInput.prototype.setUnit = function (unit) {
    this.simUnit = unit;
    this.onChange();
  };

  ForceInput.prototype.clamp = function () {
    var fs = this.fullScale;
    if (this.value > fs) {
      this.value = fs;
      return true;
    }
    if (this.value < -fs) {
      this.value = -fs;
      return true;
    }
    return false;
  };

  ForceInput.prototype.get = function () {
    return this.value;
  };

  ForceInput.prototype.isHeld = function () {
    return this.held !== null;
  };

  /* 滑块位置 0（顶端，+FS）到 1（底端，-FS） */
  ForceInput.prototype.valueToRatio = function (value) {
    var fs = this.fullScale;
    if (fs <= 0) {
      return 0.5;
    }
    return (fs - value) / (2 * fs);
  };

  ForceInput.prototype.ratioToValue = function (ratio) {
    var r = Math.max(0, Math.min(1, ratio));
    return Math.round((1 - 2 * r) * this.fullScale);
  };

  /* 开始拖动：取消输入框保持，改由滑块接管 */
  ForceInput.prototype.beginDrag = function () {
    this.dragging = true;
    this.returning = false;
    this.held = null;
    this.onChange();
  };

  ForceInput.prototype.dragTo = function (ratio) {
    this.value = this.ratioToValue(ratio);
    this.clamp();
    this.onChange();
  };

  /* 松手：从当前值线性回到 0 */
  ForceInput.prototype.endDrag = function () {
    if (!this.dragging) {
      return;
    }
    this.dragging = false;
    if (this.value === 0) {
      this.returning = false;
    } else {
      this.returning = true;
      this.returnFrom = this.value;
      this.returnStart = FG.now();
      this.returnStep = Math.max(1,
        Math.ceil(Math.abs(this.returnFrom) * 16 / RETURN_MS));
    }
    this.onChange();
  };

  /* 每帧调用；返回 true 表示力值发生了变化 */
  ForceInput.prototype.tick = function () {
    var changed = false;
    if (this.returning) {
      var elapsed = FG.now() - this.returnStart;
      var step = this.returnStep || 1;
      if (elapsed >= RETURN_MS || Math.abs(this.value) <= step) {
        this.value = 0;
        this.returning = false;
      } else {
        this.value += (this.value > 0) ? -step : step;
      }
      changed = true;
    }
    if (this.updateZeroState()) {
      changed = true;
    }
    return changed;
  };

  /* 零点回滞：进入 |f| <= FS/2000，退出 |f| >= FS/1000 */
  ForceInput.prototype.updateZeroState = function () {
    var magnitude = Math.abs(this.value);
    var before = this.atZero;
    if (this.atZero) {
      if (magnitude >= this.fullScale / ZERO_EXIT_DIVISOR) {
        this.atZero = false;
      }
    } else {
      if (magnitude <= this.fullScale / ZERO_ENTER_DIVISOR) {
        this.atZero = true;
      }
    }
    if (before !== this.atZero) {
      this.onZeroTrack();
      return true;
    }
    return false;
  };

  /* 显示用力值：进入零点回滞后大字号显示 0 */
  ForceInput.prototype.getDisplayForce = function () {
    return this.atZero ? 0 : this.value;
  };

  /* 输入框确认：按当前显示单位解析，空串或非数字不改变当前力值 */
  ForceInput.prototype.holdValue = function (text, unit) {
    var parsed = FG.Unit.parseForce(text, unit);
    if (parsed === null) {
      return false;
    }
    var clamped = false;
    if (parsed > this.fullScale) {
      parsed = this.fullScale;
      clamped = true;
    } else if (parsed < -this.fullScale) {
      parsed = -this.fullScale;
      clamped = true;
    }
    this.held = parsed;
    this.value = parsed;
    this.returning = false;
    this.dragging = false;
    this.updateZeroState();
    this.onChange();
    return clamped ? "clamped" : true;
  };

  /* 清除保持并回到 0 */
  ForceInput.prototype.clearHold = function () {
    this.held = null;
    this.returning = false;
    this.value = 0;
    this.updateZeroState();
    this.onChange();
  };

  /*
   * ZERO：力值绝对值不超过 20% FS 时去皮、结束保持、滑块回中点。
   * 超过 20% FS 时不执行去皮，保持状态也不清除。
   * 返回 true 表示执行了去皮。
   */
  ForceInput.prototype.manualZero = function () {
    var magnitude = Math.abs(this.value);
    if (magnitude > this.fullScale / ZERO_TARE_DIVISOR) {
      return false;
    }
    this.held = null;
    this.value = 0;
    this.returning = false;
    this.atZero = true;
    this.onChange();
    this.onZeroEvent();
    return true;
  };

  /* 外部（如换量程档）重新按比例落位 */
  ForceInput.prototype.rebase = function (oldFullScale, newFullScale) {
    if (oldFullScale > 0 && newFullScale > 0) {
      var ratio = this.value / oldFullScale;
      this.value = Math.round(ratio * newFullScale);
    }
    this.fullScale = newFullScale;
    if (this.held !== null) {
      this.held = this.value;
    }
    this.clamp();
    this.onChange();
  };

  FG.ForceInput = ForceInput;
  FG.FORCE_ZERO_ENTER_DIVISOR = ZERO_ENTER_DIVISOR;
  FG.FORCE_ZERO_EXIT_DIVISOR = ZERO_EXIT_DIVISOR;
})(window.FG = window.FG || {});
