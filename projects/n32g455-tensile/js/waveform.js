/* 波形聚合与历史缓冲。
 *
 * 规则对照 N32G455/APP/app_waveform.c：
 *   - 201 点；滚动模式桶周期固定 50 ms，固定窗口模式桶周期 = 5 x 窗口秒数
 *   - 桶平均 = trunc(桶内和 / 桶内样本数)，最小/最大取原值
 *   - 桶边界按网格对齐（bucketStart + k*P），恰好到 P 就提交
 *   - 跳过的桶用 valid=0 的占位点补齐，UI 遇到 valid=0 断开折线
 *   - 滚动模式为环形缓冲，固定窗口为线性缓冲写满即停
 *   - 另有 10 秒滚动峰值窗：200 个 50 ms 桶，每桶保留绝对值最大的样本
 */
(function (FG) {
  "use strict";

  var POINT_COUNT = 201;
  var POINT_PERIOD_MS = 50;
  var PEAK_WINDOW_MS = 10000;
  var PEAK_BUCKET_COUNT = PEAK_WINDOW_MS / POINT_PERIOD_MS; /* 200 */

  function Waveform(mode) {
    this.points = new Array(POINT_COUNT);
    for (var i = 0; i < POINT_COUNT; i++) {
      this.points[i] = { average: 0, minimum: 0, maximum: 0, valid: 0 };
    }
    this.writeIndex = 0;
    this.count = 0;
    this.mode = mode === undefined ? "scroll" : mode;
    this.windowSeconds = 10;
    this.bucketStart = 0;
    this.bucketSum = 0;
    this.bucketSampleCount = 0;
    this.bucketMin = 0;
    this.bucketMax = 0;
    this.bucketActive = false;
    this.revision = 0;

    this.peakBuckets = new Array(PEAK_BUCKET_COUNT);
    for (var j = 0; j < PEAK_BUCKET_COUNT; j++) {
      this.peakBuckets[j] = { value: 0, valid: 0 };
    }
    this.peakStarted = false;
    this.peakBucketTick = 0;
    this.peakIndex = 0;
  }

  Waveform.prototype.period = function () {
    if (this.mode === "fixed") {
      var period = 5 * this.windowSeconds;
      return (period < 1) ? 1 : period;
    }
    return POINT_PERIOD_MS;
  };

  Waveform.prototype.clearData = function () {
    for (var i = 0; i < POINT_COUNT; i++) {
      this.points[i].valid = 0;
    }
    this.writeIndex = 0;
    this.count = 0;
    this.bucketActive = false;
    this.bucketSum = 0;
    this.bucketSampleCount = 0;
    this.revision++;
  };

  Waveform.prototype.reset = function () {
    this.clearData();
    this.resetPeak();
  };

  Waveform.prototype.resetPeak = function () {
    for (var i = 0; i < PEAK_BUCKET_COUNT; i++) {
      this.peakBuckets[i].valid = 0;
      this.peakBuckets[i].value = 0;
    }
    this.peakStarted = false;
    this.peakBucketTick = 0;
    this.peakIndex = 0;
  };

  Waveform.prototype.setMode = function (mode) {
    if (mode !== "scroll" && mode !== "fixed") {
      return;
    }
    if (mode === this.mode) {
      return;
    }
    this.mode = mode;
    this.reset();
  };

  Waveform.prototype.setWindowSeconds = function (seconds) {
    if (seconds > 99) {
      seconds = 99;
    }
    if (seconds !== this.windowSeconds) {
      var wasFixed = (this.mode === "fixed");
      this.windowSeconds = seconds;
      if (wasFixed) {
        this.reset();
      }
    }
  };

  Waveform.prototype.appendPoint = function (avg, min, max, valid) {
    if (this.mode === "fixed") {
      if (this.count >= POINT_COUNT) {
        return;
      }
      var slot = this.points[this.count];
      slot.average = avg;
      slot.minimum = min;
      slot.maximum = max;
      slot.valid = valid;
      this.count++;
    } else {
      var ring = this.points[this.writeIndex];
      ring.average = avg;
      ring.minimum = min;
      ring.maximum = max;
      ring.valid = valid;
      this.writeIndex = (this.writeIndex + 1) % POINT_COUNT;
      if (this.count < POINT_COUNT) {
        this.count++;
      }
    }
    this.revision++;
  };

  Waveform.prototype.startBucket = function (force, tick) {
    this.bucketActive = true;
    this.bucketStart = tick;
    this.bucketSum = force;
    this.bucketSampleCount = 1;
    this.bucketMin = force;
    this.bucketMax = force;
  };

  Waveform.prototype.commitBucket = function () {
    if (!this.bucketActive) {
      return;
    }
    /* 平均值按 C 的整数除法，向零截断 */
    var average = (this.bucketSum < 0)
      ? -Math.trunc(-this.bucketSum / this.bucketSampleCount)
      : Math.trunc(this.bucketSum / this.bucketSampleCount);
    this.appendPoint(average, this.bucketMin, this.bucketMax, 1);
    this.bucketActive = false;
    this.bucketSum = 0;
    this.bucketSampleCount = 0;
  };

  Waveform.prototype.finishCapture = function () {
    this.commitBucket();
  };

  /* 加入一个显示值样本 */
  Waveform.prototype.addSample = function (force, tick) {
    if (this.mode === "fixed" && (this.windowSeconds === 0 || this.count >= POINT_COUNT)) {
      this.addPeakSample(force, tick);
      return;
    }
    var period = this.period();
    if (!this.bucketActive) {
      this.startBucket(force, tick);
      this.addPeakSample(force, tick);
      return;
    }
    var elapsed = tick - this.bucketStart;
    if (elapsed >= period) {
      var periods = Math.trunc(elapsed / period);
      this.commitBucket();
      /* 跳过的桶用无效占位点补齐，最多补到点数上限 */
      var missing = Math.min(periods - 1, POINT_COUNT);
      for (var i = 0; i < missing; i++) {
        this.appendPoint(0, 0, 0, 0);
      }
      this.startBucket(force, this.bucketStart + periods * period);
      this.addPeakSample(force, tick);
      return;
    }
    this.bucketSum += force;
    this.bucketSampleCount++;
    if (force < this.bucketMin) {
      this.bucketMin = force;
    }
    if (force > this.bucketMax) {
      this.bucketMax = force;
    }
    this.addPeakSample(force, tick);
  };

  /* 10 秒滚动峰值窗：桶边界是绝对时基网格 t - t%50 */
  Waveform.prototype.addPeakSample = function (force, tick) {
    var bucketTick = tick - (tick % POINT_PERIOD_MS);
    if (!this.peakStarted) {
      this.peakStarted = true;
      this.peakBucketTick = bucketTick;
      this.peakIndex = 0;
      this.peakBuckets[0].valid = 0;
      this.peakBuckets[0].value = force;
      this.peakBuckets[0].valid = 1;
      return;
    }
    var steps = Math.trunc((bucketTick - this.peakBucketTick) / POINT_PERIOD_MS);
    if (steps > PEAK_BUCKET_COUNT) {
      steps = PEAK_BUCKET_COUNT;
    }
    for (var i = 0; i < steps; i++) {
      this.peakIndex = (this.peakIndex + 1) % PEAK_BUCKET_COUNT;
      this.peakBuckets[this.peakIndex].valid = 0;
    }
    if (steps > 0) {
      this.peakBucketTick = bucketTick;
    }
    var slot = this.peakBuckets[this.peakIndex];
    if (!slot.valid || Math.abs(force) >= Math.abs(slot.value)) {
      slot.value = force;
      slot.valid = 1;
    }
  };

  /* 从最旧桶升序遍历，并列取最新 */
  Waveform.prototype.getPeak = function () {
    var best = null;
    var found = false;
    for (var i = 0; i < PEAK_BUCKET_COUNT; i++) {
      var index = (this.peakIndex + 1 + i) % PEAK_BUCKET_COUNT;
      var slot = this.peakBuckets[index];
      if (!slot.valid) {
        continue;
      }
      if (!found || Math.abs(slot.value) >= Math.abs(best)) {
        best = slot.value;
        found = true;
      }
    }
    return found ? best : null;
  };

  Waveform.prototype.getSnapshot = function () {
    var out = [];
    var total = this.count;
    var start;
    if (this.mode === "scroll") {
      start = (total >= POINT_COUNT) ? this.writeIndex : 0;
    } else {
      start = 0;
    }
    for (var i = 0; i < total; i++) {
      var p = this.points[(start + i) % POINT_COUNT];
      out.push({
        average: p.average,
        minimum: p.minimum,
        maximum: p.maximum,
        valid: p.valid
      });
    }
    return {
      points: out,
      count: total,
      mode: this.mode,
      windowSeconds: (this.mode === "fixed") ? this.windowSeconds : 10,
      revision: this.revision
    };
  };

  FG.Waveform = Waveform;
  FG.WAVEFORM_POINT_COUNT = POINT_COUNT;
  FG.WAVEFORM_POINT_PERIOD_MS = POINT_PERIOD_MS;
  FG.WAVEFORM_PEAK_WINDOW_MS = PEAK_WINDOW_MS;
})(window.FG = window.FG || {});
