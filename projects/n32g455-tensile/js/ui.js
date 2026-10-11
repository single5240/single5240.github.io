/* 页面状态机和绘制。逻辑分辨率 240x320，像素坐标与固件一致。
 *
 * 页面与转换规则对照 N32G455/APP/app_ui_home.c：
 *   appUiTransitionTable 只覆盖跨页；设定页内部焦点与编辑在 HandleSettingEvent；
 *   记录页内部在 DispatchRecordEvent。ui 不直接改测量状态机内部变量，只读快照、投事件。
 */
(function (FG) {
  "use strict";

  var PAGE = {
    HOME: 0, MENU: 1, BASIC: 2, SYSTEM: 3, COMM: 4, STORAGE: 5,
    CALIBRATION: 6, RECORD: 7, COUNT: 8
  };
  var EVENT = {
    MENU: 0, PREVIOUS: 1, NEXT: 2, ZERO: 3, CONFIRM: 4,
    DATA_HOLD: 5, DATA_RELEASE: 6, DATA_LONG: 7
  };
  var COLOR = FG.COLOR;
  var MENU_FIRST_PAGE = PAGE.BASIC;
  var MENU_LAST_PAGE = PAGE.CALIBRATION;
  var REFRESH_PERIOD_MS = 100;
  var FORCE_ZERO_ENTER_DIVISOR = 800;
  var FORCE_ZERO_EXIT_DIVISOR = 400;
  var SETTING_LABEL_X = 12;
  var SETTING_LABEL_COLUMN_WIDTH = 64;
  var CHART_LEFT = 28;
  var CHART_WIDTH = 201;
  var CHART_TOP = 170;
  var CHART_BOTTOM = 270;
  var CHART_DEFAULT_FULL_SCALE_MN = 20000;
  var FORCE_TEXT_X = 18;
  var FORCE_TEXT_Y = 65;
  var PEAK_TEXT_X = 86;
  var PEAK_TEXT_Y = 123;
  var INSERT_FP_TEXT_Y = 118;
  var INSERT_FT_TEXT_Y = 136;
  var TIME_TEXT_X = 188;
  var TIME_TEXT_Y = 3;
  var BATTERY_TEXT_X = 22;
  var BATTERY_TEXT_Y = 8;
  var STATUS_TEXT_LEFT = 12;
  var STATUS_TEXT_RIGHT = 228;
  var STATUS_TEXT_Y = 298;
  var STORAGE_TEXT_LEFT = 84;
  var STORAGE_TEXT_RIGHT = 188;
  var RECORD_ROW_Y0 = 32;
  var RECORD_ROW_PITCH = 48;
  var RECORD_LINE2_DY = 20;
  var RECORD_VIEW = { LIST: 0, CONFIRM: 1, CLEARING: 2, CLEAR_FAIL: 3 };
  var CHART_RANGE = { BIPOLAR: 0, POSITIVE: 1, NEGATIVE: 2 };

  function Ui(options) {
    this.screen = options.screen;
    this.settings = options.settings;
    this.forceInput = options.forceInput;
    this.tests = options.tests;
    this.waveform = options.waveform;
    this.records = options.records;
    this.calibration = options.calibration;
    this.getForce = options.getForce;             /* 显示用模拟毫牛 */
    this.getFastForce = options.getFastForce;     /* 动作判定用模拟毫牛 */
    this.tick = options.tick || function () { return FG.now(); };
    this.onBeep = options.onBeep || function () { };
    this.onSaveRequest = options.onSaveRequest || function () { return "fail"; };

    this.page = PAGE.HOME;
    this.menuSelection = MENU_FIRST_PAGE;
    this.settingFocus = 0;
    this.settingEditing = 0;
    this.settingEditPart = 0;
    this.recordView = RECORD_VIEW.LIST;
    this.recordPage = 0;
    this.recordWait = 0;
    this.recordHoldSuppressClear = 0;
    this.recordClearArmed = 0;
    this.batteryPercent = 100;

    this.displayedForce = 0;
    this.forceZeroActive = 1;
    this.displayedForceText = "";
    this.displayedPeakText = "";
    this.displayedSecondPeakText = "";
    this.displayedTimeText = "";
    this.displayedActionText = "";
    this.displayedVerdict = -1;
    this.displayedUnit = -1;
    this.displayedFullScale = -1;
    this.displayedTestMode = -1;
    this.displayedTestAction = -1;
    this.displayedStoragePrompt = -1;
    this.lastRefreshTick = 0;
    this.redrawPending = true;
    this.lastWaveformRevision = -1;
  }

  /* ---------- 力值显示与格式化 ---------- */

  Ui.prototype.fullScale = function () {
    return this.settings.fullScale();
  };

  /* 零点死区：|值| <= (FS + 400) / 800 时显示 0 */
  Ui.prototype.zeroDeadband = function () {
    return Math.trunc((this.fullScale() + Math.trunc(FORCE_ZERO_ENTER_DIVISOR / 2)) /
      FORCE_ZERO_ENTER_DIVISOR);
  };

  /* 空值统一显示占位符 ---；结果值再过零点死区 */
  Ui.prototype.peakDisplayText = function (value) {
    if (value === null || value === undefined) {
      return "---";
    }
    if (Math.abs(value) <= this.zeroDeadband()) {
      value = 0;
    }
    return FG.Unit.formatForce(value, this.settings.getForceUnit());
  };

  /*
   * 显示死区 + 迟滞：零点附近吸零，跳变立即跟随，小幅抖动保持上次显示值。
   * 这是固件 AppUiHome_FilterForce 的行为，不是低通滤波。
   */
  Ui.prototype.filterForce = function (raw) {
    var fullScale = this.fullScale();
    var enter = Math.trunc((fullScale + Math.trunc(FORCE_ZERO_ENTER_DIVISOR / 2)) /
      FORCE_ZERO_ENTER_DIVISOR);
    var exit = Math.trunc((fullScale + Math.trunc(FORCE_ZERO_EXIT_DIVISOR / 2)) /
      FORCE_ZERO_EXIT_DIVISOR);
    var magnitude = Math.abs(raw);

    if (this.forceZeroActive) {
      if (magnitude < exit) {
        this.displayedForce = 0;
        return 0;
      }
      this.forceZeroActive = 0;
      this.displayedForce = raw;
      return raw;
    }
    if (magnitude <= enter) {
      this.forceZeroActive = 1;
      this.displayedForce = 0;
      return 0;
    }
    if (Math.abs(raw - this.displayedForce) > enter) {
      this.displayedForce = raw;
    }
    return this.displayedForce;
  };

  /* 力值文本：首字符是符号位（'-' 或 ' '） */
  Ui.prototype.formatForceText = function (millinewton) {
    var unit = this.settings.getForceUnit();
    var magnitude = Math.abs(millinewton);
    var sign = (millinewton < 0 && magnitude >= 10) ? "-" : " ";
    if (unit === FG.Unit.UNIT.N) {
      if (magnitude >= 100000) {
        var centinewton = Math.min(Math.trunc(magnitude / 10), 99999);
        return sign + (centinewton / 100).toFixed(2);
      }
      var whole = Math.trunc(magnitude / 1000);
      var fraction = magnitude % 1000;
      return sign + (whole < 10 ? "0" : "") + whole + "." +
        Math.trunc(fraction / 100) + Math.trunc(fraction / 10) % 10;
    }
    return FG.Unit.formatForce(millinewton, unit);
  };

  /* ---------- 图表 ---------- */

  Ui.prototype.getChartRange = function () {
    if (this.settings.testMode() !== FG.TEST_MODE.PEAK) {
      return CHART_RANGE.BIPOLAR;
    }
    switch (this.tests.action) {
      case FG.TEST_ACTION.COMPRESSION:
        return CHART_RANGE.NEGATIVE;
      case FG.TEST_ACTION.TENSION:
      case FG.TEST_ACTION.CONTACT:
      case FG.TEST_ACTION.BREAK:
        return CHART_RANGE.POSITIVE;
      case FG.TEST_ACTION.INSERT:
      default:
        return CHART_RANGE.BIPOLAR;
    }
  };

  Ui.prototype.scaleMagnitude = function (magnitude, spanPixels, fullScale) {
    if (magnitude === 0 || fullScale === 0) {
      return 0;
    }
    if (magnitude >= fullScale) {
      return spanPixels;
    }
    return Math.trunc(magnitude * spanPixels / fullScale);
  };

  Ui.prototype.forceToChartY = function (force, range, fullScale) {
    var fs = (fullScale <= 0) ? CHART_DEFAULT_FULL_SCALE_MN : fullScale;
    var height = CHART_BOTTOM - CHART_TOP;
    var half = Math.trunc(height / 2);
    var zeroY = CHART_TOP + half;
    var shown = force;
    var y;

    if (range === CHART_RANGE.POSITIVE) {
      if (shown < 0) {
        shown = 0;
      } else if (shown > fs) {
        shown = fs;
      }
      y = CHART_BOTTOM - this.scaleMagnitude(shown, height, fs);
    } else if (range === CHART_RANGE.NEGATIVE) {
      if (shown > 0) {
        shown = 0;
      } else if (shown < -fs) {
        shown = -fs;
      }
      y = CHART_TOP + this.scaleMagnitude(shown < 0 ? -shown : 0, height, fs);
    } else {
      if (shown > fs) {
        shown = fs;
      } else if (shown < -fs) {
        shown = -fs;
      }
      var magnitude = shown < 0 ? -shown : shown;
      var pixels = this.scaleMagnitude(magnitude, half, fs);
      y = (shown < 0) ? zeroY + pixels : zeroY - pixels;
    }
    if (y < CHART_TOP) y = CHART_TOP;
    if (y > CHART_BOTTOM) y = CHART_BOTTOM;
    return y;
  };

  Ui.prototype.chartAxisValues = function (range, fullScale) {
    var fs = (fullScale <= 0) ? CHART_DEFAULT_FULL_SCALE_MN : fullScale;
    if (range === CHART_RANGE.POSITIVE) {
      return [fs, Math.trunc(fs * 3 / 4), Math.trunc(fs / 2), Math.trunc(fs / 4), 0];
    }
    if (range === CHART_RANGE.NEGATIVE) {
      return [0, -Math.trunc(fs / 4), -Math.trunc(fs / 2), -Math.trunc(fs * 3 / 4), -fs];
    }
    return [fs, Math.trunc(fs / 2), 0, -Math.trunc(fs / 2), -fs];
  };

  /* ---------- 主界面 ---------- */

  Ui.prototype.drawBattery = function () {
    var s = this.screen;
    s.fillRect(5, 6, 14, 10, COLOR.GRAY);
    s.fillRect(7, 8, 10, 6, COLOR.BG);
    s.fillRect(8, 9, 8, 4, COLOR.CYAN);
    s.fillRect(19, 9, 2, 4, COLOR.GRAY);
    var percent = Math.min(this.batteryPercent, 100);
    var text = String(percent);
    s.drawMiniText(BATTERY_TEXT_X, BATTERY_TEXT_Y, text, COLOR.GRAY);
    s.drawMiniText(BATTERY_TEXT_X + 6 * text.length, BATTERY_TEXT_Y, "%", COLOR.GRAY);
  };

  Ui.prototype.drawDirection = function () {
    var s = this.screen;
    s.fillRect(219, 28, 3, 10, COLOR.WHITE);
    s.line(213, 35, 220, 42, COLOR.WHITE);
    s.line(220, 42, 227, 35, COLOR.WHITE);
  };

  Ui.prototype.drawChart = function (snapshot) {
    var s = this.screen;
    var fullScale = this.fullScale();
    var unit = this.settings.getForceUnit();
    var range = this.getChartRange();
    var i;

    /* 网格 */
    for (i = 0; i < 5; i++) {
      s.fillRect(CHART_LEFT, CHART_TOP + i * 25, CHART_WIDTH, 1, COLOR.GRID);
    }
    for (i = 0; i < 6; i++) {
      s.fillRect(CHART_LEFT + i * 40, 166, 1, 110, COLOR.GRID);
    }

    /* Y 轴刻度右边缘对齐 x=26 */
    var values = this.chartAxisValues(range, fullScale);
    for (i = 0; i < 5; i++) {
      var label = FG.Unit.formatAxis(values[i], unit);
      var width = 6 * label.length;
      s.drawMiniText(width < 26 ? 26 - width : 0, 166 + i * 25, label, COLOR.GRAY);
    }
    var unitLabel = FG.Unit.label(unit);
    var unitWidth = 6 * unitLabel.length;
    s.drawMiniText(unitWidth < 26 ? 26 - unitWidth : 0, 157, unitLabel, COLOR.GRAY);

    /* 曲线：平均值为主线；固件首页不画最小/最大包络 */
    if (!snapshot || snapshot.count === 0) {
      return;
    }
    var xOffset = 0;
    if (snapshot.mode === "scroll" && snapshot.count < CHART_WIDTH) {
      xOffset = CHART_WIDTH - snapshot.count;
    }
    var previousValid = false;
    var previousX = 0;
    var previousY = 0;
    var markerX = 0;
    var markerY = 0;
    for (i = 0; i < snapshot.count && i < CHART_WIDTH; i++) {
      var point = snapshot.points[i];
      if (!point || !point.valid) {
        previousValid = false;
        continue;
      }
      var x = CHART_LEFT + xOffset + i;
      var y = this.forceToChartY(point.average, range, fullScale);
      if (previousValid) {
        s.drawChartLine(previousX, previousY, x, y, COLOR.CYAN);
      }
      previousValid = true;
      previousX = x;
      previousY = y;
      markerX = (previousX > CHART_LEFT) ? previousX - 1 : previousX;
      markerY = (previousY > CHART_TOP) ? previousY - 1 : previousY;
    }
    if (markerX + 2 > CHART_LEFT + CHART_WIDTH - 1) {
      markerX = CHART_LEFT + CHART_WIDTH - 3;
    }
    s.fillRect(markerX, markerY, 3, 3, COLOR.CYAN);
  };

  Ui.prototype.drawAxisText = function (snapshot) {
    var s = this.screen;
    var y = 279;
    if (snapshot && snapshot.mode === "scroll") {
      s.drawMiniText(20, y, "-10", COLOR.GRAY);
      s.drawMiniText(63, y, "-8", COLOR.GRAY);
      s.drawMiniText(103, y, "-6", COLOR.GRAY);
      s.drawMiniText(143, y, "-4", COLOR.GRAY);
      s.drawMiniText(183, y, "-2", COLOR.GRAY);
      s.drawMiniText(226, y, "0", COLOR.GRAY);
      return;
    }
    var seconds = snapshot ? snapshot.windowSeconds : this.settings.chartWindowSeconds();
    for (var i = 0; i < 6; i++) {
      var value = Math.trunc((seconds * i + 2) / 5);
      var text = String(value);
      var x = CHART_LEFT + i * 40;
      x -= (value >= 10) ? 6 : 2;
      s.drawMiniText(x, y, text, COLOR.GRAY);
    }
  };

  Ui.prototype.drawForceText = function (text) {
    var s = this.screen;
    if (text.charAt(0) === "-") {
      s.drawNumber40(FORCE_TEXT_X - 12, FORCE_TEXT_Y, "-", COLOR.WHITE);
      s.drawNumber40(FORCE_TEXT_X + 12, FORCE_TEXT_Y, text.slice(1), COLOR.WHITE);
    } else {
      s.drawNumber40(FORCE_TEXT_X, FORCE_TEXT_Y, text, COLOR.WHITE);
    }
    s.drawText(FG.FONT16, 190, 80, FG.Unit.label(this.settings.getForceUnit()), COLOR.WHITE);
  };

  Ui.prototype.drawPeakRows = function (peakText, secondText) {
    var s = this.screen;
    var unit = this.settings.getForceUnit();
    var unitLabel = FG.Unit.label(unit);
    var color;
    var peakColor;

    if (secondText === null || secondText === undefined) {
      s.drawText(FG.FONT16, 8, PEAK_TEXT_Y, FG.T(7), COLOR.GRAY);
      color = (peakText.charAt(0) === "-" && peakText.charAt(1) === "-") ? COLOR.GRAY : COLOR.WHITE;
      s.drawText(FG.FONT16, PEAK_TEXT_X, PEAK_TEXT_Y, peakText, color);
      s.drawText(FG.FONT16, 188, PEAK_TEXT_Y, unitLabel, COLOR.GRAY);
      return;
    }

    var labels = this.peakRowLabels();
    s.drawText(FG.FONT16, 8, INSERT_FP_TEXT_Y, labels[0], COLOR.GRAY);
    peakColor = (peakText.charAt(0) === "-" && peakText.charAt(1) === "-") ? COLOR.GRAY : COLOR.WHITE;
    s.drawText(FG.FONT16, PEAK_TEXT_X, INSERT_FP_TEXT_Y, peakText, peakColor);
    s.drawText(FG.FONT16, 188, INSERT_FP_TEXT_Y, unitLabel, COLOR.GRAY);

    s.drawText(FG.FONT16, 8, INSERT_FT_TEXT_Y, labels[1], COLOR.GRAY);
    color = (secondText.charAt(0) === "-" && secondText.charAt(1) === "-") ? COLOR.GRAY : COLOR.WHITE;
    s.drawText(FG.FONT16, PEAK_TEXT_X, INSERT_FT_TEXT_Y, secondText, color);
    s.drawText(FG.FONT16, 188, INSERT_FT_TEXT_Y, unitLabel, COLOR.GRAY);
  };

  Ui.prototype.peakRowLabels = function () {
    switch (this.tests.action) {
      case FG.TEST_ACTION.INSERT: return ["FP", "FT"];
      case FG.TEST_ACTION.BREAK: return ["MAX", "FB"];
      case FG.TEST_ACTION.CONTACT: return ["PEAK", "ACT"];
      default: return ["", ""];
    }
  };

  Ui.prototype.verdictText = function (verdict) {
    if (verdict === FG.TEST_VERDICT.HIGH) return "+NG";
    if (verdict === FG.TEST_VERDICT.LOW) return "-NG";
    return "OK";
  };

  Ui.prototype.drawBottomBar = function () {
    var s = this.screen;
    s.fillRect(0, 292, 240, 28, COLOR.PANEL);

    /* 左：动作名，只有峰值模式才有 */
    if (this.settings.testMode() === FG.TEST_MODE.PEAK) {
      var actionText = this.actionName();
      if (actionText) {
        s.drawText(FG.FONT16, STATUS_TEXT_LEFT, STATUS_TEXT_Y, actionText, COLOR.WHITE);
      }
    }

    /* 中：存储提示 */
    var prompt = this.tests.storagePrompt;
    if (prompt !== FG.TEST_PROMPT.NONE) {
      var text;
      var color;
      if (prompt === FG.TEST_PROMPT.SUCCESS) {
        text = FG.T(8);
        color = COLOR.CYAN;
      } else if (prompt === FG.TEST_PROMPT.FAILURE) {
        text = FG.T(9);
        color = COLOR.RED;
      } else {
        text = FG.T(10);
        color = COLOR.RED;
      }
      var width = s.measure(FG.FONT16, text);
      var x = (width < 104) ? STORAGE_TEXT_LEFT + Math.trunc((104 - width) / 2) : STORAGE_TEXT_LEFT;
      s.drawTextClipped(FG.FONT16, x, STORAGE_TEXT_RIGHT, STATUS_TEXT_Y, text, color);
    }

    /* 右：判定 */
    var verdict = this.tests.currentVerdict(this.displayedForce);
    var verdictText = this.verdictText(verdict);
    var verdictWidth = s.measure(FG.FONT16, verdictText);
    var vx = (verdictWidth < STATUS_TEXT_RIGHT) ? STATUS_TEXT_RIGHT - verdictWidth : 0;
    s.drawText(FG.FONT16, vx, STATUS_TEXT_Y,
      verdictText, verdict === FG.TEST_VERDICT.OK ? COLOR.WHITE : COLOR.RED);
  };

  Ui.prototype.actionName = function () {
    switch (this.tests.action) {
      case FG.TEST_ACTION.COMPRESSION: return FG.T(64);
      case FG.TEST_ACTION.TENSION: return FG.T(65);
      case FG.TEST_ACTION.INSERT: return FG.T(66);
      case FG.TEST_ACTION.CONTACT: return FG.T(67);
      case FG.TEST_ACTION.BREAK: return FG.T(68);
      default: return "";
    }
  };

  Ui.prototype.drawHome = function () {
    var s = this.screen;
    var snapshot = this.waveform.getSnapshot();

    s.fill(COLOR.BG);
    this.drawBattery();
    s.drawText(FG.FONT16, TIME_TEXT_X, TIME_TEXT_Y, this.displayedTimeText, COLOR.GRAY);
    s.fillRect(0, 23, 240, 1, COLOR.GRID);

    var peakMode = this.settings.testMode() === FG.TEST_MODE.PEAK;
    s.fillRect(6, 27, 48, 16, COLOR.CYAN);
    s.drawText(FG.FONT16, 14, 27, peakMode ? FG.T(62) : FG.T(61), COLOR.BLACK);
    this.drawDirection();
    s.fillRect(0, 45, 240, 1, COLOR.GRID);

    this.drawForceText(this.displayedForceText);
    s.fillRect(0, 117, 240, 1, COLOR.GRID);
    this.drawPeakRows(this.displayedPeakText,
      this.hasSecondPeakRow() ? this.displayedSecondPeakText : null);
    s.fillRect(0, 153, 240, 1, COLOR.GRID);

    this.drawChart(snapshot);
    this.drawAxisText(snapshot);
    s.fillRect(0, 291, 240, 1, COLOR.GRID);
    this.drawBottomBar();
  };

  Ui.prototype.hasSecondPeakRow = function () {
    if (this.settings.testMode() !== FG.TEST_MODE.PEAK) {
      return false;
    }
    var action = this.tests.action;
    return action === FG.TEST_ACTION.INSERT || action === FG.TEST_ACTION.BREAK ||
      action === FG.TEST_ACTION.CONTACT;
  };

  /* ---------- 菜单页 ---------- */

  Ui.prototype.pageTitleId = function (page) {
    switch (page) {
      case PAGE.HOME: return 0;
      case PAGE.MENU: return 1;
      case PAGE.BASIC: return 2;
      case PAGE.SYSTEM: return 3;
      case PAGE.COMM: return 4;
      case PAGE.STORAGE: return 5;
      case PAGE.CALIBRATION: return 6;
      case PAGE.RECORD: return 51;
      default: return 0;
    }
  };

  Ui.prototype.drawTitle = function (page) {
    var s = this.screen;
    if (FG.GetLanguage() === FG.APP_LANG_ZH) {
      s.drawText(FG.FONT24, 12, 10, FG.T(this.pageTitleId(page)), COLOR.WHITE);
    } else {
      s.drawText(FG.FONT16, 12, 12, FG.T(this.pageTitleId(page)), COLOR.WHITE);
    }
    s.fillRect(0, 42, 240, 1, COLOR.GRID);
  };

  Ui.prototype.drawMenu = function () {
    var s = this.screen;
    var zh = (FG.GetLanguage() === FG.APP_LANG_ZH);
    s.fill(COLOR.BG);
    this.drawTitle(PAGE.MENU);

    for (var page = MENU_FIRST_PAGE; page <= MENU_LAST_PAGE; page++) {
      var index = page - MENU_FIRST_PAGE;
      var textY = 54 + index * 39;
      var boxY = 50 + index * 39;
      if (page === this.menuSelection) {
        s.fillRect(12, boxY, 216, 30, COLOR.CYAN);
        if (zh) {
          s.drawText(FG.FONT24, 24, textY, FG.T(this.pageTitleId(page)), COLOR.BLACK);
        } else {
          s.drawText(FG.FONT16, 24, textY + 4, FG.T(this.pageTitleId(page)), COLOR.BLACK);
        }
      } else {
        if (zh) {
          s.drawText(FG.FONT24, 24, textY, FG.T(this.pageTitleId(page)), COLOR.WHITE);
        } else {
          s.drawText(FG.FONT16, 24, textY + 4, FG.T(this.pageTitleId(page)), COLOR.WHITE);
        }
      }
    }

    s.fillRect(0, 257, 240, 1, COLOR.GRID);
    s.drawText(FG.FONT16, 12, 275, FG.T(11), COLOR.GRAY);
    s.drawText(FG.FONT16, 128, 275, FG.T(14), COLOR.GRAY);
    s.drawText(FG.FONT16, 12, 294, FG.T(12), COLOR.GRAY);
    s.drawText(FG.FONT16, 128, 294, FG.T(13), COLOR.GRAY);
  };

  /* ---------- 设定页 ---------- */

  Ui.prototype.settingGroupOf = function (page) {
    switch (page) {
      case PAGE.BASIC: return FG.SETTING_GROUP.BASIC;
      case PAGE.SYSTEM: return FG.SETTING_GROUP.SYSTEM;
      case PAGE.COMM: return FG.SETTING_GROUP.COMM;
      case PAGE.STORAGE: return FG.SETTING_GROUP.STORAGE;
      default: return FG.SETTING_GROUP.BASIC;
    }
  };

  Ui.prototype.settingItems = function (page) {
    return this.settings.getGroupItems(this.settingGroupOf(page));
  };

  Ui.prototype.drawSettingPage = function (page) {
    var s = this.screen;
    var items = this.settingItems(page);
    var itemCount = items.length;
    var rowStep = (itemCount > 7) ? 24 : 29;
    var zh = (FG.GetLanguage() === FG.APP_LANG_ZH);

    s.fill(COLOR.BG);
    this.drawTitle(page);

    for (var i = 0; i < itemCount; i++) {
      var id = items[i];
      var y = 48 + i * rowStep;
      var selected = (i === this.settingFocus);
      var editing = selected && this.settingEditing;
      var editPart = 0xff;
      if (editing && this.settings.getEditPartCount(id) > 1) {
        editPart = this.settingEditPart;
      }
      var label = FG.T(this.settings.getLabelId(id));
      var value = this.settings.formatValue(id, editPart);

      if (selected) {
        s.fillRect(8, y - 2, 224, 20, editing ? COLOR.GREEN : COLOR.CYAN);
      }
      s.fillRect(12, y + 18, 216, 1, COLOR.GRID);

      var labelX = SETTING_LABEL_X;
      if (zh) {
        var labelWidth = s.measure(FG.FONT16, label);
        if (labelWidth > 0 && labelWidth < SETTING_LABEL_COLUMN_WIDTH) {
          labelX = SETTING_LABEL_X + SETTING_LABEL_COLUMN_WIDTH - labelWidth;
        }
      }
      var textColor = selected ? COLOR.BLACK : COLOR.WHITE;
      var valueColor = selected ? COLOR.BLACK : COLOR.CYAN;
      s.drawText(FG.FONT16, labelX, y, label, textColor);
      s.drawText(FG.FONT16, 132, y, value, valueColor);
    }
  };

  /* ---------- 记录页 ---------- */

  Ui.prototype.recordLabel = function (action, second) {
    switch (action) {
      case FG.TEST_ACTION.INSERT: return second ? "FT " : "FP ";
      case FG.TEST_ACTION.CONTACT: return second ? "ACT " : "PEAK ";
      case FG.TEST_ACTION.BREAK: return second ? "FB " : "MAX ";
      case FG.TEST_ACTION.COMPRESSION:
      case FG.TEST_ACTION.TENSION:
      default: return "";
    }
  };

  /* 记录页第二行结果串：标签 + 结果 + 单位；单位跟当前设置，不跟记录里的单位 */
  Ui.prototype.recordResultsText = function (entry) {
    var unit = this.settings.getForceUnit();
    var unitLabel = FG.Unit.label(unit);
    var text = this.recordLabel(entry.a, false);
    if (entry.m & 0x01) {
      text += FG.Unit.formatForce(entry.r1, unit) + " " + unitLabel;
    }
    if ((entry.a === FG.TEST_ACTION.INSERT || entry.a === FG.TEST_ACTION.CONTACT ||
      entry.a === FG.TEST_ACTION.BREAK) && (entry.m & 0x02)) {
      text += " " + this.recordLabel(entry.a, true) +
        FG.Unit.formatForce(entry.r2, unit) + " " + unitLabel;
    }
    return text;
  };

  Ui.prototype.recordActionName = function (action) {
    if (action >= FG.TEST_ACTION.COUNT) {
      return "?";
    }
    return FG.T(64 + action);
  };

  Ui.prototype.recordVerdictColor = function (verdict) {
    return (verdict === FG.TEST_VERDICT.OK) ? COLOR.GREEN : COLOR.RED;
  };

  /* y 居中，宽 >= 236 时退到 x=2，右裁剪到 238 */
  Ui.prototype.drawCentered16 = function (y, text, color) {
    var width = this.screen.measure(FG.FONT16, text);
    var x = (width >= 236) ? 2 : Math.trunc((240 - width) / 2);
    this.screen.drawTextClipped(FG.FONT16, x, 238, y, text, color);
  };

  /* 提示右对齐到 232；放不下时退到 x=8 */
  Ui.prototype.drawHintRight = function (y, text) {
    var width = this.screen.measure(FG.FONT16, text);
    var x = (width < 232) ? 232 - width : 8;
    this.screen.drawText(FG.FONT16, x, y, text, COLOR.GRAY);
  };

  Ui.prototype.drawRecordEntry = function (index, entry) {
    var s = this.screen;
    var rowY = RECORD_ROW_Y0 + index * RECORD_ROW_PITCH;
    var rowY2 = rowY + RECORD_LINE2_DY;
    var showTime = this.settings.data.timeDisplay !== 0;

    /* 序号：5 位补零 */
    var sequence = entry.seq || 0;
    var seqText = String(sequence);
    while (seqText.length < 5) {
      seqText = "0" + seqText;
    }
    s.drawText(FG.FONT16, 2, rowY, seqText, COLOR.WHITE);

    /* 时间：右对齐到 232，时间显示 OFF 或时间非法时不画 */
    var timeX = 8;
    var timeText = "";
    if (showTime) {
      timeText = s.validTimeText(entry.t);
      if (timeText) {
        var timeWidth = s.measure(FG.FONT16, timeText);
        if (timeWidth < 232) {
          timeX = 232 - timeWidth;
        }
        s.drawText(FG.FONT16, timeX, rowY, timeText, COLOR.GRAY);
      }
    }

    /* 动作名：画出时间时右边界收到 timeX-4 */
    var actionRight = 236;
    if (timeText && timeX > 50) {
      actionRight = timeX - 4;
    }
    s.drawTextClipped(FG.FONT16, 46, actionRight, rowY,
      this.recordActionName(entry.a), COLOR.CYAN);

    /* 判定 */
    var verdictText = this.verdictText(entry.v);
    var verdictWidth = s.measure(FG.FONT16, verdictText);
    var verdictX = (verdictWidth < 34) ? 236 - verdictWidth : 202;

    /* 结果串 */
    var results = this.recordResultsText(entry);
    s.drawTextClipped(FG.FONT16, 2, verdictX - 4, rowY2, results, COLOR.WHITE);
    s.drawText(FG.FONT16, verdictX, rowY2, verdictText, this.recordVerdictColor(entry.v));
  };

  Ui.prototype.drawRecordHints = function (confirm) {
    var s = this.screen;
    if (confirm) {
      s.drawText(FG.FONT16, 8, 276, FG.T(11), COLOR.GRAY);
      this.drawHintRight(276, FG.T(17));
      return;
    }
    s.drawText(FG.FONT16, 8, 276, FG.T(11), COLOR.GRAY);
    this.drawHintRight(276, FG.T(18));
    s.drawText(FG.FONT16, 8, 296, FG.T(12), COLOR.GRAY);
    this.drawHintRight(296, FG.T(13));
  };

  Ui.prototype.drawRecordPage = function () {
    var s = this.screen;
    var info = this.records.getPage(this.recordPage, this.settings.data.dataSort);
    s.fill(COLOR.BG);

    /* 标题在所有视图都画，16 px 字体 */
    s.drawText(FG.FONT16, 8, 8, FG.T(51), COLOR.WHITE);

    if (this.recordView === RECORD_VIEW.CLEARING) {
      this.drawCentered16(120, FG.T(23), COLOR.CYAN);
      return;
    }
    if (this.recordView === RECORD_VIEW.CLEAR_FAIL) {
      this.drawCentered16(120, FG.T(24), COLOR.RED);
      s.drawText(FG.FONT16, 8, 296, FG.T(11), COLOR.GRAY);
      return;
    }
    if (this.recordView === RECORD_VIEW.CONFIRM) {
      this.drawCentered16(120, FG.T(25), COLOR.WHITE);
      if (this.recordWait) {
        this.drawCentered16(156, FG.T(22), COLOR.CYAN);
      }
      this.drawRecordHints(true);
      return;
    }

    if (info.recordCount === 0) {
      this.drawCentered16(120, FG.T(19), COLOR.GRAY);
      this.drawRecordHints(false);
      return;
    }

    /* 页码 */
    var pageText = (info.pageIndex + 1) + "/" + info.pageCount;
    this.drawHintRight(8, pageText);

    /* 表头与行框线 */
    s.fillRect(8, RECORD_ROW_Y0 - 5, 224, 2, COLOR.GRAY);
    var firstIndex = info.pageIndex * FG.RECORD_PAGE_SIZE;
    for (var i = 0; i < info.entries.length; i++) {
      var slot = firstIndex + i;
      var entry = info.entries[i];
      entry.seq = info.newestFirst ? (info.recordCount - slot) : (slot + 1);
      this.drawRecordEntry(i, entry);
      if ((i + 1) < info.entries.length) {
        s.fillRect(8, RECORD_ROW_Y0 + i * RECORD_ROW_PITCH + 42, 224, 1, COLOR.GRID);
      }
    }
    var lastY = RECORD_ROW_Y0 + (info.entries.length - 1) * RECORD_ROW_PITCH + 40;
    s.fillRect(8, lastY, 224, 2, COLOR.GRAY);

    this.drawRecordHints(false);
  };

  /* ---------- 校正页 ---------- */

  Ui.prototype.calibrationErrorText = function (error, state) {
    var text = "";
    switch (error) {
      case FG.CAL_ERROR.PASSWORD: text = "密码错误"; break;
      case FG.CAL_ERROR.NO_SAMPLE:
      case FG.CAL_ERROR.ADC: text = "采样异常"; break;
      case FG.CAL_ERROR.UNSTABLE: text = "载荷未稳定"; break;
      case FG.CAL_ERROR.DIRECTION: text = "方向错误"; break;
      case FG.CAL_ERROR.POINT: text = "点位异常"; break;
      case FG.CAL_ERROR.OVER_RANGE: text = "超出量程"; break;
      case FG.CAL_ERROR.SAVE: text = "保存失败"; break;
      default: text = ""; break;
    }
    if (!text) {
      return "";
    }
    /* 只有密码页、采集页和失败结果页会显示错误文案 */
    if (state === FG.CAL_STATE.PASSWORD) {
      return (error === FG.CAL_ERROR.PASSWORD) ? text : "";
    }
    if (state === FG.CAL_STATE.WAIT_STABLE || state === FG.CAL_STATE.RESULT_FAILED) {
      return text;
    }
    return "";
  };

  /* 校正页绘制，坐标对照 app_ui_home.c 的 AppUi_DrawCalibrationPage */
  Ui.prototype.drawCalibrationPage = function () {
    var s = this.screen;
    var view = this.calibration.getSnapshot();
    var unit = this.settings.getForceUnit();
    var unitLabel = FG.Unit.label(unit);
    var zh = (FG.GetLanguage() === FG.APP_LANG_ZH);
    var i;

    s.fill(COLOR.BG);
    if (zh) {
      s.drawText(FG.FONT24, 12, 10, FG.T(6), COLOR.WHITE);
    } else {
      s.drawText(FG.FONT16, 12, 16, FG.T(6), COLOR.WHITE);
    }
    s.fillRect(0, 42, 240, 1, COLOR.GRID);

    var state = view.state;

    if (state === FG.CAL_STATE.PASSWORD) {
      s.drawText(FG.FONT16, 28, 78, "密码", COLOR.WHITE);
      s.fillRect(102 + view.passwordCursor * 16, 72, 14, 24, COLOR.CYAN);
      for (i = 0; i < FG.APP_CAL_PASSWORD_DIGITS; i++) {
        s.drawText(FG.FONT16, 105 + i * 16, 77, String(view.password[i]),
          (i === view.passwordCursor) ? COLOR.BLACK : COLOR.WHITE);
      }
      var passwordError = this.calibrationErrorText(view.error, state);
      if (passwordError) {
        s.drawText(FG.FONT16, 76, 122, passwordError, COLOR.RED);
      }
      s.drawText(FG.FONT16, 8, 270, "UNIT +  DATA >  ZERO <", COLOR.GRAY);
      s.drawText(FG.FONT16, 8, 294, "MENU BACK  PWR OK", COLOR.GRAY);
      return;
    }

    if (state === FG.CAL_STATE.SELECT) {
      var items = [FG.T(33), FG.T(65), FG.T(64)];
      if (view.rangeEditing === 0 && view.selectFocus === 0) {
        s.fillRect(10, 62, 220, 28, COLOR.CYAN);
      } else if (view.rangeEditing !== 0) {
        s.fillRect(10, 62, 220, 28, COLOR.GREEN);
      }
      if (view.selectFocus > 0) {
        var focusY = 66 + view.selectFocus * 48;
        s.fillRect(10, focusY - 4, 220, 28, COLOR.CYAN);
      }
      for (i = 0; i < 3; i++) {
        var rowY = 66 + i * 48;
        var focused = (i === view.selectFocus);
        s.drawText(FG.FONT16, 18, rowY, items[i], focused ? COLOR.BLACK : COLOR.WHITE);
      }
      var rangeText = this.calibrationRangeText(view.rangeIndex);
      s.drawText(FG.FONT16, 150, 66, rangeText, (view.selectFocus === 0) ? COLOR.BLACK : COLOR.CYAN);

      if (view.selectFocus > 0) {
        var valid = (view.selectFocus === 1) ? view.tensionCalibrated : view.compressionCalibrated;
        s.drawText(FG.FONT16, 160, 220, valid ? "已校正" : "未校正",
          valid ? COLOR.CYAN : COLOR.RED);
      }
      s.drawText(FG.FONT16, 8, 270, "UNIT PREV  DATA NEXT", COLOR.GRAY);
      s.drawText(FG.FONT16, 8, 294, "MENU BACK  PWR ENTER", COLOR.GRAY);
      return;
    }

    if (state === FG.CAL_STATE.ABORT_CONFIRM) {
      s.drawText(FG.FONT16, 40, 105, "放弃本次校正？", COLOR.RED);
      s.drawText(FG.FONT16, 36, 145, "PWR 确认放弃", COLOR.WHITE);
      s.drawText(FG.FONT16, 36, 172, "MENU BACK", COLOR.GRAY);
      return;
    }

    if (state === FG.CAL_STATE.SAVING) {
      s.drawText(FG.FONT16, 76, 120, "正在保存", COLOR.CYAN);
      return;
    }

    if (state === FG.CAL_STATE.RESULT_SUCCESS || state === FG.CAL_STATE.RESULT_FAILED) {
      var success = (state === FG.CAL_STATE.RESULT_SUCCESS);
      s.drawText(FG.FONT16, 70, 88, success ? "校正成功" : "校正失败",
        success ? COLOR.GREEN : COLOR.RED);
      s.drawText(FG.FONT16, 28, 122,
        (view.direction === FG.CAL_DIRECTION.TENSION) ? FG.T(65) : FG.T(64), COLOR.WHITE);
      s.drawText(FG.FONT16, 126, 122, this.calibrationRangeText(view.rangeIndex), COLOR.WHITE);
      if (success) {
        s.drawText(FG.FONT16, 90, 154, "已保存", COLOR.CYAN);
      } else {
        s.drawText(FG.FONT16, 46, 154, "旧参数已保留", COLOR.WHITE);
        var resultError = this.calibrationErrorText(view.error, state);
        if (resultError) {
          s.drawText(FG.FONT16, 62, 188, resultError, COLOR.RED);
        }
      }
      s.drawText(FG.FONT16, 8, 294, "MENU/PWR BACK", COLOR.GRAY);
      return;
    }

    if (state === FG.CAL_STATE.WAIT_STABLE) {
      if (view.pointIndex >= FG.APP_CAL_POINT_COUNT) {
        return;
      }
      var percent = 20 * view.pointIndex;
      s.drawText(FG.FONT16, 150, 58,
        (view.pointIndex + 1) + "/6 " + percent + "%", COLOR.CYAN);
      s.drawText(FG.FONT16, 14, 58,
        (view.direction === FG.CAL_DIRECTION.TENSION) ? FG.T(65) : FG.T(64), COLOR.WHITE);

      s.drawText(FG.FONT16, 14, 98, "目标", COLOR.WHITE);
      s.drawText(FG.FONT16, 92, 98, FG.Unit.formatForce(view.targetForceMillinewton, unit), COLOR.CYAN);
      s.drawText(FG.FONT16, 190, 98, unitLabel, COLOR.CYAN);

      s.drawText(FG.FONT16, 14, 132, "实际", COLOR.WHITE);
      s.drawText(FG.FONT16, 92, 132, FG.Unit.formatForce(view.actualForceMillinewton, unit), COLOR.CYAN);
      s.drawText(FG.FONT16, 190, 132, unitLabel, COLOR.CYAN);

      var waitError = this.calibrationErrorText(view.error, state);
      if (waitError) {
        s.drawText(FG.FONT16, 52, 178, waitError, COLOR.RED);
      } else if (view.stable) {
        s.drawText(FG.FONT16, 76, 178, "已稳定", COLOR.GREEN);
      } else {
        s.drawText(FG.FONT16, 76, 178, "等待稳定", COLOR.GRAY);
      }

      s.drawText(FG.FONT16, 14, 220, this.calibrationRangeText(view.rangeIndex), COLOR.WHITE);
      s.drawText(FG.FONT16, 8, 294, "MENU EXIT  PWR CAPTURE", COLOR.GRAY);
      return;
    }
  };

  Ui.prototype.calibrationRangeText = function (rangeIndex) {
    var ranges = FG.FORCE_RANGES;
    var index = rangeIndex % ranges.length;
    return ranges[index].kg + " kg";
  };

  /* ---------- 刷新与事件 ---------- */

  Ui.prototype.refresh = function (tick) {
    if ((tick - this.lastRefreshTick) < REFRESH_PERIOD_MS) {
      return;
    }
    this.lastRefreshTick = tick;

    var displayForce = this.filterForce(this.getForce());
    var text = this.formatForceText(displayForce);
    if (text !== this.displayedForceText) {
      this.displayedForceText = text;
      this.redrawPending = true;
    }

    var peakText;
    var secondText = null;
    if (this.settings.testMode() === FG.TEST_MODE.PEAK) {
      switch (this.tests.action) {
        case FG.TEST_ACTION.INSERT:
          peakText = this.peakDisplayText(this.tests.insertFP);
          secondText = this.peakDisplayText(this.tests.insertFT);
          break;
        case FG.TEST_ACTION.BREAK:
          peakText = this.peakDisplayText(this.tests.breakMax);
          secondText = this.peakDisplayText(this.tests.breakFB);
          break;
        case FG.TEST_ACTION.CONTACT:
          peakText = this.peakDisplayText(this.tests.contactPEAK);
          secondText = this.peakDisplayText(this.tests.contactACT);
          break;
        default:
          peakText = this.peakDisplayText(this.tests.singlePeak);
          break;
      }
    } else {
      peakText = this.peakDisplayText(this.waveform.getPeak());
    }
    if (peakText !== this.displayedPeakText || secondText !== this.displayedSecondPeakText) {
      this.displayedPeakText = peakText;
      this.displayedSecondPeakText = (secondText === null) ? "" : secondText;
      this.redrawPending = true;
    }

    var timeText = FG.formatClock(Date.now());
    if (timeText !== this.displayedTimeText) {
      this.displayedTimeText = timeText;
      this.redrawPending = true;
    }

    if (this.waveform.revision !== this.lastWaveformRevision) {
      this.lastWaveformRevision = this.waveform.revision;
      this.redrawPending = true;
    }

    var verdict = this.tests.currentVerdict(displayForce);
    if (verdict !== this.displayedVerdict) {
      this.displayedVerdict = verdict;
      this.redrawPending = true;
    }

    var actionText = (this.settings.testMode() === FG.TEST_MODE.PEAK) ?
      this.actionName() : "";
    if (actionText !== this.displayedActionText) {
      this.displayedActionText = actionText;
      this.redrawPending = true;
    }

    /* 单位、满量程、模式、动作、存储提示变化都要重绘 */
    if (this.displayedUnit !== this.settings.getForceUnit()) {
      this.displayedUnit = this.settings.getForceUnit();
      this.redrawPending = true;
    }
    if (this.displayedFullScale !== this.fullScale()) {
      this.displayedFullScale = this.fullScale();
      this.redrawPending = true;
    }
    if (this.displayedTestMode !== this.settings.testMode()) {
      this.displayedTestMode = this.settings.testMode();
      this.redrawPending = true;
    }
    if (this.displayedTestAction !== this.settings.testAction()) {
      this.displayedTestAction = this.settings.testAction();
      this.redrawPending = true;
    }
    if (this.displayedStoragePrompt !== this.tests.storagePrompt) {
      this.displayedStoragePrompt = this.tests.storagePrompt;
      this.redrawPending = true;
    }
  };

  Ui.prototype.requestRedraw = function () {
    this.redrawPending = true;
  };

  Ui.prototype.draw = function () {
    switch (this.page) {
      case PAGE.HOME:
        this.drawHome();
        break;
      case PAGE.MENU:
        this.drawMenu();
        break;
      case PAGE.BASIC:
      case PAGE.SYSTEM:
      case PAGE.COMM:
      case PAGE.STORAGE:
        this.drawSettingPage(this.page);
        break;
      case PAGE.RECORD:
        this.drawRecordPage();
        break;
      case PAGE.CALIBRATION:
        this.drawCalibrationPage();
        break;
      default:
        this.screen.fill(COLOR.BG);
        break;
    }
    this.screen.present();
    this.redrawPending = false;
  };

  Ui.prototype.process = function (tick) {
    if (this.page === PAGE.RECORD) this.processRecord(tick);
    if (this.page === PAGE.HOME) {
      this.refresh(tick);
    }
    if (this.page === PAGE.CALIBRATION) {
      this.calibration.process(tick);
      this.redrawPending = true;
    }
    if (this.redrawPending) {
      this.draw();
    }
  };

  Ui.prototype.transfer = function (nextPage) {
    if (nextPage >= PAGE.COUNT || nextPage === this.page) {
      return;
    }
    this.page = nextPage;
    this.enterPage(nextPage);
  };

  Ui.prototype.enterPage = function (page) {
    switch (page) {
      case PAGE.HOME:
        this.lastRefreshTick = this.tick() - REFRESH_PERIOD_MS;
        break;
      case PAGE.BASIC:
      case PAGE.SYSTEM:
      case PAGE.COMM:
      case PAGE.STORAGE:
        this.settingFocus = 0;
        this.settingEditing = 0;
        this.settingEditPart = 0;
        break;
      case PAGE.RECORD:
        this.recordView = RECORD_VIEW.LIST;
        this.recordPage = 0;
        this.recordClearArmed = 0;
        this.recordWait = 0;
        break;
      case PAGE.CALIBRATION:
        this.calibration.enter();
        break;
      default:
        break;
    }
    this.redrawPending = true;
  };

  Ui.prototype.isSettingPage = function (page) {
    return page >= PAGE.BASIC && page <= PAGE.STORAGE;
  };

  Ui.prototype.saveSettingsIfDirty = function () {
    if (this.settings.dirty) {
      this.settings.save();
    }
  };

  /* 设定页事件；返回 true 表示事件已被吃掉 */
  Ui.prototype.handleSettingEvent = function (event) {
    var items = this.settingItems(this.page);
    var itemCount = items.length;
    if (itemCount === 0) {
      return false;
    }
    if (this.settingFocus >= itemCount) {
      this.settingFocus = 0;
    }
    var id = items[this.settingFocus];
    var kind = this.settings.getKind(id);
    var editPartCount = this.settings.getEditPartCount(id);
    var wasEditing = this.settingEditing;

    if (event === EVENT.PREVIOUS) {
      if (this.settingEditing) {
        this.settings.adjust(id, -1, this.settingEditPart);
      } else {
        this.settingFocus = (this.settingFocus === 0) ? itemCount - 1 : this.settingFocus - 1;
      }
      this.redrawPending = true;
      return true;
    }
    if (event === EVENT.NEXT) {
      if (this.settingEditing) {
        this.settings.adjust(id, 1, this.settingEditPart);
      } else {
        this.settingFocus = (this.settingFocus + 1) % itemCount;
      }
      this.redrawPending = true;
      return true;
    }
    if (event === EVENT.MENU) {
      if (this.settingEditing) {
        this.settingEditing = 0;
        this.settingEditPart = 0;
        this.saveSettingsIfDirty();
        this.redrawPending = true;
        return true;
      }
      this.saveSettingsIfDirty();
      return false;
    }
    if (event === EVENT.CONFIRM) {
      if (id === FG.SETTING_ID.TEST_ACTION && this.settings.testMode() !== FG.TEST_MODE.PEAK) {
        return true;
      }
      if (kind === FG.SETTING_KIND.FIXED) {
        return true;
      }
      if (kind === FG.SETTING_KIND.ACTION) {
        if (id === FG.SETTING_ID.STORAGE_LIST) {
          this.transfer(PAGE.RECORD);
        }
        return true;
      }
      if (editPartCount > 1) {
        if (!this.settingEditing) {
          this.settingEditing = 1;
          this.settingEditPart = 0;
        } else if ((this.settingEditPart + 1) < editPartCount) {
          this.settingEditPart++;
        } else {
          this.settingEditing = 0;
          this.settingEditPart = 0;
        }
      } else if (editPartCount === 1) {
        if (this.settingEditing) {
          this.settingEditing = 0;
          this.settingEditPart = 0;
        } else {
          this.settingEditing = 1;
          this.settingEditPart = 0;
        }
      }
      if (wasEditing && !this.settingEditing) {
        this.saveSettingsIfDirty();
      }
      this.redrawPending = true;
      return true;
    }
    return false;
  };

  Ui.prototype.markRecordHold = function () {
    this.recordHoldSuppressClear = 1;
    this.onBeep(100);
  };

  Ui.prototype.dispatchRecordEvent = function (event, tick) {
    if (event === EVENT.MENU) {
      if (this.recordView === RECORD_VIEW.CLEARING) {
        return;
      }
      if (this.recordView === RECORD_VIEW.CONFIRM) {
        this.recordView = RECORD_VIEW.LIST;
        this.recordWait = 0;
      } else if (this.recordView === RECORD_VIEW.CLEAR_FAIL) {
        this.recordView = RECORD_VIEW.LIST;
        this.recordPage = 0;
      } else {
        this.transfer(PAGE.STORAGE);
        return;
      }
      this.redrawPending = true;
      return;
    }
    if (event === EVENT.PREVIOUS || event === EVENT.NEXT) {
      if (this.recordView !== RECORD_VIEW.LIST) {
        return;
      }
      var info = this.records.getPage(this.recordPage, this.settings.data.dataSort);
      if (event === EVENT.PREVIOUS) {
        if (this.recordPage > 0) {
          this.recordPage--;
        }
      } else if ((this.recordPage + 1) < info.pageCount) {
        this.recordPage++;
      }
      this.redrawPending = true;
      return;
    }
    if (event === EVENT.DATA_LONG) {
      if (this.recordHoldSuppressClear) {
        this.recordHoldSuppressClear = 0;
        return;
      }
      if (this.recordView === RECORD_VIEW.LIST) {
        this.recordView = RECORD_VIEW.CONFIRM;
        this.recordClearArmed = 0;
        this.recordWait = 0;
        this.redrawPending = true;
        this.onBeep(100);
      }
      return;
    }
    if (event === EVENT.CONFIRM) {
      if (this.recordView === RECORD_VIEW.CONFIRM && !this.recordClearArmed) {
        this.recordClearArmed = 1;
        this.recordView = this.records.clear() ? RECORD_VIEW.CLEARING : RECORD_VIEW.CLEAR_FAIL;
        this.recordClearTick = tick;
        this.redrawPending = true;
      }
    }
  };

  /* 清空是同步完成的，用一个短延时显示"正在清空" */
  Ui.prototype.processRecord = function (tick) {
    if (this.recordView === RECORD_VIEW.CLEARING &&
      (tick - this.recordClearTick) >= 300) {
      this.recordView = RECORD_VIEW.LIST;
      this.recordPage = 0;
      this.recordClearArmed = 0;
      this.redrawPending = true;
    }
  };

  Ui.prototype.dispatch = function (event, tick) {
    if (event === EVENT.DATA_RELEASE) {
      this.recordHoldSuppressClear = 0;
      return;
    }
    if (this.page === PAGE.RECORD) {
      this.dispatchRecordEvent(event, tick);
      return;
    }
    if (this.page === PAGE.CALIBRATION) {
      var calResult = this.calibration.handleEvent(event, tick);
      if (calResult) {
        this.transfer(PAGE.MENU);
      } else {
        this.redrawPending = true;
      }
      return;
    }
    if (this.isSettingPage(this.page) && this.handleSettingEvent(event)) {
      return;
    }

    switch (this.page) {
      case PAGE.HOME:
        if (event === EVENT.MENU) {
          this.transfer(PAGE.MENU);
        } else if (event === EVENT.NEXT) {
          var outcome = this.onSaveRequest();
          this.redrawPending = true;
        } else if (event === EVENT.DATA_HOLD) {
          this.markRecordHold();
          this.transfer(PAGE.RECORD);
        }
        break;
      case PAGE.MENU:
        if (event === EVENT.MENU) {
          this.transfer(PAGE.HOME);
        } else if (event === EVENT.PREVIOUS) {
          this.menuSelection = (this.menuSelection === MENU_FIRST_PAGE) ?
            MENU_LAST_PAGE : this.menuSelection - 1;
          this.redrawPending = true;
        } else if (event === EVENT.NEXT) {
          this.menuSelection = (this.menuSelection === MENU_LAST_PAGE) ?
            MENU_FIRST_PAGE : this.menuSelection + 1;
          this.redrawPending = true;
        } else if (event === EVENT.CONFIRM) {
          this.transfer(this.menuSelection);
        }
        break;
      case PAGE.BASIC:
      case PAGE.SYSTEM:
      case PAGE.COMM:
      case PAGE.STORAGE:
        if (event === EVENT.MENU) {
          this.transfer(PAGE.MENU);
        }
        break;
      default:
        break;
    }
  };

  Ui.prototype.setPage = function (page) {
    this.page = page;
    this.enterPage(page);
  };

  FG.Ui = Ui;
  FG.PAGE = PAGE;
  FG.UI_EVENT = EVENT;
  FG.RECORD_VIEW = RECORD_VIEW;
})(window.FG = window.FG || {});
