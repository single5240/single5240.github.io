/* 由 N32G455/APP/app_i18n.c 转写。表顺序与 AppStrId 枚举一致。
 * 原文件用 \xNN 转义写 UTF-8，这里直接写明文，内容逐字对应。
 * 中文文案必须落在点阵字库字形内，不要在页面里另写译法。
 *
 * 注意：演示页用普通脚本加载（不是 ES module），所以这里通过 FG 命名空间导出，
 * 不使用 export / import —— 否则整页会因语法错误而无法启动。
 */
(function (FG) {
  "use strict";

  var STR = {
    /* 页面 / 菜单标题 */
    PAGE_HOME: 0, PAGE_SETTINGS: 1, PAGE_BASIC: 2, PAGE_SYSTEM: 3, PAGE_COMM: 4,
    PAGE_STORAGE: 5, PAGE_CALIBRATION: 6,
    /* 主界面 */
    HOME_PEAK: 7, HOME_STORE_SUCCESS: 8, HOME_STORE_FAILURE: 9, HOME_STORE_FULL: 10,
    /* 底栏提示 */
    HINT_MENU_BACK: 11, HINT_UNIT_PREV: 12, HINT_DATA_NEXT: 13, HINT_PWR_ENTER: 14,
    HINT_SETTING_BROWSE: 15, HINT_SETTING_EDIT: 16, HINT_PWR_CONFIRM: 17,
    HINT_DATA_CLEAR: 18,
    RECORD_EMPTY: 19, RECORD_LOADING: 20, RECORD_READ_FAIL: 21, RECORD_WAIT: 22,
    RECORD_CLEARING: 23, RECORD_CLEAR_FAIL: 24, RECORD_CLEAR_ASK: 25,
    /* 设定项标签 */
    ITEM_TEST_MODE: 26, ITEM_TEST_ACTION: 27, ITEM_SAMPLE_RATE: 28,
    ITEM_TRANSFER_RATE: 29, ITEM_AUTO_ZERO: 30, ITEM_AUTO_ZERO_DELAY: 31,
    ITEM_TOLERANCE: 32, ITEM_FORCE_RANGE: 33, ITEM_START_FORCE: 34,
    ITEM_GRAVITY: 35, ITEM_AUTO_SLEEP: 36, ITEM_EXT_FUNC: 37, ITEM_LOAD_LIMIT: 38,
    ITEM_POLARITY: 39, ITEM_SCREEN_DIR: 40, ITEM_LANGUAGE: 41,
    ITEM_FACTORY_RESET: 42, ITEM_CHART_DIR: 43, ITEM_CHART_WINDOW: 44,
    ITEM_POWER_OFF: 45, ITEM_OUTPUT: 46, ITEM_BAUD: 47, ITEM_DATA_BITS: 48,
    ITEM_STOP_BITS: 49, ITEM_PARITY: 50, ITEM_STORAGE_LIST: 51,
    ITEM_TIME_DISPLAY: 52, ITEM_AUTO_STORE: 53, ITEM_DATA_SORT: 54,
    ITEM_STORAGE_LINK: 55, ITEM_CAL_AUTH: 56, ITEM_CAL_ENTER: 57,
    ITEM_CAL_SEGMENT: 58, ITEM_CAL_SETPOINT: 59, ITEM_CAL_ACTUAL: 60,
    /* 枚举选项 / 动作文案 */
    OPT_REALTIME: 61, OPT_PEAK: 62, OPT_NONE: 63, OPT_COMPRESS: 64,
    OPT_TENSION: 65, OPT_INSERT: 66, OPT_CONTACT: 67, OPT_BREAK: 68,
    OPT_OFF: 69, OPT_ON: 70, OPT_POLARITY_BOTH: 71, OPT_FORWARD: 72,
    OPT_REVERSE: 73, OPT_NEGATIVE: 74, OPT_AUTO: 75, OPT_ENTER: 76,
    OPT_VIEW: 77, OPT_SORT_OLD_NEW: 78, OPT_SORT_NEW_OLD: 79,
    OPT_USER_NORMAL: 80, OPT_SEG_6PT: 81, OPT_LANG_ZH: 82, OPT_LANG_EN: 83,
    OPT_NORMALLY_OPEN: 84, OPT_NORMALLY_CLOSED: 85,
    COUNT: 86
  };

  var ZH = [
    /* 页面 */
    "主界面", "设置", "基本设定", "系统设定", "通信设定", "存储设置", "校正系统",
    /* 主界面 */
    "峰值", "存储成功", "存储失败", "存储已满",
    /* 底栏 */
    "MENU 返回", "UNIT 上一项", "DATA 下一项", "PWR 进入",
    "MENU 返回 U/D 项 PWR 进入",
    "MENU 返回 U/D 数值 PWR 设定",
    "PWR 确认",
    "DATA 5s 清空存储",
    "无记录", "正在读取", "读取失败", "等待", "正在清空", "清空失败",
    "清空全部记录？",
    /* 设定项 */
    "测试模式", "测试动作", "采样频率", "传输速度", "自动归零", "归零时间",
    "公差设定", "额定量程", "起始值", "地域重力", "自动息屏", "外接功能",
    "荷重上限", "正负显示", "屏幕方向", "语言", "系统重置", "图表设定",
    "曲线窗口", "关机功能", "OUTPUT", "连接速率", "数据位", "停止位", "校验位",
    "存储清单", "时间显示", "自动存储", "数据排序", "存储连接",
    "当前权限", "校正界面", "分段校正", "设定值", "实际力值",
    /* 选项 */
    "实时", "峰值", "无", "压缩", "拉伸", "插拔", "接点保持", "破断",
    "关闭", "开启", "\u00B1", "正向", "反向", "负向", "自动", "进入",
    "查看", "最旧 > 最新", "最新 > 最旧", "普通用户", "6 点", "ZH", "EN",
    "常开", "常闭"
  ];

  var EN = [
    "Home", "Settings", "Basic", "System", "Comm", "Storage", "Calibrate",
    "Peak", "SAVE OK", "SAVE FAIL", "STORE FULL",
    "MENU BACK", "UNIT PREV", "DATA NEXT", "PWR ENTER",
    "MENU BACK  U/D ITEM  PWR EDIT",
    "MENU BACK  U/D VALUE  PWR OK",
    "PWR OK",
    "DATA 5s CLEAR",
    "No Record", "Loading", "Read Fail", "Wait", "Clearing", "Clear Fail",
    "Clear All?",
    "Test Mode", "Test Action", "Sample", "Tx Rate", "Auto Zero", "Zero Delay",
    "Tolerance", "Range", "Start", "Gravity", "Auto Sleep", "Ext Func",
    "Load Limit", "Polarity", "Screen Dir", "Language", "Reset", "Chart Dir",
    "Window", "Power Off", "OUTPUT", "Baud", "Data Bits", "Stop Bits", "Parity",
    "Records", "Show Time", "Auto Store", "Sort Order", "Store Link",
    "Authority", "Calibrate", "Multi-pt", "Setpoint", "Actual",
    "Live", "Peak", "None", "Compress", "Tension", "FP", "ACT", "BRK",
    "OFF", "ON", "\u00B1", "Forward", "REV", "Neg", "Auto", "Enter",
    "View", "Old > New", "New > Old", "User", "6 pt", "ZH", "EN", "NO", "NC"
  ];

  var APP_LANG_ZH = 0;
  var APP_LANG_EN = 1;
  var language = APP_LANG_ZH;

  function SetLanguage(lang) {
    language = (lang >= 2) ? APP_LANG_ZH : lang;
  }

  function GetLanguage() {
    return language;
  }

  function T(id) {
    var table = (language === APP_LANG_EN) ? EN : ZH;
    if (id >= table.length) {
      return "";
    }
    return table[id];
  }

  FG.STR = STR;
  FG.i18nTables = { ZH: ZH, EN: EN };
  FG.APP_LANG_ZH = APP_LANG_ZH;
  FG.APP_LANG_EN = APP_LANG_EN;
  FG.SetLanguage = SetLanguage;
  FG.GetLanguage = GetLanguage;
  FG.T = T;
})(window.FG = window.FG || {});
