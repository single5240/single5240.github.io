/* 设置项：字段、档位、格式化与调整，对照 N32G455/APP/app_settings.c。
 *
 * 只保留浏览器里能生效的部分：格式化和调整规则逐条复刻，EEPROM 双槽提交换成
 * localStorage。额定量程按源码处理成"基本设定只读，改量程走校正页"。
 */
(function (FG) {
  "use strict";

  var ID = {
    TEST_MODE: 0, TEST_ACTION: 1, SAMPLE_RATE: 2, TRANSFER_RATE: 3, AUTO_ZERO: 4,
    AUTO_ZERO_DELAY: 5, TOLERANCE: 6, FORCE_RANGE: 7, START_FORCE: 8, GRAVITY: 9,
    AUTO_SLEEP: 10, EXT_FUNC: 11, LOAD_LIMIT: 12, POLARITY: 13, SCREEN_DIR: 14,
    LANGUAGE: 15, FACTORY_RESET: 16, CHART_DIR: 17, CHART_WINDOW: 18,
    POWER_OFF: 19, OUTPUT: 20, BAUD: 21, DATA_BITS: 22, STOP_BITS: 23,
    PARITY: 24, STORAGE_LIST: 25, TIME_DISPLAY: 26, AUTO_STORE: 27,
    DATA_SORT: 28, STORAGE_LINK: 29, CAL_AUTH: 30, CAL_ENTER: 31,
    CAL_SEGMENT: 32, CAL_SETPOINT: 33, CAL_ACTUAL: 34, BACKLIGHT: 35,
    WAVEFORM: 36, BUTTON_RESULT: 37, COUNT: 38
  };

  var KIND = { ENUM: 0, UINT: 1, FIXED: 2, ACTION: 3, TOLERANCE: 4 };

  var GRAVITY_MIN_X1000 = 9700;
  var GRAVITY_MAX_X1000 = 9900;
  var GRAVITY_DEFAULT_X1000 = 9807;
  var AUTO_ZERO_DELAY_MIN_S = 1;
  var AUTO_ZERO_DELAY_MAX_S = 9;
  var START_FORCE_MIN_MN = 10;
  var START_FORCE_STEP_MN = 100;
  var START_FORCE_DEFAULT_MN = 200;
  var CHART_WINDOW_MAX_S = 99;
  var CHART_WINDOW_DEFAULT_S = 10;

  var FORCE_RANGES = [
    { kg: 2, mn: 19613 },
    { kg: 5, mn: 49033 },
    { kg: 10, mn: 98067 },
    { kg: 20, mn: 196133 },
    { kg: 50, mn: 490333 },
    { kg: 100, mn: 980665 }
  ];

  var TEST_MODE = { REALTIME: 0, PEAK: 1, COUNT: 2 };
  var FORCE_UNIT = FG.Unit.UNIT;

  /* 与 appSettingsData 同名的字段 */
  function defaults() {
    return {
      testMode: 0,
      testAction: 0,
      sampleRate: 1,
      backlightLevel: 0,
      waveform: 1,
      buttonResultSelection: 0,
      autoZero: 0,
      autoZeroDelaySeconds: 1,
      gravityX1000: GRAVITY_DEFAULT_X1000,
      extFunc: 0,
      forceUnit: FORCE_UNIT.N,
      toleranceLowX10: -196,
      toleranceHighX10: 196,
      forceRange: 0,
      startForceMillinewton: START_FORCE_DEFAULT_MN,
      autoSleepMin: 0,
      loadLimitPercent: 100,
      polarity: 0,
      screenDir: 2,
      language: 0,
      chartDir: 0,
      chartWindowSeconds: CHART_WINDOW_DEFAULT_S,
      powerOff: 0,
      baud: 2,
      dataBits: 1,
      timeDisplay: 0,
      autoStore: 0,
      dataSort: 0
    };
  }

  /* 每一项：{ labelId, kind, group } */
  var DESCRIPTORS = {};
  DESCRIPTORS[ID.BACKLIGHT] = { labelId: FG.STR.ITEM_BACKLIGHT, kind: KIND.ENUM };
  DESCRIPTORS[ID.WAVEFORM] = { labelId: FG.STR.ITEM_WAVEFORM, kind: KIND.ENUM };
  DESCRIPTORS[ID.BUTTON_RESULT] = { labelId: FG.STR.ITEM_BUTTON_RESULT, kind: KIND.ENUM };
  DESCRIPTORS[ID.TEST_MODE] = { labelId: 26, kind: KIND.ENUM };
  DESCRIPTORS[ID.TEST_ACTION] = { labelId: 27, kind: KIND.ENUM };
  DESCRIPTORS[ID.SAMPLE_RATE] = { labelId: 28, kind: KIND.ENUM };
  DESCRIPTORS[ID.TRANSFER_RATE] = { labelId: 29, kind: KIND.FIXED };
  DESCRIPTORS[ID.AUTO_ZERO] = { labelId: 30, kind: KIND.ENUM };
  DESCRIPTORS[ID.AUTO_ZERO_DELAY] = { labelId: 31, kind: KIND.UINT };
  DESCRIPTORS[ID.TOLERANCE] = { labelId: 32, kind: KIND.TOLERANCE };
  DESCRIPTORS[ID.FORCE_RANGE] = { labelId: 33, kind: KIND.FIXED };
  DESCRIPTORS[ID.START_FORCE] = { labelId: 34, kind: KIND.UINT };
  DESCRIPTORS[ID.GRAVITY] = { labelId: 35, kind: KIND.UINT };
  DESCRIPTORS[ID.AUTO_SLEEP] = { labelId: 36, kind: KIND.UINT };
  DESCRIPTORS[ID.EXT_FUNC] = { labelId: 37, kind: KIND.ENUM };
  DESCRIPTORS[ID.LOAD_LIMIT] = { labelId: 38, kind: KIND.UINT };
  DESCRIPTORS[ID.POLARITY] = { labelId: 39, kind: KIND.ENUM };
  DESCRIPTORS[ID.SCREEN_DIR] = { labelId: 40, kind: KIND.ENUM };
  DESCRIPTORS[ID.LANGUAGE] = { labelId: 41, kind: KIND.ENUM };
  DESCRIPTORS[ID.FACTORY_RESET] = { labelId: 42, kind: KIND.ACTION };
  DESCRIPTORS[ID.CHART_DIR] = { labelId: 43, kind: KIND.ENUM };
  DESCRIPTORS[ID.CHART_WINDOW] = { labelId: 44, kind: KIND.UINT };
  DESCRIPTORS[ID.POWER_OFF] = { labelId: 45, kind: KIND.UINT };
  DESCRIPTORS[ID.OUTPUT] = { labelId: 46, kind: KIND.FIXED };
  DESCRIPTORS[ID.BAUD] = { labelId: 47, kind: KIND.ENUM };
  DESCRIPTORS[ID.DATA_BITS] = { labelId: 48, kind: KIND.ENUM };
  DESCRIPTORS[ID.STOP_BITS] = { labelId: 49, kind: KIND.FIXED };
  DESCRIPTORS[ID.PARITY] = { labelId: 50, kind: KIND.FIXED };
  DESCRIPTORS[ID.STORAGE_LIST] = { labelId: 51, kind: KIND.ACTION };
  DESCRIPTORS[ID.TIME_DISPLAY] = { labelId: 52, kind: KIND.ENUM };
  DESCRIPTORS[ID.AUTO_STORE] = { labelId: 53, kind: KIND.ENUM };
  DESCRIPTORS[ID.DATA_SORT] = { labelId: 54, kind: KIND.ENUM };
  DESCRIPTORS[ID.STORAGE_LINK] = { labelId: 55, kind: KIND.FIXED };
  DESCRIPTORS[ID.CAL_AUTH] = { labelId: 56, kind: KIND.FIXED };
  DESCRIPTORS[ID.CAL_ENTER] = { labelId: 57, kind: KIND.ACTION };
  DESCRIPTORS[ID.CAL_SEGMENT] = { labelId: 58, kind: KIND.FIXED };
  DESCRIPTORS[ID.CAL_SETPOINT] = { labelId: 59, kind: KIND.FIXED };
  DESCRIPTORS[ID.CAL_ACTUAL] = { labelId: 60, kind: KIND.FIXED };

  var GROUP_ITEMS = {};
  GROUP_ITEMS[0] = [ID.TEST_MODE, ID.TEST_ACTION, ID.BUTTON_RESULT, ID.SAMPLE_RATE, ID.BACKLIGHT,
  ID.AUTO_ZERO, ID.AUTO_ZERO_DELAY, ID.TOLERANCE, ID.FORCE_RANGE, ID.START_FORCE];
  GROUP_ITEMS[1] = [ID.GRAVITY, ID.AUTO_SLEEP, ID.EXT_FUNC,
  ID.POLARITY, ID.SCREEN_DIR, ID.LANGUAGE, ID.FACTORY_RESET, ID.WAVEFORM, ID.CHART_DIR,
  ID.CHART_WINDOW];
  GROUP_ITEMS[2] = [ID.POWER_OFF, ID.OUTPUT, ID.BAUD, ID.DATA_BITS, ID.STOP_BITS,
  ID.PARITY, ID.TRANSFER_RATE];
  GROUP_ITEMS[3] = [ID.STORAGE_LIST, ID.TIME_DISPLAY, ID.AUTO_STORE, ID.DATA_SORT,
  ID.STORAGE_LINK];
  GROUP_ITEMS[4] = [];

  var SAMPLE_RATE_TEXT = ["10 Hz", "100 Hz", "1 kHz", "2 kHz"];
  var BAUD_TEXT = ["38400 bit/s", "19200 bit/s", "9600 bit/s"];

  var GROUP = { BASIC: 0, SYSTEM: 1, COMM: 2, STORAGE: 3, CALIBRATION: 4 };

  function Settings() {
    this.data = defaults();
    this.dirty = false;
  }

  Settings.prototype.load = function () {
    var stored = FG.Storage.loadSettings();
    if (stored && typeof stored === "object") {
      var fresh = defaults();
      for (var key in fresh) {
        if (Object.prototype.hasOwnProperty.call(fresh, key) &&
          typeof stored[key] === "number" && isFinite(stored[key])) {
          fresh[key] = Math.trunc(stored[key]);
        }
      }
      this.data = fresh;
      var bounds = {
        testMode: [0, 1], testAction: [0, 5], sampleRate: [0, 3],
        backlightLevel: [0, 5], waveform: [0, 1], buttonResultSelection: [0, 4],
        autoZero: [0, 1], autoZeroDelaySeconds: [1, 9], gravityX1000: [9700, 9900],
        extFunc: [0, 1], forceUnit: [0, 3], toleranceLowX10: [-9806, 9806],
        toleranceHighX10: [-9806, 9806], forceRange: [0, 5],
        startForceMillinewton: [10, FORCE_RANGES[fresh.forceRange >= 0 && fresh.forceRange <= 5 ? fresh.forceRange : 0].mn],
        autoSleepMin: [0, 99], loadLimitPercent: [1, 100], polarity: [0, 2],
        screenDir: [0, 2], language: [0, 2], chartDir: [0, 2], chartWindowSeconds: [0, 99],
        powerOff: [0, 99], baud: [0, 2], dataBits: [0, 1], timeDisplay: [0, 1], autoStore: [0, 1], dataSort: [0, 1]
      };
      var baseline = defaults();
      Object.keys(bounds).forEach(function (key) {
        if (fresh[key] < bounds[key][0] || fresh[key] > bounds[key][1]) fresh[key] = baseline[key];
      });
      if (fresh.toleranceLowX10 > fresh.toleranceHighX10) fresh.toleranceLowX10 = fresh.toleranceHighX10;
      this.clampTolerance();
      fresh.loadLimitPercent = 100;
      if (stored.calibration) this.data.calibration = stored.calibration;
    }
    this.dirty = false;
    FG.SetLanguage(this.data.language);
    return this;
  };

  Settings.prototype.save = function () {
    var ok = FG.Storage.saveSettings(this.data);
    if (ok) this.dirty = false;
    return ok;
  };

  Settings.prototype.saveIfDirty = function () {
    if (this.dirty) {
      return this.save();
    }
    return true;
  };

  Settings.prototype.factoryDefaults = function () {
    this.data = defaults();
    this.dirty = true;
    FG.SetLanguage(this.data.language);
  };

  Settings.prototype.getKind = function (id) {
    if (id === ID.BUTTON_RESULT && (this.data.testMode !== 1 || this.data.testAction !== 5)) return KIND.FIXED;
    if (id === ID.LOAD_LIMIT) return KIND.FIXED;
    if (id < 0 || id >= ID.COUNT) {
      return KIND.FIXED;
    }
    if (id === ID.AUTO_ZERO_DELAY && this.data.autoZero === 0) {
      return KIND.FIXED;
    }
    return DESCRIPTORS[id].kind;
  };

  Settings.prototype.getEditPartCount = function (id) {
    var kind = this.getKind(id);
    if (kind === KIND.FIXED || kind === KIND.ACTION) {
      return 0;
    }
    if (id === ID.TOLERANCE) {
      return 2;
    }
    if (id === ID.GRAVITY) {
      return 3;
    }
    return 1;
  };

  Settings.prototype.getLabelId = function (id) {
    if (id < 0 || id >= ID.COUNT) {
      return 26;
    }
    return DESCRIPTORS[id].labelId;
  };

  Settings.prototype.getGroupItems = function (group) {
    return GROUP_ITEMS[group] || [];
  };

  Settings.prototype.fullScale = function () {
    var index = this.data.forceRange;
    if (index < 0 || index >= FORCE_RANGES.length) {
      index = 0;
    }
    return FORCE_RANGES[index].mn;
  };

  Settings.prototype.getStartForce = function () {
    var fullScale = this.fullScale();
    var value = this.data.startForceMillinewton;
    if (value < START_FORCE_MIN_MN) {
      return START_FORCE_MIN_MN;
    }
    if (value > fullScale) {
      return fullScale;
    }
    return value;
  };

  Settings.prototype.getForceUnit = function () {
    var unit = this.data.forceUnit;
    if (unit < 0 || unit >= FORCE_UNIT.COUNT) {
      return FORCE_UNIT.N;
    }
    return unit;
  };

  /* g → kg → N → lb → g */
  Settings.prototype.cycleForceUnit = function () {
    var next = [FORCE_UNIT.LB, FORCE_UNIT.KG, FORCE_UNIT.N, FORCE_UNIT.G];
    var unit = this.data.forceUnit;
    if (unit < 0 || unit >= FORCE_UNIT.COUNT) {
      unit = FORCE_UNIT.N;
    }
    this.data.forceUnit = next[unit];
    this.dirty = true;
    return this.data.forceUnit;
  };

  Settings.prototype.toleranceLow = function () {
    this.clampTolerance();
    return this.data.toleranceLowX10 * 100;
  };

  Settings.prototype.toleranceHigh = function () {
    this.clampTolerance();
    return this.data.toleranceHighX10 * 100;
  };

  Settings.prototype.chartWindowSeconds = function () {
    var value = this.data.chartWindowSeconds;
    return (value > CHART_WINDOW_MAX_S) ? CHART_WINDOW_MAX_S : value;
  };

  Settings.prototype.testMode = function () {
    return this.data.testMode % TEST_MODE.COUNT;
  };

  Settings.prototype.testAction = function () {
    return this.data.testAction % 6;
  };

  Settings.prototype.clampTolerance = function () {
    var span = Math.floor(this.fullScale() / 100);
    this.data.toleranceLowX10 = Math.max(-span, Math.min(span, this.data.toleranceLowX10));
    this.data.toleranceHighX10 = Math.max(this.data.toleranceLowX10, Math.min(span, this.data.toleranceHighX10));
  };

  Settings.prototype.formatValue = function (id, editPart) {
    var d = this.data;
    switch (id) {
      case ID.TEST_MODE:
        return FG.T(d.testMode === TEST_MODE.PEAK ? 62 : 61);
      case ID.TEST_ACTION:
        if (d.testMode !== TEST_MODE.PEAK) {
          return FG.T(63);
        }
        return FG.T(d.testAction === 5 ? FG.STR.OPT_BUTTON : 64 + (d.testAction % 5));
      case ID.BACKLIGHT:
        return (100 - 12 * d.backlightLevel) + "%";
      case ID.WAVEFORM:
        return FG.T(d.waveform ? 70 : 69);
      case ID.BUTTON_RESULT:
        return this.getKind(id) === KIND.FIXED ? "---" : ["Fp", "Fp/Fc", "Fp/Fr", "Fp/Cc", "Fp/Cr"][d.buttonResultSelection];
      case ID.SAMPLE_RATE:
        return SAMPLE_RATE_TEXT[d.sampleRate % 4];
      case ID.TRANSFER_RATE:
        return "100 Hz";
      case ID.AUTO_ZERO:
        return FG.T(d.autoZero % 2 ? 70 : 69);
      case ID.AUTO_ZERO_DELAY:
        return (d.autoZero === 0) ? "---" : (d.autoZeroDelaySeconds + " s");
      case ID.TOLERANCE:
        this.clampTolerance();
        return formatTolerance(d.toleranceLowX10, d.toleranceHighX10, editPart);
      case ID.FORCE_RANGE:
        return FORCE_RANGES[d.forceRange % FORCE_RANGES.length].kg + " kg";
      case ID.START_FORCE:
        return formatStartForce(this.getStartForce());
      case ID.GRAVITY:
        return formatGravity(d.gravityX1000, editPart);
      case ID.AUTO_SLEEP:
        return d.autoSleepMin + " min";
      case ID.EXT_FUNC:
        return FG.T(d.extFunc % 2 ? 85 : 84);
      case ID.LOAD_LIMIT:
        return d.loadLimitPercent + "% FS";
      case ID.POLARITY:
        return FG.T([71, 72, 74][d.polarity % 3]);
      case ID.SCREEN_DIR:
        return FG.T([72, 73, 75][d.screenDir % 3]);
      case ID.LANGUAGE:
        return FG.T([82, 83, FG.STR.OPT_LANG_TW][d.language % 3]);
      case ID.FACTORY_RESET:
        return FG.T(76);
      case ID.CHART_DIR:
        return FG.T([71, 72, 74][d.chartDir % 3]);
      case ID.CHART_WINDOW:
        return this.chartWindowSeconds() + " s";
      case ID.POWER_OFF:
        return String(d.powerOff);
      case ID.OUTPUT:
        return "--";
      case ID.BAUD:
        return BAUD_TEXT[d.baud % 3];
      case ID.DATA_BITS:
        return ((d.dataBits % 2) ? "8 " : "7 ") + ["位", "bit", "位元"][FG.GetLanguage()];
      case ID.STOP_BITS:
        return ["1 位", "1 bit", "1 位元"][FG.GetLanguage()];
      case ID.PARITY:
        return ["无校验", "NONE", "無同位檢查"][FG.GetLanguage()];
      case ID.STORAGE_LIST:
        return FG.T(77);
      case ID.TIME_DISPLAY:
        return FG.T(d.timeDisplay % 2 ? 70 : 69);
      case ID.AUTO_STORE:
        return FG.T(d.autoStore % 2 ? 70 : 69);
      case ID.DATA_SORT:
        return FG.T(d.dataSort % 2 ? 79 : 78);
      case ID.STORAGE_LINK:
        return "---";
      case ID.CAL_AUTH:
        return FG.T(80);
      case ID.CAL_ENTER:
        return FG.T(76);
      case ID.CAL_SEGMENT:
        return FG.T(81);
      case ID.CAL_SETPOINT:
      case ID.CAL_ACTUAL:
        return "---";
      default:
        return "--";
    }
  };

  function formatTolerance(lowX10, highX10, editPart) {
    var low = formatX10(lowX10);
    var high = formatX10(highX10);
    var text = "";
    if (editPart === 0) text += "[";
    text += low;
    if (editPart === 0) text += "]";
    text += "-";
    if (editPart === 1) text += "[";
    text += high;
    if (editPart === 1) text += "]";
    return text;
  }

  function formatX10(valueX10) {
    return (valueX10 < 0 ? "-" : "") + Math.floor(Math.abs(valueX10) / 10) + "." + Math.abs(valueX10) % 10;
  }

  /* 起始值显示：毫牛转成带 1~3 位小数的牛顿 */
  function formatStartForce(force) {
    var value = (force > 0) ? force : 0;
    var whole = Math.floor(value / 1000);
    var fraction = value % 1000;
    var text = whole + "." +
      String(Math.floor(fraction / 100)) +
      String(Math.floor(fraction / 10) % 10) +
      String(fraction % 10);
    while (text.length > text.indexOf(".") + 3 && text.charAt(text.length - 1) === "0") {
      text = text.slice(0, -1);
    }
    return text + " N";
  }

  function formatGravity(gravityX1000, editPart) {
    var fraction = gravityX1000 % 1000;
    var digits = [
      Math.floor(fraction / 100),
      Math.floor(fraction / 10) % 10,
      fraction % 10
    ];
    var text = "9.";
    for (var i = 0; i < 3; i++) {
      if (editPart === i) text += "[";
      text += digits[i];
      if (editPart === i) text += "]";
    }
    return text;
  }

  function cycleU8(value, count, delta) {
    if (count === 0) {
      return 0;
    }
    var next = value + delta;
    while (next < 0) next += count;
    while (next >= count) next -= count;
    return next;
  }

  function stepU8(value, minValue, maxValue, delta) {
    var next = value + delta;
    if (next < minValue) return minValue;
    if (next > maxValue) return maxValue;
    return next;
  }

  function stepU16(value, minValue, maxValue, delta) {
    var next = value + delta;
    if (next < minValue) return minValue;
    if (next > maxValue) return maxValue;
    return next;
  }

  function adjustGravity(value, delta, editPart) {
    var placeValues = [100, 10, 1];
    if (editPart >= 3) {
      return value;
    }
    var place = placeValues[editPart];
    var digit = Math.floor(value / place) % 10;
    if (editPart === 0) {
      if (digit < 7 || digit > 9) {
        digit = 7;
      }
      digit = cycleU8(digit - 7, 3, delta) + 7;
    } else {
      digit = cycleU8(digit, 10, delta);
    }
    var next = value - (Math.floor(value / place) % 10) * place + digit * place;
    if (next < GRAVITY_MIN_X1000) return GRAVITY_MIN_X1000;
    if (next > GRAVITY_MAX_X1000) return GRAVITY_MAX_X1000;
    return next;
  }

  function adjustStartForce(value, maxValue, delta) {
    if (maxValue < START_FORCE_MIN_MN) {
      return START_FORCE_MIN_MN;
    }
    if (value < START_FORCE_MIN_MN) value = START_FORCE_MIN_MN;
    if (value > maxValue) value = maxValue;
    if (delta > 0) {
      if (value >= maxValue) return maxValue;
      if (value < START_FORCE_STEP_MN) {
        return (maxValue < START_FORCE_STEP_MN) ? maxValue : START_FORCE_STEP_MN;
      }
      if ((maxValue - value) <= START_FORCE_STEP_MN) return maxValue;
      return value + START_FORCE_STEP_MN;
    }
    if (value <= START_FORCE_MIN_MN) return START_FORCE_MIN_MN;
    if (value === maxValue && (maxValue % START_FORCE_STEP_MN) !== 0) {
      var grid = maxValue - (maxValue % START_FORCE_STEP_MN);
      return (grid >= START_FORCE_MIN_MN) ? grid : START_FORCE_MIN_MN;
    }
    if (value <= START_FORCE_STEP_MN) return START_FORCE_MIN_MN;
    return value - START_FORCE_STEP_MN;
  }

  /* 返回 true 表示值发生变化 */
  Settings.prototype.adjust = function (id, delta, editPart) {
    if (delta === 0) {
      return false;
    }
    var d = this.data;
    switch (id) {
      case ID.TEST_MODE:
        d.testMode = cycleU8(d.testMode, TEST_MODE.COUNT, delta);
        this.dirty = true;
        return true;
      case ID.TEST_ACTION:
        if (d.testMode !== TEST_MODE.PEAK) {
          return false;
        }
        d.testAction = cycleU8(d.testAction, 6, delta);
        this.dirty = true;
        return true;
      case ID.BACKLIGHT:
        d.backlightLevel = cycleU8(d.backlightLevel, 6, delta);
        this.dirty = true;
        return true;
      case ID.WAVEFORM:
        d.waveform = cycleU8(d.waveform, 2, delta);
        this.dirty = true;
        return true;
      case ID.BUTTON_RESULT:
        if (this.getKind(id) === KIND.FIXED) return false;
        d.buttonResultSelection = cycleU8(d.buttonResultSelection, 5, delta);
        this.dirty = true;
        return true;
      case ID.SAMPLE_RATE:
        d.sampleRate = cycleU8(d.sampleRate, 4, delta);
        this.dirty = true;
        return true;
      case ID.AUTO_ZERO:
        d.autoZero = cycleU8(d.autoZero, 2, delta);
        this.dirty = true;
        return true;
      case ID.AUTO_ZERO_DELAY:
        if (d.autoZero === 0) {
          return false;
        }
        d.autoZeroDelaySeconds = cycleU8(
          d.autoZeroDelaySeconds - AUTO_ZERO_DELAY_MIN_S,
          AUTO_ZERO_DELAY_MAX_S - AUTO_ZERO_DELAY_MIN_S + 1, delta) + AUTO_ZERO_DELAY_MIN_S;
        this.dirty = true;
        return true;
      case ID.GRAVITY:
        d.gravityX1000 = adjustGravity(d.gravityX1000, delta, editPart);
        this.dirty = true;
        return true;
      case ID.EXT_FUNC:
        d.extFunc = cycleU8(d.extFunc, 2, delta);
        this.dirty = true;
        return true;
      case ID.TOLERANCE:
        this.clampTolerance();
        var span = Math.floor(this.fullScale() / 100);
        if (editPart === 0) {
          d.toleranceLowX10 = stepU16(d.toleranceLowX10, -span, d.toleranceHighX10, delta);
        } else {
          d.toleranceHighX10 = stepU16(d.toleranceHighX10, d.toleranceLowX10,
            span, delta);
        }
        this.dirty = true;
        return true;
      case ID.FORCE_RANGE:
        /* 源码把额定量程标为 APP_SETTING_KIND_FIXED：普通设定页只读，
         * 量程由校正页修改。这里按只读处理，避免从设定页误改量程。 */
        return false;
      case ID.START_FORCE:
        d.startForceMillinewton = adjustStartForce(this.getStartForce(),
          this.fullScale(), delta);
        this.dirty = true;
        return true;
      case ID.AUTO_SLEEP:
        d.autoSleepMin = stepU8(d.autoSleepMin, 0, 99, delta);
        this.dirty = true;
        return true;
      case ID.LOAD_LIMIT:
        return false;
      case ID.POLARITY:
        d.polarity = cycleU8(d.polarity, 3, delta);
        this.dirty = true;
        return true;
      case ID.SCREEN_DIR:
        d.screenDir = cycleU8(d.screenDir, 3, delta);
        this.dirty = true;
        return true;
      case ID.LANGUAGE:
        d.language = cycleU8(d.language, 3, delta);
        FG.SetLanguage(d.language);
        this.dirty = true;
        return true;
      case ID.CHART_DIR:
        d.chartDir = cycleU8(d.chartDir, 3, delta);
        this.dirty = true;
        return true;
      case ID.CHART_WINDOW:
        d.chartWindowSeconds = stepU8(this.chartWindowSeconds(), 0, CHART_WINDOW_MAX_S, delta);
        this.dirty = true;
        return true;
      case ID.POWER_OFF:
        d.powerOff = stepU8(d.powerOff, 0, 99, delta);
        this.dirty = true;
        return true;
      case ID.BAUD:
        d.baud = cycleU8(d.baud, 3, delta);
        this.dirty = true;
        return true;
      case ID.DATA_BITS:
        d.dataBits = cycleU8(d.dataBits, 2, delta);
        this.dirty = true;
        return true;
      case ID.TIME_DISPLAY:
        d.timeDisplay = cycleU8(d.timeDisplay, 2, delta);
        this.dirty = true;
        return true;
      case ID.AUTO_STORE:
        d.autoStore = cycleU8(d.autoStore, 2, delta);
        this.dirty = true;
        return true;
      case ID.DATA_SORT:
        d.dataSort = cycleU8(d.dataSort, 2, delta);
        this.dirty = true;
        return true;
      default:
        return false;
    }
  };

  FG.Settings = Settings;
  FG.SETTING_ID = ID;
  FG.SETTING_KIND = KIND;
  FG.SETTING_GROUP = GROUP;
  FG.FORCE_RANGES = FORCE_RANGES;
  FG.TEST_MODE = TEST_MODE;
  FG.ADJUST_HELPERS = {
    cycleU8: cycleU8,
    stepU8: stepU8,
    stepU16: stepU16,
    formatX10: formatX10,
    formatGravity: formatGravity,
    formatTolerance: formatTolerance,
    formatStartForce: formatStartForce
  };
})(window.FG = window.FG || {});
