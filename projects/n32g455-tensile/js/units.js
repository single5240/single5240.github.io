/* 单位换算：内部一律毫牛，只在这里转成显示文字。
 *
 * 规则取自 N32G455/APP/app_force_unit.c：
 *   1 gf  = 9.80665 mN       -> ToGram  = round(mN * 100000 / 980665)
 *   1 lbf = 4.4482216152605 N -> ToMilliPound = round(mN * 10000000 / 44482216)
 * 标准重力 9.80665；地域重力设定不参与显示换算。
 */
(function (FG) {
  "use strict";

  var MN_PER_GF_X100000 = 980665;
  var MN_PER_MLBF_X10000000 = 44482216;
  var DISPLAY_MAX_X1000 = 999990;
  var DISPLAY_MAX_GRAM = 999999;

  var UNIT = { N: 0, G: 1, KG: 2, LB: 3, COUNT: 4 };
  var UNIT_LABEL = ["N", "g", "kg", "lb"];

  function toGram(millinewton) {
    var mag = Math.abs(millinewton);
    return Math.floor((mag * 100000 + Math.floor(MN_PER_GF_X100000 / 2)) / MN_PER_GF_X100000);
  }

  function toMilliPound(millinewton) {
    var mag = Math.abs(millinewton);
    var value = Math.floor((mag * 10000000 + Math.floor(MN_PER_MLBF_X10000000 / 2)) /
      MN_PER_MLBF_X10000000);
    return Math.min(value, DISPLAY_MAX_X1000);
  }

  /* 定点输出：sign 是 '-' 或 ' '，scaled 是已经缩放好的整数，decimals 是小数位 */
  function writeFixed(sign, scaled, decimals) {
    var digits = String(Math.floor(scaled));
    var text;
    if (decimals === 0) {
      text = digits;
    } else {
      var divisor = Math.pow(10, decimals);
      var whole = Math.floor(scaled / divisor);
      var fraction = scaled % divisor;
      var fracText = String(fraction);
      while (fracText.length < decimals) {
        fracText = "0" + fracText;
      }
      text = String(whole) + "." + fracText;
    }
    return sign + text;
  }

  function formatScaled(millinewton, absoluteX1000, sign) {
    var value = Math.min(absoluteX1000, DISPLAY_MAX_X1000);
    var decimals;
    var quantum;
    if (value >= 10000) {
      decimals = 2;
      quantum = 10;
    } else {
      decimals = 3;
      quantum = 1;
    }
    var shown = Math.floor((value + Math.floor(quantum / 2)) / quantum);
    var outSign = (sign && shown !== 0) ? "-" : " ";
    return writeFixed(outSign, shown, decimals);
  }

  /* 牛顿：小于 100 N 显示 00.00（截断到 0.01 N），100 N 及以上到 999.99 N */
  function formatNewton(millinewton) {
    var magnitude = Math.abs(millinewton);
    var sign = (millinewton < 0 && magnitude >= 10) ? "-" : " ";
    if (magnitude >= 100000) {
      var centinewton = Math.floor(magnitude / 10);
      if (centinewton > 99999) {
        centinewton = 99999;
      }
      return writeFixed(sign, centinewton, 2);
    }
    var whole = Math.floor(magnitude / 1000);
    var fraction = magnitude % 1000;
    var wholeText = String(whole);
    if (wholeText.length < 2) {
      wholeText = "0" + wholeText;
    }
    return sign + wholeText + "." + String(Math.floor(fraction / 100)).charAt(0) +
      String(Math.floor(fraction / 10) % 10);
  }

  function formatGram(millinewton) {
    var grams = Math.min(toGram(millinewton), DISPLAY_MAX_GRAM);
    var sign = (millinewton < 0 && grams !== 0) ? "-" : " ";
    return writeFixed(sign, grams, 0);
  }

  function formatForce(millinewton, unit) {
    switch (unit) {
      case UNIT.G:
        return formatGram(millinewton);
      case UNIT.KG:
        return formatScaled(millinewton, toGram(millinewton), millinewton < 0);
      case UNIT.LB:
        return formatScaled(millinewton, toMilliPound(millinewton), millinewton < 0);
      case UNIT.N:
      default:
        return formatNewton(millinewton);
    }
  }

  /* 坐标轴刻度：0 是 "0"，其余取整 */
  function formatAxis(millinewton, unit) {
    var magnitude = Math.abs(millinewton);
    var shown;
    var sign;
    switch (unit) {
      case UNIT.G:
        shown = Math.min(toGram(magnitude), 9999);
        sign = (millinewton < 0 && shown !== 0) ? "-" : " ";
        if (shown === 0) return "0";
        return writeFixed(sign, shown, 0).replace(/^ /, "");
      case UNIT.KG:
        shown = Math.min(Math.floor((toGram(magnitude) + 5) / 10), 9999);
        sign = (millinewton < 0 && shown !== 0) ? "-" : " ";
        if (shown === 0) return "0";
        return writeFixed(sign, shown, 2).replace(/^ /, "");
      case UNIT.LB:
        shown = Math.min(Math.floor((toMilliPound(magnitude) + 5) / 10), 9999);
        sign = (millinewton < 0 && shown !== 0) ? "-" : " ";
        if (shown === 0) return "0";
        return writeFixed(sign, shown, 2).replace(/^ /, "");
      case UNIT.N:
      default:
        shown = Math.min(Math.floor((magnitude + 500) / 1000), 999);
        sign = (millinewton < 0 && shown !== 0) ? "-" : " ";
        if (shown === 0) return "0";
        return writeFixed(sign, shown, 0).replace(/^ /, "");
    }
  }

  /* 显示文字 -> 毫牛，是 formatForce 的逆运算。解析失败返回 null。 */
  function parseForce(text, unit) {
    if (text === null || text === undefined) {
      return null;
    }
    var s = String(text).trim();
    if (s === "") {
      return null;
    }
    var m = /^([+-]?)(\d+(?:\.\d*)?|\.\d+)$/.exec(s);
    if (!m) {
      return null;
    }
    var negative = (m[1] === "-");
    var value = parseFloat(m[2]);
    if (!isFinite(value)) {
      return null;
    }
    var millinewton;
    switch (unit) {
      case UNIT.G:
        millinewton = Math.round(value * MN_PER_GF_X100000 / 100000);
        break;
      case UNIT.KG:
        millinewton = Math.round(value * MN_PER_GF_X100000 / 100);
        break;
      case UNIT.LB:
        millinewton = Math.round(value * MN_PER_MLBF_X10000000 / 10000000);
        break;
      case UNIT.N:
      default:
        millinewton = Math.round(value * 1000);
        break;
    }
    return negative ? -millinewton : millinewton;
  }

  FG.Unit = {
    UNIT: UNIT,
    LABEL: UNIT_LABEL,
    toGram: toGram,
    toMilliPound: toMilliPound,
    formatForce: formatForce,
    formatAxis: formatAxis,
    parseForce: parseForce,
    label: function (unit) {
      return (unit >= 0 && unit < UNIT_LABEL.length) ? UNIT_LABEL[unit] : "N";
    }
  };
})(window.FG = window.FG || {});
