/* 记录存储：最多 15000 条，一页 5 条。
 *
 * 固件的扇区、世代和掉电恢复不搬进网页，只保留用户可见结果：
 * 保存成功/失败/已满、清单、翻页、排序、时间显示、一次清空把记录清空。
 * 记录只存可见字段，不存波形点。
 */
(function (FG) {
  "use strict";

  var MAX_RECORDS = 15000;
  var PAGE_SIZE = 5;

  /* 时间：固件用软件日历，网页用本机时间，格式 YY-MM-DD HH:MM:SS */
  function formatTime(ms) {
    var d = new Date(ms);
    var year = d.getFullYear() % 100;
    var text = pad2(year) + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
      " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
    return text;
  }

  function pad2(value) {
    return (value < 10 ? "0" : "") + value;
  }

  function formatClock(ms) {
    var d = new Date(ms);
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }

  function Records() {
    this.list = [];
    this.load();
  }

  Records.prototype.load = function () {
    var raw = FG.Storage.loadRecords();
    var out = [];
    for (var i = 0; i < raw.length && out.length < MAX_RECORDS; i++) {
      var item = raw[i];
      if (item && typeof item === "object" && typeof item.t === "number") {
        out.push(item);
      }
    }
    this.list = out;
  };

  Records.prototype.persist = function () {
    return FG.Storage.saveRecords(this.list);
  };

  Records.prototype.count = function () {
    return this.list.length;
  };

  Records.prototype.isFull = function () {
    return this.list.length >= MAX_RECORDS;
  };

  /* 保存一条已完成的结果快照；返回 'ok' / 'full' / 'fail' */
  Records.prototype.add = function (snapshot, tick, unit, range, toleranceLow, toleranceHigh, verdict) {
    if (this.isFull()) {
      return "full";
    }
    var record = {
      t: tick,
      a: snapshot.action,
      m: snapshot.validMask,
      u: unit,
      g: range,
      v: verdict,
      r1: snapshot.result1,
      r2: snapshot.result2,
      tl: toleranceLow,
      th: toleranceHigh
    };
    this.list.push(record);
    if (!this.persist()) {
      this.list.pop();
      return "fail";
    }
    return "ok";
  };

  Records.prototype.clear = function () {
    if (!FG.Storage.saveRecords([])) return false;
    this.list = [];
    return true;
  };

  Records.prototype.pageCount = function () {
    return Math.max(1, Math.ceil(this.list.length / PAGE_SIZE));
  };

  /* newestFirst = 数据排序：0 最旧 > 最新，1 最新 > 最旧 */
  Records.prototype.getPage = function (pageIndex, newestFirst) {
    var total = this.list.length;
    var count = this.pageCount();
    var page = Math.max(0, Math.min(count - 1, pageIndex | 0));
    var entries = [];
    for (var i = 0; i < PAGE_SIZE; i++) {
      var slot = page * PAGE_SIZE + i;
      if (slot >= total) {
        break;
      }
      var index = newestFirst ? (total - 1 - slot) : slot;
      entries.push(this.list[index]);
    }
    return {
      pageIndex: page,
      pageCount: count,
      recordCount: total,
      newestFirst: !!newestFirst,
      entries: entries
    };
  };

  Records.prototype.formatTime = formatTime;
  Records.prototype.formatClock = formatClock;

  FG.Records = Records;
  FG.RECORD_MAX = MAX_RECORDS;
  FG.RECORD_PAGE_SIZE = PAGE_SIZE;
  FG.formatRecordTime = formatTime;
  FG.formatClock = formatClock;
})(window.FG = window.FG || {});
