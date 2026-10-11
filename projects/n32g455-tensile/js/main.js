/* 演示页入口：把滑块、输入框、五个按键接到状态机和绘制上。
 *
 * 采样用 requestAnimationFrame，力值采样与波形分桶按真实毫秒时间戳走；
 * 长按计时也用真实毫秒，页面一帧画得慢不会把 2 秒拉长。
 */
(function (FG) {
  "use strict";

  var SAMPLE_PERIOD_MS = 10;   /* 约 100 Hz，对应默认采样频率档 */
  var LONG_MENU_MS = 1000;
  var LONG_UNIT_MS = 2000;
  var LONG_DATA_HOLD_MS = 2000;
  var LONG_DATA_CLEAR_MS = 5000;

  var startTick = performance.now();
  FG.now = function () {
    return performance.now() - startTick;
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function App() {
    var canvas = byId("lcd");
    this.screen = new FG.Screen(canvas);
    this.settings = new FG.Settings().load();

    this.records = new FG.Records();

    this.waveform = new FG.Waveform("scroll");
    this.waveform.setWindowSeconds(this.settings.chartWindowSeconds());

    this.forceInput = new FG.ForceInput({
      fullScale: this.settings.fullScale(),
      unit: this.settings.getForceUnit(),
      onChange: function () { },
      onZeroTrack: function () { },
      onZeroEvent: function () { }
    });

    var self = this;
    /* tests 的回调会用到 waveform，必须先建波形再建测试状态机 */
    this.tests = new FG.Tests();
    this.tests.setFullScale(this.settings.fullScale());
    this.tests.onStart = function () {
      /* 测试开始：切固定窗口并清曲线 */
      self.waveform.setWindowSeconds(self.settings.chartWindowSeconds());
      self.waveform.setMode("fixed");
      self.waveform.reset();
      if (self.onSettingsChanged) {
        self.onSettingsChanged();
      }
    };
    this.tests.onWaveform = function (displayForce, tick) {
      self.waveform.addSample(displayForce, tick);
    };
    this.tests.onFinishWaveform = function () {
      self.waveform.finishCapture();
    };
    this.tests.onClearWaveform = function () {
      self.waveform.reset();
    };
    this.tests.onAutoStore = function () {
      self.requestSave(true);
      self.ui.requestRedraw();
    };

    this.calibration = new FG.Calibration({
      getForce: function () { return self.forceInput.get(); },
      getRangeIndex: function () { return self.settings.data.forceRange; },
      getRangeCount: function () { return FG.FORCE_RANGES.length; },
      getFullScale: function (index) {
        var ranges = FG.FORCE_RANGES;
        return ranges[(index === undefined ? self.settings.data.forceRange : index) %
          ranges.length].mn;
      },
      setRangeIndex: function (index) {
        self.settings.data.forceRange = index;
        self.settings.dirty = true;
      },
      onSave: function (candidate) {
        /* Range and calibration share one write; failures keep the old image. */
        var next = Object.assign({}, self.settings.data, {
          forceRange: candidate.rangeIndex, calibration: candidate
        });
        if (!FG.Storage.saveSettings(next)) return false;
        self.settings.data = next;
        self.settings.dirty = false;
        self.tests.onManualZero();
        return true;
      }
    });

    this.ui = new FG.Ui({
      screen: this.screen,
      settings: this.settings,
      forceInput: this.forceInput,
      tests: this.tests,
      waveform: this.waveform,
      records: this.records,
      calibration: this.calibration,
      getForce: function () { return self.measuredForce(); },
      tick: function () { return FG.now(); },
      onBeep: function (ms) { self.beep(ms); },
      onSaveRequest: function () { return self.requestSave(false); }
    });

    this.lastSampleTick = 0;
    this.audioContext = null;
    this.lastFrameTick = FG.now();
    this.warnings = [];
  }

  /* 蜂鸣：按下、单位切换、进清单、进清空确认各响一次 */
  App.prototype.beep = function (ms) {
    try {
      if (!this.audioContext) {
        var Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) {
          return;
        }
        this.audioContext = new Ctor();
      }
      var ctx = this.audioContext;
      var oscillator = ctx.createOscillator();
      var gain = ctx.createGain();
      oscillator.type = "square";
      oscillator.frequency.value = 2700;
      gain.gain.value = 0.03;
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + (ms || 100) / 1000);
    } catch (err) {
      /* 浏览器禁止自动播放时忽略 */
    }
  };

  /* 保存：把快照写进 localStorage。interactive 为 true 表示自动存储。 */
  App.prototype.requestSave = function (interactive) {
    if (!this.tests.requestSave()) {
      return "none";
    }
    var snapshot = this.tests.snapshot;
    var outcome = this.records.add(
      snapshot,
      Date.now(),
      snapshot.forceUnit,
      snapshot.forceRange,
      snapshot.toleranceLow,
      snapshot.toleranceHigh,
      snapshot.verdict
    );
    this.tests.completeSave(outcome);
    if (outcome === "ok") {
      this.ui.requestRedraw();
    }
    return outcome;
  };

  App.prototype.syncSettings = function () {
    var settings = this.settings;
    var fullScale = settings.fullScale();

    var inputScale = this.ui && this.ui.page === FG.PAGE.CALIBRATION
      ? this.calibration.getFullScale(this.calibration.view.rangeIndex) : fullScale;
    if (inputScale !== this.forceInput.fullScale) this.forceInput.setFullScale(inputScale);
    this.tests.setFullScale(fullScale);
    this.tests.startForce = settings.getStartForce();
    this.tests.toleranceLow = settings.toleranceLow();
    this.tests.toleranceHigh = settings.toleranceHigh();
    this.tests.autoZero = settings.data.autoZero !== 0;
    this.tests.autoZeroDelayMs = settings.data.autoZeroDelaySeconds * 1000;
    this.tests.autoStore = settings.data.autoStore !== 0;
    this.tests.forceUnit = settings.getForceUnit();
    this.tests.forceRange = settings.data.forceRange;
    this.tests.windowSeconds = settings.chartWindowSeconds();
    this.forceInput.setUnit(settings.getForceUnit());
    if (!this.tests.captureActive && !this.tests.resultLocked) {
      this.waveform.setWindowSeconds(settings.chartWindowSeconds());
    }

    if (settings.testMode() === FG.TEST_MODE.PEAK) {
      if (this.waveform.mode !== "fixed") {
        this.waveform.setMode("fixed");
        this.waveform.setWindowSeconds(settings.chartWindowSeconds());
      }
    } else if (this.waveform.mode !== "scroll") {
      this.waveform.setMode("scroll");
    }
    this.tests.setMode(settings.testMode() === FG.TEST_MODE.PEAK ? "peak" : "realtime");
    this.tests.setAction(settings.testAction());
    this.applyOrientation();
    if (this.updateReadout) this.updateReadout();
    if (this.lastInputUnit !== settings.getForceUnit()) {
      this.lastInputUnit = settings.getForceUnit();
      if (this.syncUnitText) this.syncUnitText();
    }
  };

  App.prototype.measuredForce = function () {
    return this.calibration.convertRaw(
      this.calibration.rawFromMillinewton(this.forceInput.get()), this.settings.data.forceRange);
  };

  /* 一个采样点：把模拟力值喂给动作状态机和波形 */
  App.prototype.sample = function (tick) {
    if (this.ui.page === FG.PAGE.CALIBRATION) return;
    var force = this.measuredForce();
    this.tests.addSample(force, force, tick);
  };

  App.prototype.frame = function () {
    var now = FG.now();

    this.forceInput.tick();
    this.syncSettings();

    if ((now - this.lastSampleTick) >= SAMPLE_PERIOD_MS) {
      this.lastSampleTick = now;
      this.sample(now);
    }

    this.tests.process(now);
    this.ui.process(now);

    var self = this;
    window.requestAnimationFrame(function () { self.frame(); });
  };

  /* ---------- 五个按键：短按 / 长按 ---------- */

  App.prototype.wireKeys = function () {
    var self = this;
    var buttons = document.querySelectorAll("#keys button");
    var states = [];

    function press(index) {
      var state = states[index];
      var now = FG.now();
      state.down = true;
      state.downTick = now;
      state.longFired = false;
      state.holdFired = false;
      state.clearFired = false;
      state.element.classList.add("active");
      /* 按下瞬间：短促蜂鸣 */
      self.beep(100);
    }

    function fire(name) {
      self.ui.dispatch(name, FG.now());
    }

    function release(index) {
      var state = states[index];
      if (!state.down) {
        return;
      }
      var now = FG.now();
      var elapsed = now - state.downTick;
      state.down = false;
      state.element.classList.remove("active");

      switch (state.name) {
        case "MENU":
          /* MENU 短按与长按同一条事件 */
          fire(FG.UI_EVENT.MENU);
          break;
        case "UNIT":
          if (state.longFired) break;
          if (elapsed >= LONG_UNIT_MS) {
            /* 长按切单位；校正页内改为上一项 */
            if (self.ui.page === FG.PAGE.CALIBRATION) {
              fire(FG.UI_EVENT.PREVIOUS);
            } else {
              self.settings.cycleForceUnit();
              self.settings.save();
              self.beep(100);
              self.ui.requestRedraw();
            }
          } else {
            fire(FG.UI_EVENT.PREVIOUS);
          }
          break;
        case "ZERO":
          self.handleZero();
          break;
        case "DATA":
          if (!state.holdFired && elapsed < LONG_DATA_HOLD_MS) {
            fire(FG.UI_EVENT.NEXT);
          }
          fire(FG.UI_EVENT.DATA_RELEASE);
          break;
        case "PWR":
          fire(FG.UI_EVENT.CONFIRM);
          break;
        default:
          break;
      }
    }

    function tick() {
      var now = FG.now();
      for (var i = 0; i < states.length; i++) {
        var state = states[i];
        if (!state.down) {
          continue;
        }
        var elapsed = now - state.downTick;
        if (state.name === "UNIT" && !state.longFired && elapsed >= LONG_UNIT_MS) {
          state.longFired = true;
          if (self.ui.page === FG.PAGE.CALIBRATION) {
            fire(FG.UI_EVENT.PREVIOUS);
          } else {
            self.settings.cycleForceUnit();
            self.settings.save();
            self.beep(100);
            self.ui.requestRedraw();
          }
        }
        if (state.name === "DATA") {
          if (!state.holdFired && elapsed >= LONG_DATA_HOLD_MS) {
            state.holdFired = true;
            fire(FG.UI_EVENT.DATA_HOLD);
          }
          if (!state.clearFired && elapsed >= LONG_DATA_CLEAR_MS) {
            state.clearFired = true;
            fire(FG.UI_EVENT.DATA_LONG);
          }
        }
      }
      window.requestAnimationFrame(tick);
    }

    for (var i = 0; i < buttons.length; i++) {
      (function (index) {
        var element = buttons[index];
        var state = {
          name: element.getAttribute("data-key"),
          element: element,
          down: false,
          downTick: 0,
          longFired: false,
          holdFired: false,
          clearFired: false
        };
        states[index] = state;
        element.addEventListener("pointerdown", function (event) {
          event.preventDefault();
          element.setPointerCapture(event.pointerId);
          press(index);
        });
        element.addEventListener("pointerup", function (event) {
          event.preventDefault();
          release(index);
        });
        element.addEventListener("pointercancel", function () {
          state.down = false;
          state.element.classList.remove("active");
          if (state.name === "DATA") fire(FG.UI_EVENT.DATA_RELEASE);
        });
        element.addEventListener("contextmenu", function (event) {
          event.preventDefault();
        });
      })(i);
    }
    window.requestAnimationFrame(tick);
  };

  App.prototype.handleZero = function () {
    if (this.ui.page === FG.PAGE.CALIBRATION) {
      this.ui.dispatch(FG.UI_EVENT.ZERO, FG.now());
      return;
    }
    /* ZERO 短按：去皮、清曲线、清峰值；力值超过 20% FS 时不去皮 */
    var applied = this.forceInput.manualZero();
    if (applied) {
      this.tests.onManualZero();
      this.waveform.resetPeak();
      this.ui.requestRedraw();
    }
  };

  /* ---------- 滑块与力值输入框 ---------- */

  App.prototype.wireControls = function () {
    var self = this;
    var slider = byId("force-slider");
    var thumb = byId("force-thumb");
    var readout = byId("slider-readout");
    var input = byId("force-input");
    var note = byId("clamp-note");
    var dragging = false;

    function updateReadout() {
      var unit = self.settings.getForceUnit();
      readout.textContent = FG.Unit.formatForce(self.forceInput.get(), unit).trim() + " " +
        FG.Unit.label(unit);
      var ratio = self.forceInput.valueToRatio(self.forceInput.get());
      thumb.style.top = (ratio * 100) + "%";
    }
    this.updateReadout = updateReadout;

    function ratioFromEvent(event) {
      var rect = slider.getBoundingClientRect();
      return (event.clientY - rect.top) / rect.height;
    }

    slider.addEventListener("pointerdown", function (event) {
      event.preventDefault();
      slider.setPointerCapture(event.pointerId);
      dragging = true;
      self.forceInput.beginDrag();
      self.forceInput.dragTo(ratioFromEvent(event));
      updateReadout();
    });
    slider.addEventListener("pointermove", function (event) {
      if (!dragging) {
        return;
      }
      event.preventDefault();
      self.forceInput.dragTo(ratioFromEvent(event));
      updateReadout();
    });
    function endDrag() {
      if (!dragging) {
        return;
      }
      dragging = false;
      self.forceInput.endDrag();
    }
    slider.addEventListener("pointerup", function (event) {
      event.preventDefault();
      endDrag();
    });
    slider.addEventListener("pointercancel", endDrag);

    function applyHold() {
      var result = self.forceInput.holdValue(input.value, self.settings.getForceUnit());
      if (result === false) {
        note.textContent = "输入为空或不是数字，力值未改变";
      } else if (result === "clamped") {
        note.textContent = "已钳位到当前额定量程";
        self.forceInput.onChange();
      } else {
        note.textContent = "";
      }
      updateReadout();
    }

    byId("force-hold").addEventListener("click", applyHold);
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        applyHold();
      }
    });

    byId("force-clear").addEventListener("click", function () {
      self.forceInput.clearHold();
      input.value = "";
      note.textContent = "";
      updateReadout();
    });

    var contactSwitch = byId("contact-switch");
    contactSwitch.addEventListener("change", function () {
      self.tests.setContactInput(contactSwitch.checked, FG.now());
    });

    var orientationSwitch = byId("orientation-switch");
    orientationSwitch.addEventListener("change", function () {
      self.applyOrientation();
    });
    this.orientationSwitch = orientationSwitch;

    /* 单位变化后同步输入框文字与读数 */
    this.syncUnitText = function () {
      var unit = self.settings.getForceUnit();
      if (self.forceInput.isHeld()) {
        input.value = FG.Unit.formatForce(self.forceInput.get(), unit).trim();
      }
      updateReadout();
    };
    updateReadout();
  };

  /* 屏幕方向：正向 0°、反向 180°；自动档由朝向开关决定 */
  App.prototype.applyOrientation = function () {
    var direction = this.settings.data.screenDir;
    var reverse = false;
    if (direction === 1) {
      reverse = true;
    } else if (direction === 2) {
      reverse = !!(this.orientationSwitch && this.orientationSwitch.checked);
    }
    this.screen.canvas.style.transform = reverse ? "rotate(180deg)" : "none";
  };

  /* ---------- 状态栏 ---------- */

  App.prototype.updateStatus = function () {
    var lines = [];
    lines.push("模式：" + (this.settings.testMode() === FG.TEST_MODE.PEAK ? "峰值" : "实时") +
      "　动作：" + (this.settings.testMode() === FG.TEST_MODE.PEAK ?
        this.ui.actionName() : "无"));
    lines.push("单位：" + FG.Unit.label(this.settings.getForceUnit()) +
      "　量程：" + FG.FORCE_RANGES[this.settings.data.forceRange % 6].kg + " kg");
    lines.push("力值：" + this.forceInput.get() + " mN　显示死区：" + this.ui.zeroDeadband() + " mN");
    lines.push("记录：" + this.records.count() + " / " + FG.RECORD_MAX);
    var missing = [];
    for (var key in this.screen.missing) {
      if (Object.prototype.hasOwnProperty.call(this.screen.missing, key)) {
        missing.push(key);
      }
    }
    if (missing.length > 0) {
      lines.push("缺字：" + missing.join(" "));
    }
    /* 字库位图长度与头文件不一致时直接报出来，附上修复命令 */
    var fontsToCheck = [["font_16", FG.FONT16], ["font_24", FG.FONT24]];
    var fontShort = [];
    for (var i = 0; i < fontsToCheck.length; i++) {
      var font = fontsToCheck[i][1];
      if (!font || typeof font.bitmap !== "string") {
        fontShort.push(fontsToCheck[i][0] + " 缺失");
        continue;
      }
      var actual = String(font.bitmap).replace(/[\s+]/g, "").length;
      var want = font.bitmapSize * 2;
      if (actual !== want) {
        fontShort.push(fontsToCheck[i][0] + " " + actual + "/" + want + " 字符");
      }
    }
    if (fontShort.length > 0) {
      lines.push("字库不完整：" + fontShort.join("　"));
      lines.push("补齐：python demo/force-gauge/tools/gen_fonts_js.py");
    }
    if (!FG.Storage.isPersistent) {
      lines.push("localStorage 不可用，本次设置与记录不会保留");
    }
    var element = byId("status-lines");
    element.textContent = lines.join("\n");
  };

  App.prototype.run = function () {
    /* 这里才挂回调：构造期间 this.waveform / this.tests 还未就绪 */
    var self = this;
    this.onSettingsChanged = function () {
      self.syncSettings();
    };
    this.wireKeys();
    this.wireControls();
    this.syncSettings();
    this.applyOrientation();
    this.ui.setPage(FG.PAGE.HOME);
    this.ui.draw();

    window.setInterval(function () { self.updateStatus(); }, 250);

    this.frame();
  };

  window.addEventListener("DOMContentLoaded", function () {
    var app = new App();
    FG.app = app;
    app.run();
  });
})(window.FG = window.FG || {});
