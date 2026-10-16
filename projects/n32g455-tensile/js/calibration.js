/* 校正：密码、量程与方向、六点采集、放弃确认、结果。
 *
 * 行为对照 N32G455/APP/app_calibration.c：
 *   - 密码 4 位，默认 0000，本次运行验证通过后不再询问
 *   - 六个点目标值 = 满量程 * 点序号 / 5，拉伸取正、压缩取负
 *   - 每点稳定窗口 200 ms，容差 ±0.5% FS（APP_CAL_STABLE_TOLERANCE_PERMILLE = 5）
 *   - 点序号大于 0 时原始码必须比第 0 点和上一点更远离零点（方向检查）
 * 网页没有 AD7190，用"演示 ADC"：一个与固件默认零点同量级的基准码，拉伸加、
 * 压缩减与模拟毫牛成比例的增量。不是计量校准。
 */
(function (FG) {
  "use strict";

  var STATE = {
    PASSWORD: 0, SELECT: 1, WAIT_STABLE: 2, ABORT_CONFIRM: 3,
    SAVING: 4, RESULT_SUCCESS: 5, RESULT_FAILED: 6, DIRECTION: 7
  };
  var DIRECTION = { TENSION: 0, COMPRESSION: 1 };
  var ERROR = {
    NONE: 0, PASSWORD: 1, NO_SAMPLE: 2, ADC: 3, UNSTABLE: 4,
    DIRECTION: 5, POINT: 6, OVER_RANGE: 7, SAVE: 8
  };
  var EVENT = { MENU: 0, PREVIOUS: 1, NEXT: 2, ZERO: 3, CONFIRM: 4 };

  var PASSWORD_DIGITS = 4;
  var POINT_COUNT = 6;
  var STABLE_TIME_MS = 200;
  var STABLE_TOLERANCE_PERMILLE = 5;
  var SAVE_SETTLE_MS = 100;
  var SELECT_ITEM_COUNT = 3;

  var DEFAULT_PASSWORD = [0, 0, 0, 0];

  /* 演示 ADC 基准码：与固件 AD7190 的零点量级同阶，具体数值只用于演示 */
  var FAKE_ADC_ZERO = 8388608;
  var FAKE_ADC_PER_NEWTON = 2048;

  function Calibration(options) {
    this.getForce = options.getForce;           /* 返回模拟毫牛 */
    this.getRangeIndex = options.getRangeIndex; /* 当前量程档 */
    this.getFullScale = options.getFullScale;
    this.setRangeIndex = options.setRangeIndex;
    this.onSave = options.onSave || function () { return true; };
    this.onBeep = options.onBeep || function () { };
    this.beeped = options.onBeep || function () { };

    this.view = {
      state: STATE.PASSWORD,
      direction: DIRECTION.TENSION,
      layer: 0,
      directionFocus: 0,
      error: ERROR.NONE,
      password: DEFAULT_PASSWORD.slice(),
      passwordCursor: 0,
      selectFocus: 0,
      rangeEditing: 0,
      rangeIndex: this.getRangeIndex(),
      pointIndex: 0,
      stable: 0,
      tensionCalibrated: 0,
      compressionCalibrated: 0,
      actualForceMillinewton: 0,
      targetForceMillinewton: 0,
      stableAverageRaw: 0
    };

    this.points = new Array(POINT_COUNT);
    this.capturedCount = 0;
    this.windowStartTick = 0;
    this.windowSampleCount = 0;
    this.windowRawSum = 0;
    this.windowMinRaw = 0;
    this.windowMaxRaw = 0;
    this.saveTick = 0;
    this.verified = false;
    var stored = FG.Storage.loadSettings();
    this.saved = stored && this.validImage(stored.calibration) ? stored.calibration : null;
  }

  Calibration.prototype.validImage = function (image) {
    if (!image || !Number.isInteger(image.rangeIndex) || image.rangeIndex < 0 ||
        image.rangeIndex >= FG.FORCE_RANGES.length) return false;
    for (var d = 0; d < 4; d++) {
      var points = image[["tension", "compression", "tensionSmall", "compressionSmall"][d]];
      if (points === null || points === undefined) continue;
      if (!Array.isArray(points) || points.length !== POINT_COUNT) return false;
      for (var i = 0; i < POINT_COUNT; i++) {
        if (!Number.isInteger(points[i]) || points[i] < 0 || points[i] > 0xffffff) return false;
        if (i && (d % 2 === 0 ? points[i] <= points[i - 1] : points[i] >= points[i - 1])) return false;
      }
    }
    return !!(image.tension || image.compression || image.tensionSmall || image.compressionSmall) &&
      (!image.tension || !image.compression || image.tension[0] === image.compression[0]);
  };

  Calibration.prototype.updateDirectionStatus = function () {
    var saved = this.saved;
    var matches = saved && saved.rangeIndex === this.view.rangeIndex;
    this.view.tensionCalibrated = matches && saved.tension ? 1 : 0;
    this.view.compressionCalibrated = matches && saved.compression ? 1 : 0;
    this.view.tensionSmallCalibrated = matches && saved.tensionSmall ? 1 : 0;
    this.view.compressionSmallCalibrated = matches && saved.compressionSmall ? 1 : 0;
  };

  /* Piecewise interpolation uses only the committed image, never partial points. */
  Calibration.prototype.convertRaw = function (raw, rangeIndex) {
    var saved = this.saved;
    if (!saved || saved.rangeIndex !== rangeIndex) return this.millinewtonFromRaw(raw);
    var zero = (saved.tension || saved.compression || [FAKE_ADC_ZERO])[0];
    var positive = raw >= zero;
    var points = positive ? saved.tension : saved.compression;
    if (!points) return Math.round((raw - zero) * 1000 / FAKE_ADC_PER_NEWTON);
    var small = positive ? saved.tensionSmall : saved.compressionSmall;
    var segments = 5;
    if (small) {
      var derived = [];
      for (var a = 0; a < 5; a++) {
        for (var b = 0; b < 5; b++) {
          var offset = (small[b] - small[0]) * (points[a + 1] - points[a]) / (small[5] - small[0]);
          derived.push(points[a] + (offset < 0 ? -Math.round(-offset) : Math.round(offset)));
        }
      }
      derived.push(points[5]);
      if (derived.every(function(v,i) { return !i || (positive ? v > derived[i-1] : v < derived[i-1]); })) {
        points = derived; segments = 25;
      }
    }
    raw = positive ? Math.min(raw, points[segments]) : Math.max(raw, points[segments]);
    var segment = 1;
    while (segment < segments && (positive ? raw > points[segment] : raw < points[segment])) segment++;
    var fs = this.getFullScale(rangeIndex);
    var low = Math.trunc(fs * (segment - 1) / segments);
    var high = Math.trunc(fs * segment / segments);
    var value = low + (raw - points[segment - 1]) * (high - low) /
      (points[segment] - points[segment - 1]);
    return Math.trunc(positive ? value : -value);
  };

  Calibration.prototype.enter = function () {
    this.view.state = this.verified ? STATE.SELECT : STATE.PASSWORD;
    this.view.error = ERROR.NONE;
    this.view.password = DEFAULT_PASSWORD.slice();
    this.view.passwordCursor = 0;
    this.view.selectFocus = 0;
    this.view.layer = 0;
    this.view.directionFocus = 0;
    this.view.rangeEditing = 0;
    this.view.rangeIndex = this.getRangeIndex();
    this.updateDirectionStatus();
    this.updateTarget();
  };

  Calibration.prototype.updateTarget = function () {
    var fullScale = this.getFullScale(this.view.rangeIndex);
    var target = Math.trunc((fullScale * this.view.pointIndex) / (this.view.layer ? 25 : 5));
    this.view.targetForceMillinewton =
      (this.view.direction === DIRECTION.TENSION) ? target : -target;
  };

  Calibration.prototype.startDirection = function (direction) {
    this.points = new Array(POINT_COUNT);
    this.capturedCount = 0;
    this.view.direction = direction;
    this.view.pointIndex = 0;
    this.view.error = ERROR.NONE;
    this.view.actualForceMillinewton = 0;
    this.view.stable = 0;
    this.view.state = STATE.WAIT_STABLE;
    this.resetWindow();
    this.updateTarget();
  };

  Calibration.prototype.resetWindow = function () {
    this.windowSampleCount = 0;
    this.windowRawSum = 0;
    this.windowMinRaw = 0;
    this.windowMaxRaw = 0;
    this.windowStartTick = 0;
    this.view.stable = 0;
  };

  /* 演示 ADC：把模拟毫牛换成原始码 */
  Calibration.prototype.rawFromMillinewton = function (millinewton) {
    return FAKE_ADC_ZERO + Math.round(millinewton * FAKE_ADC_PER_NEWTON / 1000);
  };

  /* 原始码换回力值，用于页面显示和稳定判定 */
  Calibration.prototype.millinewtonFromRaw = function (raw) {
    return Math.round((raw - FAKE_ADC_ZERO) * 1000 / FAKE_ADC_PER_NEWTON);
  };

  Calibration.prototype.pointDirectionIsValid = function (raw) {
    var point = this.view.pointIndex;
    if (point === 0) {
      return true;
    }
    if (this.view.direction === DIRECTION.TENSION) {
      return raw > this.points[0] && raw > this.points[point - 1];
    }
    return raw < this.points[0] && raw < this.points[point - 1];
  };

  /* 每个采样点调用一次 */
  Calibration.prototype.processSample = function (tick) {
    if (this.view.state !== STATE.WAIT_STABLE) {
      return;
    }
    var raw = this.rawFromMillinewton(this.getForce());
    var actual = this.convertRaw(raw, this.view.rangeIndex);
    this.view.actualForceMillinewton = actual;
    var fullScale = this.getFullScale(this.view.rangeIndex);
    var tolerance = Math.trunc(fullScale * STABLE_TOLERANCE_PERMILLE / 1000);

    if (!Number.isInteger(raw) || raw < 0 || raw > 0xffffff) {
      this.view.error = ERROR.ADC;
      this.resetWindow();
      return;
    }
    if (Math.abs(actual) > fullScale) {
      this.view.error = ERROR.OVER_RANGE;
      this.resetWindow();
      return;
    }
    if (!this.pointDirectionIsValid(raw)) {
      this.view.error = ERROR.DIRECTION;
      this.resetWindow();
      return;
    }

    if (this.view.stable !== 0) {
      /* 已经稳定：偏离稳定均值超过容差就重新开始 */
      var averageForce = this.convertRaw(this.view.stableAverageRaw, this.view.rangeIndex);
      if (Math.abs(actual - averageForce) > tolerance) {
        this.view.error = ERROR.UNSTABLE;
        this.view.stable = 0;
        this.resetWindow();
      }
      return;
    }

    if (this.windowSampleCount === 0) {
      this.windowStartTick = tick;
      this.windowMinRaw = raw;
      this.windowMaxRaw = raw;
    }
    this.windowRawSum += raw;
    this.windowSampleCount++;
    if (raw < this.windowMinRaw) this.windowMinRaw = raw;
    if (raw > this.windowMaxRaw) this.windowMaxRaw = raw;

    if ((tick - this.windowStartTick) < STABLE_TIME_MS) {
      return;
    }

    var averageRaw = Math.floor(this.windowRawSum / this.windowSampleCount);
    var minForce = this.convertRaw(this.windowMinRaw, this.view.rangeIndex);
    var maxForce = this.convertRaw(this.windowMaxRaw, this.view.rangeIndex);
    var average = this.convertRaw(averageRaw, this.view.rangeIndex);

    if ((average - minForce) > tolerance || (maxForce - average) > tolerance) {
      this.view.error = ERROR.UNSTABLE;
      this.resetWindow();
      return;
    }

    this.view.stableAverageRaw = averageRaw;
    this.view.stable = 1;
    this.view.error = ERROR.NONE;
  };

  /* 非阻塞的保存结算 */
  Calibration.prototype.process = function (tick) {
    this.processSample(tick);
    if (this.view.state === STATE.SAVING && (tick - this.saveTick) >= SAVE_SETTLE_MS) {
      this.commit();
    }
  };

  Calibration.prototype.validateCandidate = function () {
    if (this.capturedCount !== POINT_COUNT) {
      return false;
    }
    for (var i = 1; i < POINT_COUNT; i++) {
      if (this.view.direction === DIRECTION.TENSION) {
        if (!(this.points[i] > this.points[0]) || !(this.points[i] > this.points[i - 1])) {
          return false;
        }
      } else {
        if (!(this.points[i] < this.points[0]) || !(this.points[i] < this.points[i - 1])) {
          return false;
        }
      }
    }
    return true;
  };

  Calibration.prototype.commit = function () {
    if (!this.validateCandidate()) {
      this.view.error = ERROR.POINT;
      this.view.state = STATE.RESULT_FAILED;
      return;
    }
    var candidate = {
      rangeIndex: this.view.rangeIndex, tension: null, compression: null,
      tensionSmall: null, compressionSmall: null
    };
    if (this.saved && this.saved.rangeIndex === candidate.rangeIndex) {
      candidate.tension = this.saved.tension && this.saved.tension.slice();
      candidate.compression = this.saved.compression && this.saved.compression.slice();
      candidate.tensionSmall = this.saved.tensionSmall && this.saved.tensionSmall.slice();
      candidate.compressionSmall = this.saved.compressionSmall && this.saved.compressionSmall.slice();
    }
    var key = (this.view.direction === DIRECTION.TENSION ? "tension" : "compression") + (this.view.layer ? "Small" : "");
    candidate[key] = this.points.slice();
    if (!this.view.layer) {
      if (candidate.tension) candidate.tension[0] = this.points[0];
      if (candidate.compression) candidate.compression[0] = this.points[0];
    }
    if (!this.validImage(candidate)) {
      this.view.error = ERROR.POINT;
      this.view.state = STATE.RESULT_FAILED;
      return;
    }
    var ok = this.onSave(candidate);
    if (!ok) {
      this.view.error = ERROR.SAVE;
      this.view.state = STATE.RESULT_FAILED;
      return;
    }
    this.saved = candidate;
    this.updateDirectionStatus();
    this.view.error = ERROR.NONE;
    this.view.state = STATE.RESULT_SUCCESS;
  };

  Calibration.prototype.handleEvent = function (event, tick) {
    var view = this.view;
    switch (view.state) {
      case STATE.PASSWORD:
        if (event === EVENT.MENU) {
          return true;
        }
        if (event === EVENT.ZERO) {
          view.passwordCursor = (view.passwordCursor + PASSWORD_DIGITS - 1) % PASSWORD_DIGITS;
          view.error = ERROR.NONE;
          return false;
        }
        if (event === EVENT.PREVIOUS) {
          view.password[view.passwordCursor] =
            (view.password[view.passwordCursor] + 1) % 10;
          view.error = ERROR.NONE;
          return false;
        }
        if (event === EVENT.NEXT) {
          view.passwordCursor = (view.passwordCursor + 1) % PASSWORD_DIGITS;
          view.error = ERROR.NONE;
          return false;
        }
        if (event === EVENT.CONFIRM) {
          var ok = true;
          for (var i = 0; i < PASSWORD_DIGITS; i++) {
            if (view.password[i] !== DEFAULT_PASSWORD[i]) {
              ok = false;
            }
          }
          if (ok) {
            this.verified = true;
            view.error = ERROR.NONE;
            view.state = STATE.SELECT;
          } else {
            view.error = ERROR.PASSWORD;
          }
          return false;
        }
        return false;

      case STATE.SELECT:
        if (event === EVENT.MENU) {
          if (view.rangeEditing) {
            view.rangeIndex = this.rangeBeforeEdit;
            view.rangeEditing = 0;
            this.updateDirectionStatus();
            return false;
          }
          return true;
        }
        if (event === EVENT.PREVIOUS || event === EVENT.NEXT) {
          var delta = (event === EVENT.PREVIOUS) ? -1 : 1;
          if (view.rangeEditing !== 0) {
            var count = this.getRangeCount();
            view.rangeIndex = ((view.rangeIndex + count + delta) % count);
            this.updateTarget();
            this.updateDirectionStatus();
          } else {
            view.selectFocus = (view.selectFocus + SELECT_ITEM_COUNT + delta) % SELECT_ITEM_COUNT;
          }
          return false;
        }
        if (event === EVENT.CONFIRM) {
          if (view.selectFocus === 0) {
            if (view.rangeEditing === 0) {
              this.rangeBeforeEdit = view.rangeIndex;
              view.rangeEditing = 1;
            } else {
              view.rangeEditing = 0;
            }
            return false;
          }
          if (view.selectFocus === 1) {
            view.layer = 0;
          }
          if (view.selectFocus === 2) {
            view.layer = 1;
          }
          view.directionFocus = 0;
          view.state = STATE.DIRECTION;
          return false;
        }
        return false;

      case STATE.DIRECTION:
        if (event === EVENT.MENU) view.state = STATE.SELECT;
        if (event === EVENT.PREVIOUS || event === EVENT.NEXT) view.directionFocus = 1 - view.directionFocus;
        if (event === EVENT.CONFIRM) this.startDirection(view.directionFocus);
        return false;

      case STATE.WAIT_STABLE:
        if (event === EVENT.MENU) {
          view.state = STATE.ABORT_CONFIRM;
          return false;
        }
        if (event === EVENT.CONFIRM) {
          this.processSample(tick);
          if (view.stable === 0) {
            view.error = ERROR.UNSTABLE;
            return false;
          }
          if (!this.pointDirectionIsValid(view.stableAverageRaw)) {
            view.error = ERROR.POINT;
            return false;
          }
          this.points[view.pointIndex] = view.stableAverageRaw;
          this.capturedCount++;
          if (view.pointIndex >= (POINT_COUNT - 1)) {
            view.state = STATE.SAVING;
            this.saveTick = tick;
          } else {
            view.pointIndex++;
            view.stable = 0;
            view.error = ERROR.NONE;
            this.resetWindow();
            this.updateTarget();
          }
          return false;
        }
        return false;

      case STATE.ABORT_CONFIRM:
        if (event === EVENT.CONFIRM) {
          this.capturedCount = 0;
          view.state = STATE.DIRECTION;
          view.error = ERROR.NONE;
          return false;
        }
        if (event === EVENT.MENU) {
          view.state = STATE.WAIT_STABLE;
          this.resetWindow();
          return false;
        }
        return false;

      case STATE.RESULT_SUCCESS:
      case STATE.RESULT_FAILED:
        if (event === EVENT.CONFIRM || event === EVENT.MENU) {
          view.state = STATE.DIRECTION;
          view.rangeIndex = this.getRangeIndex();
          this.updateDirectionStatus();
          return false;
        }
        return false;

      case STATE.SAVING:
      default:
        return false;
    }
  };

  Calibration.prototype.getRangeCount = function () {
    this.rangeCount = this.rangeCount || FG.FORCE_RANGES.length;
    return this.rangeCount;
  };

  Calibration.prototype.getSnapshot = function () {
    return this.view;
  };

  FG.Calibration = Calibration;
  FG.CAL_STATE = STATE;
  FG.CAL_DIRECTION = DIRECTION;
  FG.CAL_ERROR = ERROR;
  FG.CAL_EVENT = EVENT;
  FG.APP_CAL_POINT_COUNT = POINT_COUNT;
  FG.APP_CAL_PASSWORD_DIGITS = PASSWORD_DIGITS;
  FG.APP_CAL_STABLE_TIME_MS = STABLE_TIME_MS;
  FG.APP_CAL_STABLE_TOLERANCE_PERMILLE = STABLE_TOLERANCE_PERMILLE;
})(window.FG = window.FG || {});
