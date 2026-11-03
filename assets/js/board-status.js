(() => {
  const nodes = document.querySelectorAll("[data-board-status]");
  if (!nodes.length) return;

  const setField = (root, name, value) => {
    const el = root.querySelector(`[data-field="${name}"]`);
    if (el) el.textContent = value;
  };

  const metric = (value, suffix) => (
    typeof value === "number" && Number.isFinite(value) ? value.toFixed(1) + suffix : "--"
  );

  const linkText = (value) => (value === "up" ? "已连接" : value === "down" ? "未连接" : "--");
  const triggerText = (value) => {
    if (value === "none") return "关";
    if (value === "heartbeat") return "心跳";
    return value || "--";
  };

  const render = (root, data) => {
    // 必须同时满足 online === true 且 60 秒内有有效上报（双重校验防陈旧缓存）
    const isFresh = data && typeof data.received_at === "number"
      ? (Date.now() / 1000 - data.received_at) < 60
      : true;
    const online = Boolean(data && data.online === true && isFresh);

    root.dataset.state = online ? "online" : "offline";
    setField(root, "presence", online ? "在线" : "offline");
    setField(root, "host", data && data.host ? data.host : "ATK-IMX6U");

    if (online) {
      setField(root, "time", data && data.time ? data.time : "");
      setField(root, "temp", metric(data && data.temp_c, " °C"));
      setField(root, "cpu", metric(data && data.cpu_usage_pct, "%"));
      setField(root, "mem", metric(data && data.mem_used_pct, "%"));
      setField(root, "disk", metric(data && data.disk_used_pct, "%"));
      setField(root, "uptime", data && data.uptime ? data.uptime : "--");
      setField(root, "load", data && data.load ? data.load : "--");
      setField(root, "eth0", linkText(data && data.eth0));
      setField(root, "eth1", linkText(data && data.eth1));
      setField(root, "key", data && data.key_pressed ? "按下" : "未按下");
      setField(root, "als", metric(data && data.als, ""));
      setField(root, "ir", metric(data && data.ir, ""));
      setField(root, "ps", metric(data && data.ps, ""));
      setField(root, "proximity", data && data.proximity ? "接近" : "无");
      setField(root, "rtc", metric(data && data.rtc_offset_s, " 秒"));
      setField(root, "sys_led", triggerText(data && data.sys_led));
      setField(root, "beep", triggerText(data && data.beep));
    } else {
      // 板子掉线或未在线：指标严禁展示旧数据，全部清晰显示 offline / --
      setField(root, "time", data && data.time ? `上次上报 ${data.time}` : "未连接");
      setField(root, "temp", "offline");
      setField(root, "cpu", "offline");
      setField(root, "mem", "offline");
      setField(root, "disk", "offline");
      setField(root, "uptime", "offline");
      setField(root, "load", "offline");
      setField(root, "eth0", "--");
      setField(root, "eth1", "--");
      setField(root, "key", "--");
      setField(root, "als", "--");
      setField(root, "ir", "--");
      setField(root, "ps", "--");
      setField(root, "proximity", "--");
      setField(root, "rtc", "--");
      setField(root, "sys_led", "--");
      setField(root, "beep", "--");
    }
  };

  const fail = (root) => {
    root.dataset.state = "offline";
    setField(root, "presence", "offline");
    setField(root, "time", "未连接");
    setField(root, "temp", "offline");
    setField(root, "cpu", "offline");
    setField(root, "mem", "offline");
    setField(root, "disk", "offline");
    setField(root, "uptime", "offline");
    setField(root, "load", "offline");
    setField(root, "eth0", "--");
    setField(root, "eth1", "--");
    setField(root, "key", "--");
    setField(root, "als", "--");
    setField(root, "ir", "--");
    setField(root, "ps", "--");
    setField(root, "proximity", "--");
    setField(root, "rtc", "--");
    setField(root, "sys_led", "--");
    setField(root, "beep", "--");
  };

  const matches = (root, data) => {
    const want = root.getAttribute("data-board-id");
    if (!want) return true;
    return want === data.host || want === data.id;
  };

  const paint = (payload) => {
    const list = Array.isArray(payload) ? payload : [payload];
    list.forEach((data) => {
      if (!data) return;
      nodes.forEach((root) => {
        if (matches(root, data)) render(root, data);
      });
    });
  };

  const tick = () => {
    fetch("/lab/board-status", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then(paint)
      .catch(() => nodes.forEach(fail));
  };

  tick();
  window.setInterval(tick, 5000);
})();
