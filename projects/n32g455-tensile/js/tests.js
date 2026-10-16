/* 六种峰值动作、判定和完成后的计时。
 *
 * 行为对照 N32G455/APP/app_test.c、app_push_pull_test.c、app_insert_test.c、
 * app_break_test.c、app_contact_test.c、drv_contact_input.c 重写。要点：
 *   - 阈值判定用"显示低通值"，峰值与跌落用"快速值"；网页两路同源，但变量分开
 *   - 资格时间 APP_TEST_QUALIFY_MS = 200 ms，非严格 >=
 *   - 半阈值 H = ceil(S/2)
 *   - 破断回落阈值 d = max(ceil(MAX/5), 50 mN)，20 ms 确认后锁定，再采 300 ms
 *   - 接点：只有在测试已开始后、去抖 10 ms 的第一次 OFF->ON 上升沿才锁存 ACT
 *   - 完成后 resultLocked 置位，只有 ZERO、自动归零到期或切动作/模式才解锁
 */
(function (FG) {
  "use strict";

  var QUALIFY_MS = 200;
  var BREAK_DROP_QUALIFY_MS = 20;
  var BREAK_MIN_DROP_MN = 50;
  var BREAK_POST_CAPTURE_MS = 300;
  var CONTACT_DEBOUNCE_MS = 10;
  var CONTACT_ALIGN_MAX_MS = 1000;
  var STORAGE_PROMPT_MS = 1000;
  var AUTO_STORE_DELAY_MS = 1000;

  var ACTION = { COMPRESSION: 0, TENSION: 1, INSERT: 2, CONTACT: 3, BREAK: 4, BUTTON: 5, COUNT: 6 };
  var PROMPT = { NONE: 0, SUCCESS: 1, FAILURE: 2, FULL: 3 };
  var VERDICT = { LOW: 0, OK: 1, HIGH: 2, ERROR: 3 };
  var MASK1 = 0x01;
  var MASK2 = 0x02;

  function newPushPull() {
    return {
      phase: 0,
      qualifyTick: 0,
      activeStart: 0,
      peak: 0,
      peakValid: 0,
      candidatePeak: 0,
      candidateValid: 0
    };
  }

  function newInsert() {
    return {
      phase: 0,
      qualifyTick: 0,
      activeStart: 0,
      comp: 0, compValid: 0, tension: 0, tensionValid: 0,
      candComp: 0, candCompValid: 0, candTension: 0, candTensionValid: 0
    };
  }

  function newContact() {
    return {
      phase: 0,
      qualifyTick: 0,
      activeStart: 0,
      peak: 0,
      peakValid: 0,
      act: 0,
      triggered: 0
    };
  }

  function newBreak() {
    return {
      phase: 0,
      qualifyTick: 0,
      max: 0,
      maxValid: 0,
      fb: 0,
      fbValid: 0,
      prev: 0,
      prevValid: 0
    };
  }

  function Tests() {
    this.mode = "realtime";
    this.action = ACTION.COMPRESSION;
    this.fullScale = 19613;

    this.pushPull = [newPushPull(), newPushPull()];
    this.insert = newInsert();
    this.contact = newContact();
    this.breakTest = newBreak();
    this.button = new FG.ButtonTest();

    this.contactLevel = false;
    this.contactDebounced = false;
    this.contactRawTick = 0;
    this.contactPending = false;
    this.contactEdgeTick = 0;
    this.contactEdgePending = false;

    this.lastFast = 0;
    this.lastFastValid = false;
    this.previousFast = 0;
    this.previousTick = 0;
    this.previousValid = false;

    this.completed = false;
    this.completeTick = 0;
    this.resultLocked = false;
    this.savePending = false;
    this.completionToken = 0;
    this.snapshot = null;
    this.snapshotValid = false;
    this.snapshotSaved = false;

    this.storagePrompt = PROMPT.NONE;
    this.storagePromptTick = 0;

    this.autoZero = false;
    this.autoZeroDelayMs = 1000;
    this.autoStore = false;
    this.autoStoreAttempted = false;
    this.autoZeroWaiting = false;
    this.activeAutoZero = false;
    this.activeAutoStore = false;
    this.activeAutoZeroDelayMs = 1000;
    this.activeChartEnabled = true;
    this.captureActive = false;

    this.startForce = 200;
    this.toleranceLow = 0;
    this.toleranceHigh = 30000;
    this.forceUnit = 0;
    this.forceRange = 0;
    this.windowSeconds = 10;      /* 曲线窗口秒数，0 表示不画曲线但继续采样 */

    /* 结果给 UI 读 */
    this.singlePeak = null;
    this.insertFP = null;
    this.insertFT = null;
    this.breakMax = null;
    this.breakFB = null;
    this.contactPEAK = null;
    this.contactACT = null;

    this.onStart = null;
    this.onComplete = null;
    this.onAutoZero = null;
    this.onAutoStore = null;
    this.onClearWaveform = null;
  }

  Tests.prototype.halfThreshold = function (start) {
    return Math.trunc(start / 2) + (start % 2);
  };

  Tests.prototype.setMode = function (mode) {
    if (mode === this.mode) {
      return;
    }
    if (this.savePending) {
      return;
    }
    this.mode = mode;
    this.resetResult();
  };

  Tests.prototype.setAction = function (action) {
    if (action === this.action) {
      return;
    }
    if (this.savePending) {
      return;
    }
    this.action = action;
    this.resetResult();
  };

  Tests.prototype.setFullScale = function (fullScale) {
    this.fullScale = fullScale;
    if (this.startForce > fullScale) {
      this.startForce = fullScale;
    }
  };

  Tests.prototype.resetResult = function () {
    this.button = new FG.ButtonTest();
    this.pushPull = [newPushPull(), newPushPull()];
    this.insert = newInsert();
    this.contact = newContact();
    this.breakTest = newBreak();
    this.completed = false;
    this.completeTick = 0;
    this.resultLocked = false;
    this.captureActive = false;
    this.autoZeroWaiting = false;
    this.autoStoreAttempted = false;
    this.snapshot = null;
    this.snapshotValid = false;
    this.snapshotSaved = false;
    this.singlePeak = null;
    this.insertFP = null;
    this.insertFT = null;
    this.breakMax = null;
    this.breakFB = null;
    this.contactPEAK = null;
    this.contactACT = null;
    if (this.onClearWaveform) {
      this.onClearWaveform();
    }
  };

  /* ZERO 或去皮：清结果、清曲线和峰值窗 */
  Tests.prototype.onManualZero = function () {
    if (this.savePending) {
      this.resetAfterSave = true;
      return;
    }
    this.clearStoragePrompt();
    this.resetResult();
  };

  Tests.prototype.clearStoragePrompt = function () {
    this.storagePrompt = PROMPT.NONE;
    this.storagePromptTick = 0;
  };

  /* 接点开关：真实电平变化后去抖 10 ms 才发布上升沿 */
  Tests.prototype.setContactInput = function (level, tick) {
    if (level === this.contactLevel) {
      return;
    }
    this.contactLevel = level;
    this.contactPending = true;
    this.contactRawTick = tick;
  };

  Tests.prototype.processContact = function (tick) {
    if (!this.contactPending) {
      return;
    }
    if ((tick - this.contactRawTick) < CONTACT_DEBOUNCE_MS) {
      return;
    }
    this.contactPending = false;
    if (this.contactLevel !== this.contactDebounced) {
      this.contactDebounced = this.contactLevel;
      if (this.contactDebounced) {
        this.contactEdgePending = true;
        this.contactEdgeTick = tick;
      }
    }
  };

  Tests.prototype.contactIsOn = function () {
    return this.contactDebounced;
  };

  Tests.prototype.takeContactEvent = function () {
    if (!this.contactEdgePending) {
      return false;
    }
    this.contactEdgePending = false;
    return true;
  };

  Tests.prototype.targetEnabled = function () {
    return this.mode === "peak";
  };

  /* 一个采样点；fast 驱动峰值，display 驱动阈值 */
  Tests.prototype.addSample = function (fast, display, tick) {
    this.processContact(tick);

    if (!this.targetEnabled()) {
      if (this.onWaveform) {
        this.onWaveform(display, tick);
      }
      this.recordFast(fast, tick);
      return;
    }

    if (this.resultLocked) {
      this.recordFast(fast, tick);
      return;
    }

    var start = this.startForce;
    var event = 0;
    switch (this.action) {
      case ACTION.COMPRESSION:
        event = this.stepPushPull(0, fast, display, start, tick);
        break;
      case ACTION.TENSION:
        event = this.stepPushPull(1, fast, display, start, tick);
        break;
      case ACTION.INSERT:
        event = this.stepInsert(fast, display, start, tick);
        break;
      case ACTION.CONTACT: {
        this.processContact(tick);
        var edge = this.takeContactEvent();
        var actForce = fast;
        event = this.stepContact(fast, display, start, tick, edge, actForce);
        break;
      }
      case ACTION.BREAK:
        event = this.stepBreak(fast, display, start, tick);
        break;
      case ACTION.BUTTON:
        event = this.button.addSample(Math.max(0, -fast), start, tick, Math.abs(fast) > this.fullScale);
        break;
      default:
        break;
    }

    this.updateVisibleResults();
    if (event === 1) {
      /* STARTED：锁存本测试的设置、切固定窗口、清曲线 */
      this.activeAutoZero = this.autoZero;
      this.activeAutoStore = this.autoStore;
      this.activeAutoZeroDelayMs = this.autoZeroDelayMs;
      this.activeChartEnabled = (this.windowSeconds !== 0);
      this.captureActive = true;
      this.autoStoreAttempted = false;
      if (this.onStart) {
        this.onStart();
      }
      if (this.activeChartEnabled && this.onWaveform) this.onWaveform(display, tick);
      this.recordFast(fast, tick);
      return;
    }

    if (this.captureActive && this.activeChartEnabled && this.onWaveform) {
      this.onWaveform(display, tick);
    }

    if (event === 2) {
      if (this.onFinishWaveform) {
        this.onFinishWaveform();
      }
      this.freezeResult(tick);
    }

    this.recordFast(fast, tick);
  };

  Tests.prototype.recordFast = function (fast, tick) {
    this.previousFast = this.lastFast;
    this.previousTick = this.lastSampleTick || tick;
    this.previousValid = this.lastFastValid;
    this.lastFast = fast;
    this.lastSampleTick = tick;
    this.lastFastValid = true;
  };

  Tests.prototype.updateVisibleResults = function () {
    var state = this.pushPull[this.action === ACTION.TENSION ? 1 : 0];
    if (this.action === ACTION.COMPRESSION || this.action === ACTION.TENSION) {
      this.singlePeak = state.peakValid ? state.peak : null;
    }
    this.insertFP = this.insert.compValid ? this.insert.comp : null;
    this.insertFT = this.insert.tensionValid ? this.insert.tension : null;
    this.contactPEAK = this.contact.peakValid ? this.contact.peak : null;
    this.contactACT = this.contact.triggered ? this.contact.act : null;
    this.breakMax = this.breakTest.maxValid ? this.breakTest.max : null;
    this.breakFB = this.breakTest.fbValid ? this.breakTest.fb : null;
  };

  /* 压缩（dir=0）与拉伸（dir=1）：共用一套状态机 */
  Tests.prototype.stepPushPull = function (dir, fast, display, start, tick) {
    var state = this.pushPull[dir];
    var half = this.halfThreshold(start);
    var directed = (dir === 0)
      ? ((display < 0) ? -display : 0)
      : ((display > 0) ? display : 0);

    if (state.phase === 0) {
      if (directed >= start) {
        state.qualifyTick = tick;
        state.candidatePeak = 0;
        state.candidateValid = 0;
        this.updatePushPullCandidate(state, dir, fast);
        state.phase = 1;
      }
      return 0;
    }
    if (state.phase === 1) {
      this.updatePushPullCandidate(state, dir, fast);
      if (directed < start) {
        state.phase = 0;
        return 0;
      }
      if ((tick - state.qualifyTick) >= QUALIFY_MS) {
        if (state.candidateValid) {
          state.peak = state.candidatePeak;
          state.peakValid = 1;
        } else {
          state.peakValid = 0;
        }
        state.activeStart = start;
        state.phase = 2;
        return 1;
      }
      return 0;
    }
    if (state.phase === 2) {
      this.updatePushPullPeak(state, dir, fast);
      var released = (dir === 0) ? (display > -half) : (display < half);
      if (released) {
        state.qualifyTick = tick;
        state.phase = 3;
      }
      return 0;
    }
    if (state.phase === 3) {
      this.updatePushPullPeak(state, dir, fast);
      var stillReleased = (dir === 0) ? (display > -half) : (display < half);
      if (!stillReleased) {
        state.phase = 2;
        return 0;
      }
      if ((tick - state.qualifyTick) >= QUALIFY_MS) {
        state.phase = 4;
        this.singlePeak = state.peakValid ? state.peak : null;
        return 2;
      }
      return 0;
    }
    return 0;
  };

  Tests.prototype.updatePushPullCandidate = function (state, dir, fast) {
    if (dir === 0) {
      if (fast < 0 && (!state.candidateValid || fast < state.candidatePeak)) {
        state.candidatePeak = fast;
        state.candidateValid = 1;
      }
    } else if (fast > 0 && (!state.candidateValid || fast > state.candidatePeak)) {
      state.candidatePeak = fast;
      state.candidateValid = 1;
    }
  };

  Tests.prototype.updatePushPullPeak = function (state, dir, fast) {
    if (dir === 0) {
      if (fast < 0 && (!state.peakValid || fast < state.peak)) {
        state.peak = fast;
        state.peakValid = 1;
      }
    } else if (fast > 0 && (!state.peakValid || fast > state.peak)) {
      state.peak = fast;
      state.peakValid = 1;
    }
  };

  Tests.prototype.updateInsertPeaks = function (state, fast, display, start, useCandidate) {
    if (fast < 0) {
      var compRef = useCandidate ? state.candComp : state.comp;
      var compValid = useCandidate ? state.candCompValid : state.compValid;
      if (!compValid || fast < compRef) {
        if (useCandidate) {
          state.candComp = fast;
          state.candCompValid = 1;
        } else {
          state.comp = fast;
          state.compValid = 1;
        }
      }
    } else if (fast > 0) {
      var tensionRef = useCandidate ? state.candTension : state.tension;
      var tensionValid = useCandidate ? state.candTensionValid : state.tensionValid;
      if (!tensionValid || fast > tensionRef) {
        if (useCandidate) {
          state.candTension = fast;
          state.candTensionValid = 1;
        } else {
          state.tension = fast;
          state.tensionValid = 1;
        }
      }
    }
    if (display <= -start) {
      if (useCandidate) {
        state.candCompValid = 1;
      } else {
        state.compValid = 1;
      }
    } else if (display >= start) {
      if (useCandidate) {
        state.candTensionValid = 1;
      } else {
        state.tensionValid = 1;
      }
    }
  };

  Tests.prototype.stepInsert = function (fast, display, start, tick) {
    var state = this.insert;
    var magnitude = Math.abs(display);
    var half = this.halfThreshold(start);

    if (state.phase === 0) {
      if (magnitude >= start) {
        state.qualifyTick = tick;
        state.candComp = 0;
        state.candCompValid = 0;
        state.candTension = 0;
        state.candTensionValid = 0;
        this.updateInsertPeaks(state, fast, display, start, true);
        state.phase = 1;
      }
      return 0;
    }
    if (state.phase === 1) {
      this.updateInsertPeaks(state, fast, display, start, true);
      if (magnitude < start) {
        state.phase = 0;
        return 0;
      }
      if ((tick - state.qualifyTick) >= QUALIFY_MS) {
        state.comp = state.candComp;
        state.compValid = state.candCompValid;
        state.tension = state.candTension;
        state.tensionValid = state.candTensionValid;
        state.activeStart = start;
        state.phase = 2;
        return 1;
      }
      return 0;
    }
    if (state.phase === 2 || state.phase === 3) {
      this.updateInsertPeaks(state, fast, display, state.activeStart, false);
      if (state.phase === 2 && state.compValid && state.tensionValid &&
        magnitude < this.halfThreshold(state.activeStart)) {
        state.qualifyTick = tick;
        state.phase = 3;
        return 0;
      }
      if (state.phase === 3) {
        if (magnitude >= this.halfThreshold(state.activeStart)) {
          state.phase = 2;
          return 0;
        }
        if ((tick - state.qualifyTick) >= QUALIFY_MS) {
          state.phase = 4;
          this.insertFP = state.compValid ? state.comp : null;
          this.insertFT = state.tensionValid ? state.tension : null;
          return 2;
        }
      }
      return 0;
    }
    return 0;
  };

  Tests.prototype.stepContact = function (fast, display, start, tick, edge, actForce) {
    var state = this.contact;
    var positive = (display > 0) ? display : 0;
    var half = this.halfThreshold(state.activeStart || start);

    if (state.phase === 0) {
      if (!this.contactIsOn() && positive >= start) {
        state.qualifyTick = tick;
        state.peak = 0;
        state.peakValid = 0;
        state.triggered = 0;
        this.trackContact(state, fast, false, 0);
        state.phase = 1;
      }
      return 0;
    }
    if (state.phase === 1) {
      if (this.contactIsOn() || edge || positive < start) {
        state.phase = 0;
        state.peakValid = 0;
        state.triggered = 0;
        return 0;
      }
      this.trackContact(state, fast, false, 0);
      if ((tick - state.qualifyTick) >= QUALIFY_MS) {
        state.activeStart = start;
        state.phase = 2;
        return 1;
      }
      return 0;
    }
    if (state.phase === 2 || state.phase === 3) {
      if (edge) {
        this.trackContact(state, actForce, true, actForce);
      } else {
        this.trackContact(state, fast, false, 0);
      }
      var released = positive < half;
      if (state.phase === 2 && released) {
        state.qualifyTick = tick;
        state.phase = 3;
        return 0;
      }
      if (state.phase === 3) {
        if (!released) {
          state.phase = 2;
          return 0;
        }
        if ((tick - state.qualifyTick) >= QUALIFY_MS) {
          state.phase = 4;
          this.contactPEAK = state.peakValid ? state.peak : null;
          this.contactACT = state.triggered ? state.act : null;
          return 2;
        }
      }
      return 0;
    }
    return 0;
  };

  Tests.prototype.trackContact = function (state, value, isEdge, actValue) {
    if (state.triggered) {
      return;
    }
    var positive = (value > 0) ? value : 0;
    if (isEdge) {
      state.act = (actValue > 0) ? actValue : 0;
      if (!state.peakValid) {
        state.peak = state.act;
        state.peakValid = 1;
      }
      state.triggered = 1;
      return;
    }
    if (positive !== 0 && (!state.peakValid || positive >= state.peak)) {
      state.peak = value;
      state.peakValid = 1;
    }
  };

  Tests.prototype.stepBreak = function (fast, display, start, tick) {
    var state = this.breakTest;
    var positive = (display > 0) ? display : 0;
    var fastPositive = (fast > 0) ? fast : 0;

    if (state.phase === 0) {
      if (positive >= start) {
        state.qualifyTick = tick;
        state.max = 0;
        state.maxValid = 0;
        state.fb = 0;
        state.fbValid = 0;
        this.updateBreakMax(state, fast);
        state.prev = fast;
        state.prevValid = true;
        state.phase = 1;
      }
      return 0;
    }
    if (state.phase === 1) {
      if (positive < start) {
        state.phase = 0;
        state.maxValid = 0;
        state.prevValid = false;
        return 0;
      }
      this.updateBreakMax(state, fast);
      state.prev = fast;
      state.prevValid = true;
      if ((tick - state.qualifyTick) >= QUALIFY_MS) {
        state.phase = 2;
        return 1;
      }
      return 0;
    }
    if (state.phase === 2) {
      this.updateBreakMax(state, fast);
      if (this.breakDropped(state, fast)) {
        state.fb = state.prevValid ? state.prev : state.max;
        if (state.fb <= 0) {
          state.fb = state.max;
        }
        state.fbValid = 1;
        state.qualifyTick = tick;
        state.phase = 3;
      }
      state.prev = fast;
      state.prevValid = true;
      return 0;
    }
    if (state.phase === 3) {
      this.updateBreakMax(state, fast);
      if (!this.breakDropped(state, fast)) {
        state.fb = 0;
        state.fbValid = 0;
        state.prev = fast;
        state.prevValid = true;
        state.phase = 2;
        return 0;
      }
      state.prev = fast;
      state.prevValid = true;
      if ((tick - state.qualifyTick) >= BREAK_DROP_QUALIFY_MS) {
        state.qualifyTick = tick;
        state.phase = 4;
      }
      return 0;
    }
    if (state.phase === 4) {
      /* 锁定后不再改 MAX/FB，只等 300 ms 波形 */
      if ((tick - state.qualifyTick) >= BREAK_POST_CAPTURE_MS) {
        state.phase = 5;
        this.breakMax = state.maxValid ? state.max : null;
        this.breakFB = state.fbValid ? state.fb : null;
        return 2;
      }
      return 0;
    }
    return 0;
  };

  Tests.prototype.updateBreakMax = function (state, fast) {
    var positive = (fast > 0) ? fast : 0;
    if (positive !== 0 && (!state.maxValid || positive >= state.max)) {
      state.max = (fast > 0) ? fast : 0;
      state.maxValid = 1;
    }
  };

  Tests.prototype.breakDropped = function (state, fast) {
    var max = (state.max > 0) ? state.max : 0;
    var drop = Math.max(Math.trunc(max / 5) + ((max % 5) ? 1 : 0), BREAK_MIN_DROP_MN);
    var positive = (fast > 0) ? fast : 0;
    if (drop >= max) {
      return positive === 0;
    }
    return positive <= (max - drop);
  };

  Tests.prototype.freezeResult = function (tick) {
    this.completionToken++;
    this.completed = true;
    this.completeTick = tick;
    this.resultLocked = true;
    this.captureActive = false;
    this.autoZeroWaiting = this.activeAutoZero;
    this.autoStoreAttempted = false;
    this.snapshotSaved = false;

    var validMask = 0;
    var verdictMask = 0;
    var result1 = 0;
    var result2 = 0;
    var contactResultValid = false;

    switch (this.action) {
      case ACTION.BUTTON:
        if (this.button.valid) {
          validMask = 7;
          result1 = -this.button.fp;
          result2 = -this.button.fc;
        }
        verdictMask = this.buttonResultSelection === 1 ? 3 : this.buttonResultSelection === 2 ? 5 : 1;
        break;
      case ACTION.INSERT:
        if (this.insertFP !== null) {
          validMask |= MASK1;
          result1 = this.insertFP;
        }
        if (this.insertFT !== null) {
          validMask |= MASK2;
          result2 = this.insertFT;
        }
        verdictMask = MASK1 | MASK2;
        break;
      case ACTION.BREAK:
        if (this.breakMax !== null) {
          validMask |= MASK1;
          result1 = this.breakMax;
        }
        if (this.breakFB !== null) {
          validMask |= MASK2;
          result2 = this.breakFB;
        }
        /* 破断的三态公差只判 FB */
        verdictMask = MASK2;
        break;
      case ACTION.CONTACT:
        if (this.contactPEAK !== null) {
          validMask |= MASK1;
          result1 = this.contactPEAK;
        }
        if (this.contactACT !== null) {
          validMask |= MASK2;
          result2 = this.contactACT;
        }
        verdictMask = MASK1 | MASK2;
        contactResultValid = (this.contact.triggered !== 0);
        break;
      case ACTION.COMPRESSION:
      case ACTION.TENSION:
      default:
        if (this.singlePeak !== null) {
          validMask |= MASK1;
          result1 = this.singlePeak;
        }
        verdictMask = MASK1;
        break;
    }

    var requiredMask = (this.action === ACTION.INSERT) ? (MASK1 | MASK2) :
      (this.action === ACTION.BREAK) ? (MASK1 | MASK2) :
        (this.action === ACTION.CONTACT) ? (MASK1 | MASK2) : MASK1;

    var valid = (requiredMask !== 0) &&
      ((validMask & requiredMask) === requiredMask);
    if (this.action === ACTION.BUTTON) valid = this.button.valid;
    if (this.action === ACTION.CONTACT && !contactResultValid) {
      valid = false;
    }

    this.snapshotValid = valid;
    this.snapshot = {
      completionToken: this.completionToken,
      completedAt: tick,
      action: this.action,
      validMask: validMask,
      verdictMask: verdictMask,
      result1: result1,
      result2: result2,
      result3: this.action === ACTION.BUTTON ? -this.button.fr : 0,
      buttonResultSelection: this.buttonResultSelection || 0,
      buttonAlgorithmVersion: this.action === ACTION.BUTTON ? 2 : 0,
      buttonCcX10: this.button.cc,
      buttonCrX10: this.button.cr,
      forceUnit: this.forceUnit,
      forceRange: this.forceRange,
      toleranceLow: this.toleranceLow,
      toleranceHigh: this.toleranceHigh,
      verdict: this.computeVerdict(verdictMask, result1, result2, -this.button.fr)
    };

    if (this.onComplete) {
      this.onComplete(this.snapshot, valid);
    }
  };

  Tests.prototype.judge = function (value) {
    var magnitude = value;
    if (magnitude > this.toleranceHigh) {
      return VERDICT.HIGH;
    }
    if (magnitude < this.toleranceLow) {
      return VERDICT.LOW;
    }
    return VERDICT.OK;
  };

  Tests.prototype.mergeVerdict = function (current, sample) {
    if (current === VERDICT.HIGH || sample === VERDICT.HIGH) {
      return VERDICT.HIGH;
    }
    if (current === VERDICT.LOW || sample === VERDICT.LOW) {
      return VERDICT.LOW;
    }
    return VERDICT.OK;
  };

  Tests.prototype.computeVerdict = function (verdictMask, result1, result2, result3) {
    var verdict = VERDICT.OK;
    var started = false;
    if (verdictMask & MASK1) {
      verdict = this.judge(result1);
      started = true;
    }
    if (verdictMask & MASK2) {
      verdict = started ? this.mergeVerdict(verdict, this.judge(result2)) : this.judge(result2);
      started = true;
    }
    if (verdictMask & 4) verdict = started ? this.mergeVerdict(verdict, this.judge(result3)) : this.judge(result3);
    return verdict;
  };

  /* 主界面判定用的比较对象 */
  Tests.prototype.currentVerdict = function (displayForce) {
    if (this.action === ACTION.BUTTON && this.mode === "peak" && this.resultLocked && !this.snapshotValid) return VERDICT.ERROR;
    if (this.resultLocked && this.snapshot) return this.snapshot.verdict;
    if (this.mode !== "peak") {
      return this.judge(displayForce);
    }
    switch (this.action) {
      case ACTION.INSERT:
        /* 只有一个方向时结果不完整，判定返回 OK */
        if (this.insertFP === null || this.insertFT === null) {
          return VERDICT.OK;
        }
        return this.computeVerdict(MASK1 | MASK2, this.insertFP, this.insertFT);
      case ACTION.CONTACT:
        if (this.contactPEAK === null || this.contactACT === null) {
          return VERDICT.OK;
        }
        return this.computeVerdict(MASK1 | MASK2, this.contactPEAK, this.contactACT);
      case ACTION.BREAK:
        if (this.breakFB === null) {
          return VERDICT.OK;
        }
        return this.judge(this.breakFB);
      case ACTION.COMPRESSION:
      case ACTION.TENSION:
      default:
        if (this.singlePeak === null) {
          return VERDICT.OK;
        }
        return this.judge(this.singlePeak);
    }
  };

  /* 主循环：自动存储与自动归零 */
  Tests.prototype.process = function (tick) {
    this.processContact(tick);

    if ((this.storagePrompt === PROMPT.SUCCESS || this.storagePrompt === PROMPT.FULL) &&
      (tick - this.storagePromptTick) >= STORAGE_PROMPT_MS) {
      this.storagePrompt = PROMPT.NONE;
    }

    if (!this.completed) {
      return;
    }

    var elapsed = tick - this.completeTick;

    if (this.activeAutoStore && this.snapshotValid && !this.snapshotSaved &&
      !this.autoStoreAttempted && elapsed >= AUTO_STORE_DELAY_MS) {
      this.autoStoreAttempted = true;
      if (this.onAutoStore) {
        this.onAutoStore();
      }
    }

    if (!this.autoZeroWaiting) {
      return;
    }
    if (elapsed < this.activeAutoZeroDelayMs) {
      return;
    }
    /* 自动存储失败时暂缓清除 */
    if (this.snapshotValid && !this.snapshotSaved &&
      (this.activeAutoStore || this.autoStoreAttempted)) {
      return;
    }
    this.autoZeroWaiting = false;
    this.resetResult();
  };

  /* 保存请求；返回 true 表示请求已接受（进入 savePending） */
  Tests.prototype.requestSave = function () {
    if (!this.snapshot || !this.snapshotValid || this.snapshotSaved || this.savePending) {
      return false;
    }
    this.autoStoreAttempted = true;
    this.savePending = true;
    return true;
  };

  Tests.prototype.completeSave = function (outcome) {
    this.savePending = false;
    var token = this.snapshot ? this.snapshot.completionToken : 0;
    if (outcome === "ok") {
      this.snapshotSaved = true;
      this.storagePrompt = PROMPT.SUCCESS;
      this.storagePromptTick = FG.now();
    } else if (outcome === "full") {
      this.storagePrompt = PROMPT.FULL;
      this.storagePromptTick = FG.now();
      this.autoStoreAttempted = true;
    } else {
      this.storagePrompt = PROMPT.FAILURE;
      this.storagePromptTick = FG.now();
      this.autoStoreAttempted = true;
    }
    if (this.resetAfterSave) {
      this.resetAfterSave = false;
      this.clearStoragePrompt();
      this.resetResult();
    }
    return token;
  };

  FG.Tests = Tests;
  FG.TEST_ACTION = ACTION;
  FG.TEST_PROMPT = PROMPT;
  FG.TEST_VERDICT = VERDICT;
  FG.APP_TEST_QUALIFY_MS = QUALIFY_MS;
  FG.APP_BREAK_DROP_QUALIFY_MS = BREAK_DROP_QUALIFY_MS;
  FG.APP_BREAK_MIN_DROP_MN = BREAK_MIN_DROP_MN;
  FG.APP_BREAK_POST_CAPTURE_MS = BREAK_POST_CAPTURE_MS;
  FG.CONTACT_INPUT_DEBOUNCE_MS = CONTACT_DEBOUNCE_MS;
})(window.FG = window.FG || {});
