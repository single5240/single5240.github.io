/* 浏览器本地持久化：设置、记录、校正会话标志。
 *
 * 固件里设置走 M24C02 双槽提交、记录走 W25Q128 扇区世代，网页不复刻这些事务，
 * 只保留用户可见结果：刷新页面后设置、单位、记录仍在；校正密码的会话标志消失。
 * 15,000 条记录只存可见字段，不存波形点。
 */
(function (FG) {
  "use strict";

  var PREFIX = "qw603.demo.";

  var KEYS = {
    settings: PREFIX + "settings.v1",
    records: PREFIX + "records.v1",
    calSession: PREFIX + "calSession.v1"
  };

  var available = (function () {
    try {
      var probe = PREFIX + "__probe";
      window.localStorage.setItem(probe, "1");
      window.localStorage.removeItem(probe);
      return true;
    } catch (err) {
      return false;
    }
  })();

  var memory = Object.create(null);

  function readRaw(key) {
    if (!available) {
      return (key in memory) ? memory[key] : null;
    }
    try {
      return window.localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function writeRaw(key, value) {
    if (!available) {
      memory[key] = value;
      return true;
    }
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (err) {
      return false;
    }
  }

  function removeRaw(key) {
    if (!available) {
      delete memory[key];
      return;
    }
    try {
      window.localStorage.removeItem(key);
    } catch (err) {
      /* 忽略：删除失败不影响演示 */
    }
  }

  function readJson(key, fallback) {
    var raw = readRaw(key);
    if (!raw) {
      return fallback;
    }
    try {
      var value = JSON.parse(raw);
      return (value === null || value === undefined) ? fallback : value;
    } catch (err) {
      return fallback;
    }
  }

  FG.Storage = {
    keys: KEYS,

    get isPersistent() {
      return available;
    },

    /* 设置：返回对象或 null */
    loadSettings: function () {
      return readJson(KEYS.settings, null);
    },

    /* 返回 true 表示已写入；false 表示写入被拒绝（配额或隐私模式） */
    saveSettings: function (data) {
      return writeRaw(KEYS.settings, JSON.stringify(data));
    },

    clearSettings: function () {
      removeRaw(KEYS.settings);
    },

    /* 记录：数组，元素是扁平对象 */
    loadRecords: function () {
      var value = readJson(KEYS.records, null);
      return Array.isArray(value) ? value : [];
    },

    saveRecords: function (list) {
      return writeRaw(KEYS.records, JSON.stringify(list));
    },

    clearRecords: function () {
      removeRaw(KEYS.records);
    },

    /* 校正密码的会话标志：刷新后应当消失，所以只在 sessionStorage 里留痕 */
    getCalSessionVerified: function () {
      try {
        return window.sessionStorage.getItem(KEYS.calSession) === "1";
      } catch (err) {
        return false;
      }
    },

    setCalSessionVerified: function (verified) {
      try {
        if (verified) {
          window.sessionStorage.setItem(KEYS.calSession, "1");
        } else {
          window.sessionStorage.removeItem(KEYS.calSession);
        }
      } catch (err) {
        /* 忽略 */
      }
    }
  };
})(window.FG = window.FG || {});
