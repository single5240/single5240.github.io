/* 演示页自检：在页面上跑一遍关键规则，把结果打到控制台和状态栏。
 *
 * 这些断言检查的是"实现有没有违反计划与源码规则"，不替代浏览器里的目视验收。
 * 在 index.html 里最早加载，运行时通过 document 事件等待 FG.app 就绪。
 */
(function (FG) {
  "use strict";

  var results = [];

  function check(name, condition, detail) {
    results.push({ name: name, ok: !!condition, detail: detail || "" });
  }

  function approx(a, b, tolerance) {
    return Math.abs(a - b) <= (tolerance === undefined ? 0 : tolerance);
  }

  function runChecks() {
    var app = FG.app;
    if (!app) {
      return;
    }
    /* Self-check fixtures must never change the customer's live state. */
    var settings = new FG.Settings();
    var tests = new FG.Tests();

    /* 1. 单位换算：2 kg 满量程 19613 mN -> 2.000 kg */
    check("kg 格式化 19613 mN = 2.000",
      FG.Unit.formatForce(19613, FG.Unit.UNIT.KG) === " 2.000",
      FG.Unit.formatForce(19613, FG.Unit.UNIT.KG));
    check("N 格式化 12345 mN =  12.34",
      FG.Unit.formatForce(12345, FG.Unit.UNIT.N) === " 12.34",
      "[" + FG.Unit.formatForce(12345, FG.Unit.UNIT.N) + "]");
    check("g 格式化 19613 mN =  2000",
      FG.Unit.formatForce(19613, FG.Unit.UNIT.G).trim() === "2000",
      FG.Unit.formatForce(19613, FG.Unit.UNIT.G));
    check("单位标签顺序 N/g/kg/lb",
      FG.Unit.label(0) === "N" && FG.Unit.label(1) === "g" &&
      FG.Unit.label(2) === "kg" && FG.Unit.label(3) === "lb");

    /* 2. 单位循环 g -> kg -> N -> lb -> g */
    var order = [];
    var saved = settings.data.forceUnit;
    settings.data.forceUnit = FG.Unit.UNIT.G;
    for (var i = 0; i < 4; i++) {
      order.push(settings.cycleForceUnit());
    }
    check("单位循环 g->kg->N->lb->g",
      order[0] === FG.Unit.UNIT.KG && order[1] === FG.Unit.UNIT.N &&
      order[2] === FG.Unit.UNIT.LB && order[3] === FG.Unit.UNIT.G,
      order.join(","));
    settings.data.forceUnit = saved;

    /* 3. 额定量程只读；改量程走校正页 */
    check("额定量程是只读项",
      settings.getKind(FG.SETTING_ID.FORCE_RANGE) === FG.SETTING_KIND.FIXED);
    check("额定量程不从设定页调整",
      settings.adjust(FG.SETTING_ID.FORCE_RANGE, 1, 0) === false);

    /* 4. 起始值边界：10 mN 到满量程，步进 100 mN */
    var rangeState = new FG.Settings();
    rangeState.data.forceRange = 0;      /* 2 kg -> 19613 mN */
    rangeState.data.startForceMillinewton = 10;
    rangeState.adjust(FG.SETTING_ID.START_FORCE, -1, 0);
    check("起始值下限 10 mN", rangeState.getStartForce() === 10,
      String(rangeState.getStartForce()));
    rangeState.data.startForceMillinewton = 99999;
    check("起始值上限 = 满量程", rangeState.getStartForce() === 19613,
      String(rangeState.getStartForce()));

    /* 5. 公差边界：等于上下限算合格 */
    var toleranceTests = new FG.Tests();
    toleranceTests.toleranceLow = 1000;
    toleranceTests.toleranceHigh = 3000;
    check("公差等于上限算合格",
      toleranceTests.judge(3000) === FG.TEST_VERDICT.OK);
    check("公差等于下限算合格",
      toleranceTests.judge(1000) === FG.TEST_VERDICT.OK);
    check("公差超上限为 +NG",
      toleranceTests.judge(3001) === FG.TEST_VERDICT.HIGH);
    check("公差低于下限为 -NG",
      toleranceTests.judge(999) === FG.TEST_VERDICT.LOW);
    check("+NG 优先于 -NG",
      toleranceTests.mergeVerdict(FG.TEST_VERDICT.LOW, FG.TEST_VERDICT.HIGH) ===
      FG.TEST_VERDICT.HIGH);

    /* 6. 半阈值是 ceil(S/2) */
    check("半阈值 ceil(200/2) = 100", tests.halfThreshold(200) === 100);
    check("半阈值 ceil(201/2) = 101", tests.halfThreshold(201) === 101);

    /* 7. 破断回落阈值 d = max(ceil(P/5), 50) */
    var breakTests = new FG.Tests();
    breakTests.breakTest.max = 1000;
    check("破断 1000 mN 跌到 800 mN 达到 20% 边界",
      breakTests.breakDropped(breakTests.breakTest, 800) === true);
    check("破断 1000 mN 跌到 799 mN 算跌落",
      breakTests.breakDropped(breakTests.breakTest, 799) === true);
    breakTests.breakTest.max = 100;
    check("破断 100 mN 时 50 mN 绝对量占主导：跌到 49 算跌落",
      breakTests.breakDropped(breakTests.breakTest, 49) === true &&
      breakTests.breakDropped(breakTests.breakTest, 51) === false);
    breakTests.breakTest.max = 40;
    check("破断最大值 <= 50 mN 时必须回到 0 才算跌落",
      breakTests.breakDropped(breakTests.breakTest, 0) === true &&
      breakTests.breakDropped(breakTests.breakTest, 1) === false);

    /* 8. 单调方向检查 */
    var cal = new FG.Calibration({getForce: function () { return 0; },
      getRangeIndex: function () { return 0; }, getFullScale: function () { return 19613; }});
    cal.view.pointIndex = 1;
    cal.view.direction = FG.CAL_DIRECTION.TENSION;
    cal.points[0] = 8000000;
    check("拉伸第 2 点必须比第 0 点大",
      cal.pointDirectionIsValid(8000001) === true &&
      cal.pointDirectionIsValid(7999999) === false);
    cal.view.direction = FG.CAL_DIRECTION.COMPRESSION;
    check("压缩第 2 点必须比第 0 点小",
      cal.pointDirectionIsValid(7999999) === true &&
      cal.pointDirectionIsValid(8000001) === false);
    cal.view.pointIndex = 0;
    check("第 1 点不做方向检查", cal.pointDirectionIsValid(1) === true);

    /* 9. 校正目标值是 FS * 点序号 / 5 */
    var expected = [0, 3922, 7845, 11767, 15690, 19613];
    var targetOk = true;
    for (var p = 0; p < 6; p++) {
      cal.view.rangeIndex = 0;
      cal.view.direction = FG.CAL_DIRECTION.TENSION;
      cal.view.pointIndex = p;
      cal.updateTarget();
      if (cal.view.targetForceMillinewton !== expected[p]) {
        targetOk = false;
      }
    }
    check("2 kg 档六点目标 0/3922/7845/11767/15690/19613 mN", targetOk);

    /* 10. 零点回滞：进入 FS/800、退出 FS/400 */
    var ui = new FG.Ui({screen: app.screen, settings: settings, tests: tests,
      waveform: new FG.Waveform(), records: app.records, calibration: cal,
      getForce: function () { return 0; }, tick: function () { return 0; }});
    ui.forceZeroActive = true;
    ui.displayedForce = 0;
    check("零点回滞进入阈值按固件四舍五入 = 25 mN",
      ui.zeroDeadband() === 25, String(ui.zeroDeadband()));
    var shown = ui.filterForce(24);
    check("24 mN 仍显示 0", shown === 0, String(shown));
    shown = ui.filterForce(50);
    check("50 mN 退出零点", shown === 50, String(shown));

    /* 11. 波形分桶：50 ms 一桶，平均整数截断 */
    var wave = new FG.Waveform("scroll");
    wave.addSample(100, 0);
    wave.addSample(200, 10);
    wave.addSample(300, 50);
    wave.finishCapture();
    var snapshot = wave.getSnapshot();
    check("50 ms 边界分开两桶，前桶平均 = 150",
      snapshot.count === 2 && snapshot.points[0].average === 150,
      JSON.stringify(snapshot.points[0]));
    check("桶内最小/最大正确",
      snapshot.points[0].minimum === 100 && snapshot.points[0].maximum === 200);

    /* 12. 10 秒滚动峰值窗保留绝对值最大的样本 */
    var peakWave = new FG.Waveform("scroll");
    peakWave.addPeakSample(-500, 0);
    peakWave.addPeakSample(500, 10);
    check("同桶等幅取最新（+500）", peakWave.getPeak() === 500,
      String(peakWave.getPeak()));

    /* 13. 设定页分组条目数 */
    check("基本设定 9 项 / 系统设定 10 项 / 通信 6 项 / 存储 5 项",
      settings.getGroupItems(FG.SETTING_GROUP.BASIC).length === 9 &&
      settings.getGroupItems(FG.SETTING_GROUP.SYSTEM).length === 10 &&
      settings.getGroupItems(FG.SETTING_GROUP.COMM).length === 6 &&
      settings.getGroupItems(FG.SETTING_GROUP.STORAGE).length === 5);

    /* 14. 记录上限与分页 */
    check("记录上限 15000 条", FG.RECORD_MAX === 15000);
    check("每页 5 条", FG.RECORD_PAGE_SIZE === 5);
    var fakeRecords = new FG.Records();
    var savedList = fakeRecords.list;
    fakeRecords.list = [];
    for (var r = 0; r < 12; r++) {
      fakeRecords.list.push({ t: 0, a: 0, m: 1, u: 0, g: 0, v: 1, r1: 100, r2: 0, tl: 0, th: 30000 });
    }
    check("12 条记录分 3 页", fakeRecords.pageCount() === 3);
    var firstPage = fakeRecords.getPage(0, false);
    check("最旧 > 最新时首页从第 1 条开始",
      firstPage.newestFirst === false && firstPage.entries.length === 5);
    var newestPage = fakeRecords.getPage(0, true);
    check("最新 > 最旧时首页仍取 5 条", newestPage.entries.length === 5);
    fakeRecords.list = savedList;

    /* 15. 字库数据完整性：去掉换行与缩进后，十六进制字符数必须等于字节数 * 2 */
    function hexLength(font) {
      return String(font.bitmap).replace(/[\s+]/g, "").length;
    }
    function hexOk(font) {
      var text = String(font.bitmap).replace(/[\s+]/g, "");
      return /^[0-9a-fA-F]*$/.test(text) && (text.length % 2 === 0);
    }
    check("font_16 位图 = 6624 字节",
      hexLength(FG.FONT16) === FG.FONT16.bitmapSize * 2 && hexOk(FG.FONT16),
      "实测 " + hexLength(FG.FONT16) + " 字符，期望 " + (FG.FONT16.bitmapSize * 2) +
      "（缺 " + ((FG.FONT16.bitmapSize * 2) - hexLength(FG.FONT16)) + " 字符）");
    check("font_24 位图 = 2952 字节",
      hexLength(FG.FONT24) === FG.FONT24.bitmapSize * 2 && hexOk(FG.FONT24),
      "实测 " + hexLength(FG.FONT24) + " 字符，期望 " + (FG.FONT24.bitmapSize * 2));
    var num40Ok = FG.NUM40.glyphs.length === 12;
    var num40Detail = FG.NUM40.glyphs.length + " 个字形";
    for (var g = 0; g < FG.NUM40.glyphs.length; g++) {
      var glyphText = String(FG.NUM40.glyphs[g]).replace(/[\s+]/g, "");
      if (glyphText.length !== 240) {
        num40Ok = false;
        num40Detail += " 第" + (g + 1) + "个 " + glyphText.length + " 字符";
      }
    }
    check("num40 12 个字形，每个 240 字符", num40Ok, num40Detail);
    check("font_16 字形数 255 / font_24 字形数 47",
      FG.FONT16.glyphs.length === 255 && FG.FONT24.glyphs.length === 47,
      FG.FONT16.glyphs.length + " / " + FG.FONT24.glyphs.length);
    check("font_16 末项偏移 + 长度 = 位图字节数",
      (FG.FONT16.glyphs[254][2] + FG.FONT16.glyphs[254][3]) === FG.FONT16.bitmapSize,
      String(FG.FONT16.glyphs[254][2] + FG.FONT16.glyphs[254][3]));
    check("font_24 末项偏移 + 长度 = 位图字节数",
      (FG.FONT24.glyphs[46][2] + FG.FONT24.glyphs[46][3]) === FG.FONT24.bitmapSize,
      String(FG.FONT24.glyphs[46][2] + FG.FONT24.glyphs[46][3]));

    /* 16. 字体是否覆盖当前界面文案 */
    var missing = Object.keys(app.screen.missing || {});
    check("当前画面没有缺字", missing.length === 0, missing.join(" "));

    /* 16. 配置常量与源码一致 */
    check("资格时间 200 ms", FG.APP_TEST_QUALIFY_MS === 200);
    check("破断 20 ms 确认 / 300 ms 后段",
      FG.APP_BREAK_DROP_QUALIFY_MS === 20 && FG.APP_BREAK_POST_CAPTURE_MS === 300);
    check("破断最小回落 50 mN", FG.APP_BREAK_MIN_DROP_MN === 50);
    check("接点去抖 10 ms", FG.CONTACT_INPUT_DEBOUNCE_MS === 10);
    check("波形 201 点 / 50 ms 桶 / 10 秒峰值窗",
      FG.WAVEFORM_POINT_COUNT === 201 && FG.WAVEFORM_POINT_PERIOD_MS === 50 &&
      FG.WAVEFORM_PEAK_WINDOW_MS === 10000);
    check("校正稳定窗口 200 ms / 容差 5 千分比",
      FG.APP_CAL_STABLE_TIME_MS === 200 &&
      FG.APP_CAL_STABLE_TOLERANCE_PERMILLE === 5);
    check("校正六点 / 密码四位",
      FG.APP_CAL_POINT_COUNT === 6 && FG.APP_CAL_PASSWORD_DIGITS === 4);
    check("零点回滞 800 / 400",
      FG.FORCE_ZERO_ENTER_DIVISOR === 800 && FG.FORCE_ZERO_EXIT_DIVISOR === 400);

    var failed = results.filter(function (item) { return !item.ok; });
    FG.selfCheck = {
      results: results,
      failed: failed,
      summary: results.length + " 项自检，" + (results.length - failed.length) + " 项通过，" +
        failed.length + " 项失败"
    };

    if (window.console) {
      for (var k = 0; k < results.length; k++) {
        var item = results[k];
        if (item.ok) {
          console.log("[自检通过] " + item.name);
        } else {
          console.error("[自检失败] " + item.name + " " + item.detail);
        }
      }
      console.log(FG.selfCheck.summary);
    }
    var element = document.getElementById("selfcheck");
    if (element) {
      element.textContent = FG.selfCheck.summary +
        (failed.length ? "\n" + failed.map(function (item) {
          return "✗ " + item.name + " " + item.detail;
        }).join("\n") : "");
      element.className = failed.length ? "warn" : "";
    }
  }

  window.addEventListener("load", function () {
    window.setTimeout(runChecks, 600);
  });
})(window.FG = window.FG || {});
