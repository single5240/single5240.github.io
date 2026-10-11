/* 240x320 逻辑画面与绘制原语。
 *
 * 颜色一律用固件的 RGB565 原值，不另配一套色板。
 * 字形位图格式：1 bit/像素，行主序，MSB = 最左像素，每行按字节对齐，
 * 行跨度 = ceil(width / 8) 字节。
 * font_16 / font_24 的字距就是字形表里的 width 字段。
 */
(function (FG) {
  "use strict";

  var WIDTH = 240;
  var HEIGHT = 320;

  /* 逻辑画面尺寸，必须与 APP_UI_DISPLAY_WIDTH / HEIGHT 一致 */
  FG.WIDTH = WIDTH;
  FG.HEIGHT = HEIGHT;

  /* RGB565 颜色，取自 app_ui_home.c 的 UI_COLOR_* */
  FG.COLOR = {
    BG: 0x0008,
    PANEL: 0x084e,
    GRID: 0x2945,
    GRAY: 0x8410,
    WHITE: 0xffff,
    CYAN: 0x25dc,
    GREEN: 0x2589,
    RED: 0xf186,
    BLACK: 0x0000
  };

  /* RGB565 -> 8 bit 分量 */
  function expandR565(c) {
    return ((c >> 11) & 0x1f) * 255 / 31;
  }
  function expandG565(c) {
    return ((c >> 5) & 0x3f) * 255 / 63;
  }
  function expandB565(c) {
    return (c & 0x1f) * 255 / 31;
  }

  function Screen(canvas) {
    this.canvas = canvas;
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.ctx.imageSmoothingEnabled = false;
    this.fb = new Uint16Array(WIDTH * HEIGHT);
    this.image = this.ctx.createImageData(WIDTH, HEIGHT);
    this.missing = Object.create(null);
    this.clipTop = 0;
    this.clipBottom = HEIGHT;
    /* 位图是多行拼接的十六进制串，这里预处理成连续串并缓存。
     * 缺失或写坏的字库文件只让对应字形画不出来，不影响整页加载。 */
    this.fonts = [FG.FONT16, FG.FONT24, FG.NUM40].filter(function (font) {
      return font && typeof font.bitmap === "string";
    });
    for (var i = 0; i < this.fonts.length; i++) {
      var font = this.fonts[i];
      if (font.hex === undefined) {
        font.hex = cleanHex(font.bitmap);
      }
    }
    if (this.fonts.length < 2 || !FG.FONT16 || !FG.FONT16.hex ||
      !FG.FONT24 || !FG.FONT24.hex || !FG.NUM40 || !FG.NUM40.glyphs) {
      this.fontDataMissing = true;
    }
    this.fill(FG.COLOR.BG);
  }

  Screen.prototype.fill = function (color) {
    this.fb.fill(color & 0xffff);
  };

  Screen.prototype.clear = function () {
    this.fill(FG.COLOR.BG);
  };

  Screen.prototype.plot = function (x, y, color) {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) {
      return;
    }
    this.fb[y * WIDTH + x] = color & 0xffff;
  };

  Screen.prototype.fillRect = function (x, y, w, h, color) {
    var x0 = Math.max(0, x | 0);
    var y0 = Math.max(0, y | 0);
    var x1 = Math.min(WIDTH, (x | 0) + (w | 0));
    var y1 = Math.min(HEIGHT, (y | 0) + (h | 0));
    var c = color & 0xffff;
    var row;
    var px;
    for (px = y0; px < y1; px++) {
      row = px * WIDTH;
      for (var col = x0; col < x1; col++) {
        this.fb[row + col] = c;
      }
    }
  };

  Screen.prototype.hline = function (x0, x1, y, color) {
    var from = Math.min(x0, x1);
    var to = Math.max(x0, x1);
    this.fillRect(from, y, to - from + 1, 1, color);
  };

  Screen.prototype.vline = function (x, y0, y1, color) {
    var from = Math.min(y0, y1);
    var to = Math.max(y0, y1);
    this.fillRect(x, from, 1, to - from + 1, color);
  };

  /* 整数 Bresenham，端点都包含 */
  Screen.prototype.line = function (x0, y0, x1, y1, color) {
    var dx = Math.abs(x1 - x0);
    var dy = Math.abs(y1 - y0);
    var sx = x0 < x1 ? 1 : -1;
    var sy = y0 < y1 ? 1 : -1;
    var err = dx - dy;
    for (;;) {
      this.plot(x0, y0, color);
      if (x0 === x1 && y0 === y1) {
        break;
      }
      var e2 = err * 2;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
    }
  };

  /* 图表折线段：按主方向逐步推进，斜率用整数截断（与固件一致） */
  Screen.prototype.drawChartLine = function (x0, y0, x1, y1, color) {
    var dx = x1 - x0;
    var dy = y1 - y0;
    var adx = Math.abs(dx);
    var ady = Math.abs(dy);
    if (adx === 0 && ady === 0) {
      this.plot(x0, y0, color);
      return;
    }
    if (ady >= adx) {
      var stepY = (y1 >= y0) ? 1 : -1;
      var y = y0;
      for (;;) {
        var x = x0 + Math.trunc(dx * (y - y0) / dy);
        this.plot(x, y, color);
        if (y === y1) {
          break;
        }
        y += stepY;
      }
    } else {
      var stepX = (x1 >= x0) ? 1 : -1;
      var xc = x0;
      for (;;) {
        var yc = y0 + Math.trunc(dy * (xc - x0) / dx);
        this.plot(xc, yc, color);
        if (xc === x1) {
          break;
        }
        xc += stepX;
      }
    }
  };

  /* 记录页时间文本 YY-MM-DD HH:MM:SS；年份 2000~2135 之外不画（与固件一致） */
  Screen.prototype.validTimeText = function (ms) {
    var date = new Date(ms);
    var year = date.getFullYear();
    var month = date.getMonth() + 1;
    var day = date.getDate();
    var hour = date.getHours();
    var minute = date.getMinutes();
    var second = date.getSeconds();
    if (!isFinite(year) || year < 2000 || year > 2135) return "";
    if (month < 1 || month > 12 || day < 1 || day > 31) return "";
    if (hour > 23 || minute > 59 || second > 59) return "";
    return FG.formatRecordTime(ms);
  };

  /* 取单个字形像素：位图是行主序、MSB 在前、行按字节对齐。
   * 越界或非法十六进制一律当作未点亮，避免转写数据不完整时整页崩掉。
   * 位图由多行字符串拼接而成，先去掉换行、空格和拼接用的 '+'。 */
  function cleanHex(bitmap) {
    return String(bitmap).replace(/[\s+]/g, "");
  }

  function glyphBitRange(hex, offset, width, x, y) {
    var rowBytes = (width + 7) >> 3;
    var idx = (offset + y * rowBytes + (x >> 3)) * 2;
    if (idx < 0 || (idx + 2) > hex.length) {
      return 0;
    }
    var byte = parseInt(hex.substr(idx, 2), 16);
    if (isNaN(byte)) {
      return 0;
    }
    return (byte >> (7 - (x & 7))) & 1;
  }

  function glyphFor(font, code) {
    var table = font.glyphs;
    var lo = 0;
    var hi = table.length - 1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      var u = table[mid][0];
      if (u === code) {
        return table[mid];
      }
      if (u < code) {
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return null;
  }

  Screen.prototype.glyphBit = function (font, glyph, x, y) {
    return glyphBitRange(font.hex, glyph[2], glyph[1], x, y);
  };

  Screen.prototype.lookup = function (font, code) {
    return glyphFor(font, code);
  };

  /* 缺字时的步进：固件用 字体高度/2 占位 */
  function missingAdvance(font) {
    return font.charWidth !== undefined ? font.charWidth : (font.height >> 1);
  }

  /* 字距（= 字形表里的 width）；缺字返回占位宽度并记入 missing 统计 */
  Screen.prototype.advance = function (font, code) {
    var g = glyphFor(font, code);
    if (!g) {
      var key = String.fromCharCode(code);
      this.missing[key] = (this.missing[key] || 0) + 1;
      return missingAdvance(font);
    }
    return g[1];
  };

  /* 画一个字形，返回字距 */
  Screen.prototype.drawGlyph = function (font, code, x, y, color) {
    var g = glyphFor(font, code);
    if (!g) {
      var key = String.fromCharCode(code);
      this.missing[key] = (this.missing[key] || 0) + 1;
      return missingAdvance(font);
    }
    var hex = font.hex;
    if (typeof hex !== "string") {
      this.missing["字库"] = 1;
      return g[1];
    }
    var w = g[1];
    var h = font.height;
    var rowBytes = (w + 7) >> 3;
    var base = g[2] * 2;
    var hex = font.hex;
    var c = color & 0xffff;
    var firstY = Math.max(y, this.clipTop);
    var lastY = Math.min(y + h, this.clipBottom);
    for (var py = firstY; py < lastY; py++) {
      if (py < 0 || py >= HEIGHT) {
        continue;
      }
      var gy = py - y;
      var rowStart = base + gy * rowBytes * 2;
      for (var gx = 0; gx < w; gx++) {
        var px = x + gx;
        if (px < 0 || px >= WIDTH) {
          continue;
        }
        var at = rowStart + ((gx >> 3) << 1);
        if (at + 2 > hex.length) {
          continue;
        }
        var byte = parseInt(hex.substr(at, 2), 16);
        if (!isNaN(byte) && ((byte >> (7 - (gx & 7))) & 1)) {
          this.fb[py * WIDTH + px] = c;
        }
      }
    }
    return w;
  };

  /* 分条渲染用：只允许 clipTop..clipBottom 之内的行落笔 */
  Screen.prototype.setClipRows = function (top, bottom) {
    this.clipTop = top;
    this.clipBottom = bottom;
  };

  /* UTF-8 解码。返回下一个码点与新的下标；非法字节跳过。 */
  Screen.prototype.decodeUtf8 = function (text, index) {
    var b0 = text.charCodeAt(index);
    if (b0 < 0x80) {
      return { code: b0, next: index + 1 };
    }
    if ((b0 & 0xe0) === 0xc0 && index + 1 < text.length) {
      return {
        code: ((b0 & 0x1f) << 6) | (text.charCodeAt(index + 1) & 0x3f),
        next: index + 2
      };
    }
    if ((b0 & 0xf0) === 0xe0 && index + 2 < text.length) {
      return {
        code: ((b0 & 0x0f) << 12) |
          ((text.charCodeAt(index + 1) & 0x3f) << 6) |
          (text.charCodeAt(index + 2) & 0x3f),
        next: index + 3
      };
    }
    if ((b0 & 0xf8) === 0xf0 && index + 3 < text.length) {
      return {
        code: ((b0 & 0x07) << 18) |
          ((text.charCodeAt(index + 1) & 0x3f) << 12) |
          ((text.charCodeAt(index + 2) & 0x3f) << 6) |
          (text.charCodeAt(index + 3) & 0x3f),
        next: index + 4
      };
    }
    return { code: b0, next: index + 1 };
  };

  /* 说明：JS 字符串已经是 UTF-16 序列，直接用 for...of 逐码点遍历即可。
   * 不要对 JS 字符串再做一次"UTF-8 解码"——那会把 ASCII 后面的汉字当成
   * UTF-8 前导字节误读（例如 "MENU 返回" 会解出 U+07FE 这类垃圾码点）。 */

  Screen.prototype.measure = function (font, text) {
    var x = 0;
    for (const ch of String(text)) {
      var g = glyphFor(font, ch.codePointAt(0));
      if (!g) {
        this.missing[ch] = (this.missing[ch] || 0) + 1;
      }
      x += g ? g[1] : missingAdvance(font);
    }
    return x;
  };

  Screen.prototype.drawText = function (font, x, y, text, color) {
    var cx = x;
    for (const ch of String(text)) {
      cx += this.drawGlyph(font, ch.codePointAt(0), cx, y, color);
    }
    return cx - x;
  };

  /* 右边界裁剪：整个字放不下就停止，返回值是实际占用宽度 */
  Screen.prototype.drawTextClipped = function (font, x, right, y, text, color) {
    var cx = x;
    for (const ch of String(text)) {
      if (cx >= right) {
        break;
      }
      var g = glyphFor(font, ch.codePointAt(0));
      var w = g ? g[1] : missingAdvance(font);
      if (cx + w > right) {
        break;
      }
      if (g) {
        this.drawGlyph(font, ch.codePointAt(0), cx, y, color);
      } else {
        this.missing[ch] = (this.missing[ch] || 0) + 1;
      }
      cx += w;
    }
    return cx - x;
  };

  Screen.prototype.drawTextRight = function (font, x, y, text, color) {
    return this.drawText(font, x - this.measure(font, text), y, text, color);
  };

  Screen.prototype.drawTextCentered = function (font, cx, y, text, color) {
    return this.drawText(font, cx - (this.measure(font, text) >> 1), y, text, color);
  };

  /* 40 号数字字：单字固定 24 宽、40 高 */
  Screen.prototype.drawNumber40 = function (x, y, text, color) {
    var charset = FG.NUM40.charset;
    var s = String(text);
    var cx = x;
    for (var i = 0; i < s.length; i++) {
      var idx = charset.indexOf(s.charAt(i));
      if (idx < 0) {
        cx += FG.NUM40.width;
        continue;
      }
      this.drawPackedBits(FG.NUM40.glyphs[idx], FG.NUM40.width, FG.NUM40.height, cx, y, color);
      cx += FG.NUM40.width;
    }
    return cx;
  };

  Screen.prototype.drawPackedBits = function (bits, width, height, x, y, color) {
    var rowBytes = (width + 7) >> 3;
    var hex = String(bits).replace(/[\s+]/g, "");
    var c = color & 0xffff;
    for (var gy = 0; gy < height; gy++) {
      var py = y + gy;
      if (py < 0 || py >= HEIGHT) {
        continue;
      }
      var rowStart = gy * rowBytes * 2;
      for (var gx = 0; gx < width; gx++) {
        var px = x + gx;
        if (px < 0 || px >= WIDTH) {
          continue;
        }
        var at = rowStart + ((gx >> 3) << 1);
        if (at + 2 > hex.length) {
          continue;
        }
        var byte = parseInt(hex.substr(at, 2), 16);
        if (!isNaN(byte) && ((byte >> (7 - (gx & 7))) & 1)) {
          this.fb[py * WIDTH + px] = c;
        }
      }
    }
  };

  /* 5x7 小字：每字符 5 列 + 1 列间隔 = 步进 6，每列 1 字节，bit0 在最上面一行 */
  Screen.prototype.drawMiniText = function (x, y, text, color) {
    var s = String(text);
    var cx = x;
    var c = color & 0xffff;
    for (var i = 0; i < s.length; i++) {
      var cols = FG.MINI_FONT[s.charAt(i)] || FG.MINI_FONT_BLANK;
      for (var col = 0; col < FG.MINI_FONT_WIDTH; col++) {
        var bits = cols[col];
        for (var row = 0; row < FG.MINI_FONT_HEIGHT; row++) {
          if (bits & (1 << row)) {
            this.plot(cx + col, y + row, c);
          }
        }
      }
      cx += FG.MINI_FONT_STEP;
    }
    return cx - x;
  };

  /* 把 240x320 的 RGB565 帧缓冲刷到画布 */
  Screen.prototype.present = function () {
    var data = this.image.data;
    var fb = this.fb;
    for (var i = 0, p = 0; i < fb.length; i++, p += 4) {
      var c = fb[i];
      data[p] = expandR565(c);
      data[p + 1] = expandG565(c);
      data[p + 2] = expandB565(c);
      data[p + 3] = 255;
    }
    this.ctx.putImageData(this.image, 0, 0);
  };

  FG.Screen = Screen;
  FG.glyphBit = glyphBitRange;
})(window.FG = window.FG || {});
