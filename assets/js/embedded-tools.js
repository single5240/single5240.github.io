(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function toHex(num, width = 8) {
    return (num >>> 0).toString(16).toUpperCase().padStart(width, "0");
  }

  function formatBin32(num) {
    const raw = (num >>> 0).toString(2).padStart(32, "0");
    return raw.replace(/(.{4})(?=.)/g, "$1 ");
  }

  function parseHexBytes(input, mode = "hex") {
    if (mode === "ascii") {
      const bytes = [];
      for (let i = 0; i < input.length; i += 1) {
        const code = input.charCodeAt(i);
        if (code <= 0xff) bytes.push(code);
        else {
          const encoded = new TextEncoder().encode(input[i]);
          for (const b of encoded) bytes.push(b);
        }
      }
      return { bytes, error: null };
    }
    const cleaned = input
      .replace(/0x/gi, " ")
      .replace(/[{};,[\]\r\n\t]+/g, " ")
      .trim();
    if (!cleaned) return { bytes: [], error: null };
    const tokens = cleaned.split(/\s+/);
    const bytes = [];
    for (const tok of tokens) {
      if (!/^[0-9a-fA-F]+$/.test(tok)) {
        return { bytes: [], error: `非法十六进制片段: "${tok}"` };
      }
      const padded = tok.length % 2 === 1 ? `0${tok}` : tok;
      for (let i = 0; i < padded.length; i += 2) {
        bytes.push(parseInt(padded.slice(i, i + 2), 16));
      }
    }
    return { bytes, error: null };
  }

  function bytesToHexStr(bytes) {
    return bytes.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
  }

  // Copy helper with fallback
  async function copyText(str) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(str);
        return true;
      } catch {
        // fallback
      }
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = str;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      ta.style.pointerEvents = "none";
      document.body.append(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }

  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-copy-target], [data-copy-value]");
    if (!btn) return;
    let text = btn.getAttribute("data-copy-value");
    if (text === null) {
      const targetId = btn.getAttribute("data-copy-target");
      const el = document.getElementById(targetId);
      if (el) text = "value" in el ? el.value : el.textContent;
    }
    if (!text) return;
    const ok = await copyText(text.trim());
    const orig = btn.textContent;
    btn.textContent = ok ? "已复制" : "复制失败";
    setTimeout(() => {
      btn.textContent = orig;
    }, 1200);
  });

  // =========================================================================
  // Navigation Tabs & Hash Sync
  // =========================================================================
  function initToolTabs() {
    const tabs = $$(".tools-tab-btn");
    const sections = $$(".tool-section");
    if (!tabs.length) return;

    function activate(targetId, scroll = false) {
      tabs.forEach((btn) => {
        const active = btn.getAttribute("data-tool-jump") === targetId;
        if (active) btn.setAttribute("aria-current", "location");
        else btn.removeAttribute("aria-current");
      });
      if (scroll) {
        const sec = document.getElementById(targetId);
        if (sec) sec.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      }
    }

    tabs.forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-tool-jump");
        history.replaceState(null, "", `#${id}`);
        activate(id, true);
      });
    });

    if (location.hash) {
      const id = location.hash.slice(1);
      if (sections.some((s) => s.id === id)) {
        activate(id, false);
      }
    }
  }

  // =========================================================================
  // 01. Radix / Endianness / IEEE-754 Float & Fixed-Point Converter
  // =========================================================================
  function initRadixTool() {
    const decUnsigned = $("#radix-dec-u");
    const decSigned = $("#radix-dec-s");
    const hexInput = $("#radix-hex");
    const binInput = $("#radix-bin");
    const octInput = $("#radix-oct");
    const floatInput = $("#radix-float");
    const outLe = $("#radix-le");
    const outBe = $("#radix-be");
    const outRev16 = $("#radix-rev16");
    const outCdab = $("#radix-cdab");
    const outAscii = $("#radix-ascii");
    const outIeee = $("#radix-ieee-detail");
    const outQ15 = $("#radix-q15");
    const outQ31 = $("#radix-q31");

    if (!hexInput) return;

    let currentU32 = 0x40490fdb; // Default: 3.1415927f (PI)

    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);

    function syncFromU32(u32, skipEl = null) {
      currentU32 = u32 >>> 0;
      const i32 = currentU32 | 0;
      view.setUint32(0, currentU32, false);
      const f32 = view.getFloat32(0, false);

      if (skipEl !== decUnsigned) decUnsigned.value = String(currentU32);
      if (skipEl !== decSigned) decSigned.value = String(i32);
      if (skipEl !== hexInput) hexInput.value = `0x${toHex(currentU32, 8)}`;
      if (skipEl !== binInput) binInput.value = formatBin32(currentU32);
      if (skipEl !== octInput) octInput.value = `0${currentU32.toString(8)}`;
      if (skipEl !== floatInput) {
        floatInput.value = Number.isFinite(f32) ? Number(f32.toPrecision(8)).toString() : String(f32);
      }

      const b3 = (currentU32 >>> 24) & 0xff;
      const b2 = (currentU32 >>> 16) & 0xff;
      const b1 = (currentU32 >>> 8) & 0xff;
      const b0 = currentU32 & 0xff;

      outBe.textContent = bytesToHexStr([b3, b2, b1, b0]);
      outLe.textContent = bytesToHexStr([b0, b1, b2, b3]);
      outRev16.textContent = `0x${bytesToHexStr([b2, b3, b0, b1]).replace(/\s+/g, "")} (${bytesToHexStr([b2, b3, b0, b1])})`;
      outCdab.textContent = `ABCD: ${bytesToHexStr([b3, b2, b1, b0])} | CDAB: ${bytesToHexStr([b1, b0, b3, b2])} | BADC: ${bytesToHexStr([b2, b3, b0, b1])}`;

      const chars = [b3, b2, b1, b0].map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : "·")).join("");
      outAscii.textContent = `"${chars}" ([${b3}, ${b2}, ${b1}, ${b0}])`;

      const sign = (currentU32 >>> 31) & 1;
      const expRaw = (currentU32 >>> 23) & 0xff;
      const expBias = expRaw === 0 ? -126 : expRaw - 127;
      const mant = currentU32 & 0x7fffff;
      outIeee.textContent = `Sign=${sign} (${sign ? "-" : "+"}) | Exp=0x${toHex(expRaw, 2)} (${expRaw === 255 ? "Inf/NaN" : `2^${expBias}`}) | Mant=0x${toHex(mant, 6)}`;

      const i16 = (currentU32 & 0xffff) << 16 >> 16;
      outQ15.textContent = `${(i16 / 32768).toFixed(6)} (int16=${i16}, 0x${toHex(i16 & 0xffff, 4)})`;
      outQ31.textContent = `${(i32 / 2147483648).toFixed(8)} (int32=${i32})`;
    }

    decUnsigned.addEventListener("input", () => {
      const n = Number(decUnsigned.value.trim());
      if (Number.isFinite(n)) syncFromU32(n >>> 0, decUnsigned);
    });

    decSigned.addEventListener("input", () => {
      const n = Number(decSigned.value.trim());
      if (Number.isFinite(n)) syncFromU32(n >>> 0, decSigned);
    });

    hexInput.addEventListener("input", () => {
      const raw = hexInput.value.trim().replace(/^0x/i, "").replace(/[\s_]/g, "");
      if (/^[0-9a-fA-F]{1,8}$/.test(raw)) {
        syncFromU32(parseInt(raw, 16) >>> 0, hexInput);
      }
    });

    binInput.addEventListener("input", () => {
      const raw = binInput.value.trim().replace(/^0b/i, "").replace(/[\s_]/g, "");
      if (/^[01]{1,32}$/.test(raw)) {
        syncFromU32(parseInt(raw, 2) >>> 0, binInput);
      }
    });

    octInput.addEventListener("input", () => {
      const raw = octInput.value.trim().replace(/^0o?/i, "").replace(/[\s_]/g, "");
      if (/^[0-7]{1,11}$/.test(raw)) {
        syncFromU32(parseInt(raw, 8) >>> 0, octInput);
      }
    });

    floatInput.addEventListener("input", () => {
      const f = Number(floatInput.value.trim());
      if (Number.isFinite(f)) {
        view.setFloat32(0, f, false);
        syncFromU32(view.getUint32(0, false), floatInput);
      }
    });

    $$("[data-radix-op]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const op = btn.getAttribute("data-radix-op");
        if (op === "shl") syncFromU32((currentU32 << 1) >>> 0);
        else if (op === "shr") syncFromU32(currentU32 >>> 1);
        else if (op === "not") syncFromU32(~currentU32 >>> 0);
        else if (op === "bswap") {
          const b3 = (currentU32 >>> 24) & 0xff;
          const b2 = (currentU32 >>> 16) & 0xff;
          const b1 = (currentU32 >>> 8) & 0xff;
          const b0 = currentU32 & 0xff;
          syncFromU32(((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0);
        } else if (op === "pi") {
          syncFromU32(0x40490fdb);
        } else if (op === "stm32base") {
          syncFromU32(0x08000000);
        }
      });
    });

    syncFromU32(currentU32);
  }

  // =========================================================================
  // 02. CRC Suite & Modbus RTU Frame Builder / Parser
  // =========================================================================
  function reflectBits(val, width) {
    let res = 0;
    for (let i = 0; i < width; i += 1) {
      if ((val >>> i) & 1) {
        res |= 1 << (width - 1 - i);
      }
    }
    return res >>> 0;
  }

  function calcGenericCrc(bytes, width, poly, init, refIn, refOut, xorOut) {
    const mask = width === 32 ? 0xffffffff : (1 << width) - 1;
    const topBit = 1 << (width - 1);
    let crc = init & mask;
    for (let b of bytes) {
      const cur = refIn ? reflectBits(b, 8) : b;
      crc ^= cur << (width - 8);
      for (let i = 0; i < 8; i += 1) {
        if (crc & topBit) {
          crc = ((crc << 1) ^ poly) & mask;
        } else {
          crc = (crc << 1) & mask;
        }
      }
    }
    if (refOut) crc = reflectBits(crc, width);
    return ((crc ^ xorOut) & mask) >>> 0;
  }

  function crc16Modbus(bytes) {
    return calcGenericCrc(bytes, 16, 0x8005, 0xffff, true, true, 0x0000);
  }

  function initCrcModbusTool() {
    const payloadInput = $("#crc-input");
    const modeSelect = $("#crc-mode");
    const statusEl = $("#crc-status");
    const tbody = $("#crc-results-body");
    const modbusFrameOut = $("#crc-modbus-frame");
    const cArrayOut = $("#crc-c-array");

    if (!payloadInput) return;

    function updateCrc() {
      const mode = modeSelect.value;
      const { bytes, error } = parseHexBytes(payloadInput.value, mode);
      if (error) {
        statusEl.textContent = error;
        statusEl.className = "status-pill err";
        return;
      }
      statusEl.textContent = `共 ${bytes.length} 字节`;
      statusEl.className = "status-pill ok";

      const m16 = crc16Modbus(bytes);
      const m16Lo = m16 & 0xff;
      const m16Hi = (m16 >>> 8) & 0xff;
      const ccitt = calcGenericCrc(bytes, 16, 0x1021, 0xffff, false, false, 0x0000);
      const xmodem = calcGenericCrc(bytes, 16, 0x1021, 0x0000, false, false, 0x0000);
      const maxim8 = calcGenericCrc(bytes, 8, 0x31, 0x00, true, true, 0x00);
      const smbus8 = calcGenericCrc(bytes, 8, 0x07, 0x00, false, false, 0x00);
      const crc32 = calcGenericCrc(bytes, 32, 0x04c11db7, 0xffffffff, true, true, 0xffffffff);
      const sum8 = bytes.reduce((acc, b) => (acc + b) & 0xff, 0);
      const lrc8 = ((~sum8 + 1) & 0xff) >>> 0;
      const xor8 = bytes.reduce((acc, b) => acc ^ b, 0);

      const rows = [
        {
          name: "CRC-16 / MODBUS",
          hex: `0x${toHex(m16, 4)}`,
          wire: `${toHex(m16Lo, 2)} ${toHex(m16Hi, 2)} (低字节在前)`,
          copy: `${toHex(m16Lo, 2)} ${toHex(m16Hi, 2)}`,
        },
        {
          name: "CRC-16 / CCITT-FALSE",
          hex: `0x${toHex(ccitt, 4)}`,
          wire: `${toHex((ccitt >>> 8) & 0xff, 2)} ${toHex(ccitt & 0xff, 2)}`,
          copy: `0x${toHex(ccitt, 4)}`,
        },
        {
          name: "CRC-16 / XMODEM",
          hex: `0x${toHex(xmodem, 4)}`,
          wire: `${toHex((xmodem >>> 8) & 0xff, 2)} ${toHex(xmodem & 0xff, 2)}`,
          copy: `0x${toHex(xmodem, 4)}`,
        },
        {
          name: "CRC-8 / MAXIM (1-Wire)",
          hex: `0x${toHex(maxim8, 2)}`,
          wire: `${toHex(maxim8, 2)}`,
          copy: `0x${toHex(maxim8, 2)}`,
        },
        {
          name: "CRC-8 / SMBUS (I2C)",
          hex: `0x${toHex(smbus8, 2)}`,
          wire: `${toHex(smbus8, 2)}`,
          copy: `0x${toHex(smbus8, 2)}`,
        },
        {
          name: "CRC-32 (ISO-HDLC / Flash)",
          hex: `0x${toHex(crc32, 8)}`,
          wire: `${toHex(crc32 & 0xff, 2)} ${toHex((crc32 >>> 8) & 0xff, 2)} ${toHex((crc32 >>> 16) & 0xff, 2)} ${toHex((crc32 >>> 24) & 0xff, 2)}`,
          copy: `0x${toHex(crc32, 8)}`,
        },
        {
          name: "SUM-8 / LRC (Modbus ASCII)",
          hex: `SUM=0x${toHex(sum8, 2)} / LRC=0x${toHex(lrc8, 2)}`,
          wire: `XOR(BCC)=0x${toHex(xor8, 2)}`,
          copy: `0x${toHex(sum8, 2)}`,
        },
      ];

      tbody.innerHTML = rows
        .map(
          (r) => `<tr>
            <th>${r.name}</th>
            <td><strong>${r.hex}</strong> <span class="mono">(${r.wire})</span></td>
            <td><button type="button" class="tool-btn copy-mini" data-copy-value="${r.copy}">复制</button></td>
          </tr>`
        )
        .join("");

      const fullFrame = [...bytes, m16Lo, m16Hi];
      modbusFrameOut.textContent = bytesToHexStr(fullFrame);
      cArrayOut.textContent = `const uint8_t frame[${fullFrame.length}] = { ${fullFrame.map((b) => `0x${toHex(b, 2)}`).join(", ")} };`;
    }

    payloadInput.addEventListener("input", updateCrc);
    modeSelect.addEventListener("change", updateCrc);

    $$("[data-crc-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        modeSelect.value = "hex";
        payloadInput.value = btn.getAttribute("data-crc-preset");
        updateCrc();
      });
    });

    // Modbus RTU Builder & Inspector
    const mbSlave = $("#mb-slave");
    const mbFunc = $("#mb-func");
    const mbAddr = $("#mb-addr");
    const mbVal = $("#mb-val");
    const mbBuildBtn = $("#mb-build-btn");
    const mbInspectInput = $("#mb-inspect-input");
    const mbInspectResult = $("#mb-inspect-result");

    function showModbusError(message) {
      const item = document.createElement("div");
      item.className = "fault-item is-fault";
      const heading = document.createElement("div");
      heading.className = "fault-head";
      heading.textContent = "输入或帧格式错误";
      const description = document.createElement("p");
      description.className = "fault-desc";
      description.textContent = message;
      item.append(heading, description);
      mbInspectResult.replaceChildren(item);
    }

    function buildModbusFrame() {
      const slave = Number(mbSlave.value) & 0xff;
      const fc = Number(mbFunc.value) & 0xff;
      const addr = Number(mbAddr.value) & 0xffff;
      const valStr = mbVal.value.trim();

      let pdu = [slave, fc, (addr >>> 8) & 0xff, addr & 0xff];
      if (fc === 0x10) {
        const tokens = valStr.split(/[\s,]+/).filter(Boolean);
        if (!tokens.length || tokens.length > 123) {
          showModbusError("10H 请填写 1～123 个寄存器值。");
          return;
        }
        const words = tokens.map((token) => /^(?:0x[0-9a-f]+|\d+)$/i.test(token) ? Number(token) : NaN);
        if (words.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffff)) {
          showModbusError("寄存器值须为 0～65535 的十进制整数或 0x 十六进制整数。");
          return;
        }
        const count = words.length;
        pdu.push((count >>> 8) & 0xff, count & 0xff, (count * 2) & 0xff);
        for (const w of words) {
          pdu.push((w >>> 8) & 0xff, w & 0xff);
        }
      } else {
        const v = (valStr.startsWith("0x") || valStr.startsWith("0X") ? parseInt(valStr, 16) : parseInt(valStr, 10)) & 0xffff;
        pdu.push((v >>> 8) & 0xff, v & 0xff);
      }

      const crc = crc16Modbus(pdu);
      const frame = [...pdu, crc & 0xff, (crc >>> 8) & 0xff];
      const hex = bytesToHexStr(frame);
      mbInspectInput.value = hex;
      modeSelect.value = "hex";
      payloadInput.value = bytesToHexStr(pdu);
      updateCrc();
      inspectModbusFrame();
    }

    function inspectModbusFrame() {
      const { bytes, error } = parseHexBytes(mbInspectInput.value, "hex");
      if (error || bytes.length < 4) {
        showModbusError(error || "Modbus RTU 最小帧长为 4 字节（含 2 字节 CRC）。");
        return;
      }
      if (bytes[1] === 0x10 && bytes.length !== 8) {
        const count = (bytes[4] << 8) | bytes[5];
        if (bytes.length < 9 || count < 1 || count > 123 || bytes[6] !== count * 2 || bytes.length !== 9 + bytes[6]) {
          showModbusError("10H 请求的寄存器数量、字节计数与实际帧长不一致。");
          return;
        }
      }
      const body = bytes.slice(0, -2);
      const rxCrc = bytes[bytes.length - 2] | (bytes[bytes.length - 1] << 8);
      const calc = crc16Modbus(body);
      const crcOk = rxCrc === calc;

      const slave = bytes[0];
      const fc = bytes[1];
      const fcNames = {
        0x01: "0x01 读线圈 (Read Coils)",
        0x02: "0x02 读离散输入 (Read Discrete Inputs)",
        0x03: "0x03 读保持寄存器 (Read Holding Registers)",
        0x04: "0x04 读输入寄存器 (Read Input Registers)",
        0x05: "0x05 写单个线圈 (Write Single Coil)",
        0x06: "0x06 写单个寄存器 (Write Single Register)",
        0x0f: "0x0F 写多个线圈 (Write Multiple Coils)",
        0x10: "0x10 写多个寄存器 (Write Multiple Registers)",
      };

      let detail = "";
      if (fc & 0x80) {
        const excCode = bytes[2];
        const excMap = {
          1: "0x01 非法功能码 (Illegal Function)",
          2: "0x02 非法数据地址 (Illegal Data Address)",
          3: "0x03 非法数据值 (Illegal Data Value)",
          4: "0x04 从站设备故障 (Slave Device Failure)",
        };
        detail = `异常响应帧：原功能码 0x${toHex(fc & 0x7f, 2)}，异常码 ${excMap[excCode] || `0x${toHex(excCode, 2)}`}`;
      } else if ((fc === 0x03 || fc === 0x04) && bytes.length === 8) {
        const regAddr = (bytes[2] << 8) | bytes[3];
        const regCnt = (bytes[4] << 8) | bytes[5];
        detail = `主机请求/8字节帧：起始地址 0x${toHex(regAddr, 4)} (${regAddr})，寄存器数量 ${regCnt} 个`;
      } else if ((fc === 0x03 || fc === 0x04) && bytes.length === 5 + bytes[2]) {
        const byteCount = bytes[2];
        const regs = [];
        for (let i = 0; i + 1 < byteCount; i += 2) {
          const w = (bytes[3 + i] << 8) | bytes[4 + i];
          regs.push(`R${i / 2}=0x${toHex(w, 4)}(${w})`);
        }
        detail = `从机数据响应：字节数 ${byteCount}B → ${regs.join(", ")}`;
      } else if (fc === 0x06 && bytes.length === 8) {
        const regAddr = (bytes[2] << 8) | bytes[3];
        const regVal = (bytes[4] << 8) | bytes[5];
        detail = `写单寄存器：地址 0x${toHex(regAddr, 4)} (${regAddr})，写入值 0x${toHex(regVal, 4)} (${regVal})`;
      } else if (fc === 0x10 && bytes.length >= 9) {
        const regAddr = (bytes[2] << 8) | bytes[3];
        const regCnt = (bytes[4] << 8) | bytes[5];
        const byteCnt = bytes[6];
        detail = `写多寄存器请求：起始地址 0x${toHex(regAddr, 4)}，数量 ${regCnt}，负载 ${byteCnt} 字节`;
      } else {
        detail = `数据域 (${body.length - 2} 字节)：${bytesToHexStr(body.slice(2))}`;
      }

      mbInspectResult.innerHTML = `<div class="fault-item ${crcOk ? "is-ok" : "is-fault"}">
        <div class="fault-head">
          <span>从站 #${slave} (0x${toHex(slave, 2)})</span>
          <span class="fault-tag">${fcNames[fc] || `功能码 0x${toHex(fc, 2)}`}</span>
          <span class="status-pill ${crcOk ? "ok" : "err"}">${
            crcOk
              ? `CRC 校验通过 (${toHex(calc & 0xff, 2)} ${toHex((calc >>> 8) & 0xff, 2)})`
              : `CRC 错误！帧尾为 ${toHex(rxCrc & 0xff, 2)} ${toHex((rxCrc >>> 8) & 0xff, 2)}，应为 ${toHex(calc & 0xff, 2)} ${toHex((calc >>> 8) & 0xff, 2)}`
          }</span>
        </div>
        <p class="fault-desc">${detail}</p>
      </div>`;
    }

    mbBuildBtn.addEventListener("click", buildModbusFrame);
    mbInspectInput.addEventListener("input", inspectModbusFrame);

    updateCrc();
    inspectModbusFrame();
  }

  // =========================================================================
  // 03. 32-bit Register Bitfield Editor & Cortex-M HardFault Decoder
  // =========================================================================
  function initRegisterFaultTool() {
    const regGrid = $("#bitfield-grid");
    const regHex = $("#reg-val-hex");
    const regNameInput = $("#reg-name");
    const msbInput = $("#slice-msb");
    const lsbInput = $("#slice-lsb");
    const sliceValInput = $("#slice-val");
    const cCodeOut = $("#bitfield-c-code");

    if (!regGrid) return;

    let regVal = 0x00008200;

    function buildGrid() {
      let html = "";
      for (let byteIdx = 3; byteIdx >= 0; byteIdx -= 1) {
        const hi = byteIdx * 8 + 7;
        const lo = byteIdx * 8;
        html += `<div class="byte-group">
          <div class="byte-group-head"><span>Byte ${byteIdx} [${hi}:${lo}]</span><span data-byte-hex="${byteIdx}">0x00</span></div>
          <div class="byte-bits">`;
        for (let b = hi; b >= lo; b -= 1) {
          html += `<button type="button" class="bit-cell" data-bit="${b}" aria-pressed="false" aria-label="Bit ${b}">
            <span class="bit-idx">${b}</span>
            <span class="bit-val">0</span>
          </button>`;
        }
        html += `</div></div>`;
      }
      regGrid.innerHTML = html;
    }

    function syncRegisterUI(skipHex = false) {
      let msb = Math.min(31, Math.max(0, Number(msbInput.value) || 0));
      let lsb = Math.min(31, Math.max(0, Number(lsbInput.value) || 0));
      if (msb < lsb) [msb, lsb] = [lsb, msb];

      const width = msb - lsb + 1;
      const maskUnshifted = width === 32 ? 0xffffffff : ((1 << width) - 1) >>> 0;
      const mask = (maskUnshifted << lsb) >>> 0;
      const sliceVal = ((regVal >>> lsb) & maskUnshifted) >>> 0;

      if (!skipHex) regHex.value = `0x${toHex(regVal, 8)}`;
      sliceValInput.value = `0x${sliceVal.toString(16).toUpperCase()} (${sliceVal})`;

      for (let byteIdx = 0; byteIdx < 4; byteIdx += 1) {
        const bVal = (regVal >>> (byteIdx * 8)) & 0xff;
        const el = $(`[data-byte-hex="${byteIdx}"]`, regGrid);
        if (el) el.textContent = `0x${toHex(bVal, 2)}`;
      }

      $$(".bit-cell", regGrid).forEach((cell) => {
        const b = Number(cell.getAttribute("data-bit"));
        const isOne = ((regVal >>> b) & 1) === 1;
        cell.setAttribute("aria-pressed", isOne ? "true" : "false");
        cell.classList.toggle("in-slice", b >= lsb && b <= msb);
        cell.querySelector(".bit-val").textContent = isOne ? "1" : "0";
      });

      const name = (regNameInput.value.trim() || "FIELD").toUpperCase();
      cCodeOut.textContent =
        `#define ${name}_POS    (${lsb}U)\n` +
        `#define ${name}_MASK   (0x${toHex(mask, 8)}UL) /* Bits [${msb}:${lsb}] */\n` +
        `/* 读取位域: 当前值 = ${sliceVal} (0x${sliceVal.toString(16).toUpperCase()}) */\n` +
        `uint32_t val = (REG & ${name}_MASK) >> ${name}_POS;\n` +
        `/* 清零并写入位域 */\n` +
        `REG = (REG & ~${name}_MASK) | (((uint32_t)0x${sliceVal.toString(16).toUpperCase()}U << ${name}_POS) & ${name}_MASK);`;
    }

    buildGrid();

    regGrid.addEventListener("click", (e) => {
      const cell = e.target.closest(".bit-cell");
      if (!cell) return;
      const b = Number(cell.getAttribute("data-bit"));
      regVal = (regVal ^ (1 << b)) >>> 0;
      syncRegisterUI();
    });

    regHex.addEventListener("input", () => {
      const raw = regHex.value.trim().replace(/^0x/i, "");
      if (/^[0-9a-fA-F]{1,8}$/.test(raw)) {
        regVal = parseInt(raw, 16) >>> 0;
        syncRegisterUI(true);
      }
    });

    [msbInput, lsbInput, regNameInput].forEach((el) => el.addEventListener("input", () => syncRegisterUI()));

    $$("[data-reg-op]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const op = btn.getAttribute("data-reg-op");
        if (op === "clear") regVal = 0;
        else if (op === "fill") regVal = 0xffffffff;
        else if (op === "invert") regVal = ~regVal >>> 0;
        syncRegisterUI();
      });
    });

    syncRegisterUI();

    // HardFault Decoder (SCB->CFSR & SCB->HFSR)
    const cfsrInput = $("#fault-cfsr");
    const hfsrInput = $("#fault-hfsr");
    const bfarInput = $("#fault-bfar");
    const faultOut = $("#fault-results");

    const CFSR_BITS = [
      // MMFSR [7:0]
      { bit: 0, group: "MMFSR", name: "IACCVIOL", desc: "取指访问违例：CPU 试图从禁止执行区域（如 XN 区或空指针 0x00000000）取指，常见于函数指针未初始化或栈被破坏后 POP PC。" },
      { bit: 1, group: "MMFSR", name: "DACCVIOL", desc: "数据访问违例：访问了 MPU 禁止读写的内存区域，查看 MMFAR 获取精确故障地址。" },
      { bit: 3, group: "MMFSR", name: "MUNSTKERR", desc: "异常返回出栈时发生 MemManage 错误：通常是栈指针 PSP/MSP 已损坏或越界。" },
      { bit: 4, group: "MMFSR", name: "MSTKERR", desc: "异常进入压栈时发生 MemManage 错误：典型的栈向下溢出（Stack Overflow）击穿了 RAM 下界。" },
      { bit: 5, group: "MMFSR", name: "MLSPERR", desc: "FPU 惰性压栈期间发生 MemManage 错误。" },
      { bit: 7, group: "MMFSR", name: "MMARVALID", desc: "SCB->MMFAR 寄存器中保存了有效的故障地址。" },
      // BFSR [15:8]
      { bit: 8, group: "BFSR", name: "IBUSERR", desc: "指令总线错误：取指到了非法物理地址（例如跳转到未映射的外设或 Flash 越界地址）。" },
      { bit: 9, group: "BFSR", name: "PRECISERR", desc: "精确数据总线错误：同步读写非法地址（如野指针解引用、外设时钟未开启即访问寄存器）。压栈的 PC 直接指向故障指令！" },
      { bit: 10, group: "BFSR", name: "IMPRECISERR", desc: "非精确数据总线错误：异步写缓冲（Write Buffer）写非法地址失败，异常滞后于故障指令触发。建议在调试时置位 SCB->ACTLR.DISDEFWBUF=1 将其转为精确错误定位。" },
      { bit: 11, group: "BFSR", name: "UNSTKERR", desc: "异常退出出栈时总线错误：中断退出时 SP 被篡改到非法地址。" },
      { bit: 12, group: "BFSR", name: "STKERR", desc: "异常进入压栈时总线错误：栈指针 SP 溢出到了非 RAM 地址空间（如 0x1FFFxxxx 以下）。" },
      { bit: 13, group: "BFSR", name: "LSPERR", desc: "浮点惰性状态保存时发生总线错误。" },
      { bit: 15, group: "BFSR", name: "BFARVALID", desc: "SCB->BFAR (0xE000ED38) 中记录了触发 PRECISERR 的精确非法访问地址！" },
      // UFSR [31:16]
      { bit: 16, group: "UFSR", name: "UNDEFINSTR", desc: "未定义指令错误：CPU 执行了非法机器码（如 Flash 擦写损坏、函数指针跳进数据表、或未使能 FPU 即执行浮点指令 CPACR 未配置）。" },
      { bit: 17, group: "UFSR", name: "INVSTATE", desc: "非法 EPSR 状态：Cortex-M 仅支持 Thumb 指令集，函数指针最低位 Bit0 必须为 1。若强制跳转到偶数地址（Bit0=0）或中断栈帧 xPSR.T 位被清零则触发此错误。" },
      { bit: 18, group: "UFSR", name: "INVPC", desc: "异常返回时非法 EXC_RETURN 值加载到 PC（如中断栈帧 LR 被局部数组越界覆盖）。" },
      { bit: 19, group: "UFSR", name: "NOCP", desc: "协处理器不存在或未使能：最常见为开启了硬件浮点编译（-mfloat-abi=hard），但启动代码未设置 SCB->CPACR |= (0xF << 20)。" },
      { bit: 24, group: "UFSR", name: "UNALIGNED", desc: "非对齐访问错误：执行了 LDM/STM/LDRD/STRD 非对齐访问，或置位了 CCR.UNALIGN_TRP 后对非对齐指针强转读写。" },
      { bit: 25, group: "UFSR", name: "DIVBYZERO", desc: "除零错误：当 SCB->CCR.DIV_0_TRP 置位时，执行 SDIV/UDIV 除以 0 触发。" },
    ];

    const HFSR_BITS = [
      { bit: 1, group: "HFSR", name: "VECTTBL", desc: "读取异常向量表时发生总线错误（如 VTOR 向量表偏移寄存器指向了非法地址）。" },
      { bit: 30, group: "HFSR", name: "FORCED", desc: "强制升级的 HardFault：由可配置故障（MemManage / BusFault / UsageFault）因未使能对应 Handler 或在同级异常中发生而升级为 HardFault，请重点查看上方 CFSR 解码结果。" },
      { bit: 31, group: "HFSR", name: "DEBUGEVT", desc: "调试事件触发的 HardFault。" },
    ];

    function decodeFaults() {
      const cfsr = parseInt(cfsrInput.value.trim().replace(/^0x/i, "") || "0", 16) >>> 0;
      const hfsr = parseInt(hfsrInput.value.trim().replace(/^0x/i, "") || "0", 16) >>> 0;
      const bfar = parseInt(bfarInput.value.trim().replace(/^0x/i, "") || "0", 16) >>> 0;

      const items = [];
      for (const b of HFSR_BITS) {
        if ((hfsr >>> b.bit) & 1) items.push(b);
      }
      for (const b of CFSR_BITS) {
        if ((cfsr >>> b.bit) & 1) items.push(b);
      }

      if (!items.length) {
        faultOut.innerHTML = `<li class="fault-item is-ok"><div class="fault-head">未检测到置位的故障标志位 (CFSR=0x00000000, HFSR=0x00000000)</div><p class="fault-desc">可点击上方预设按钮或粘贴调试器中读取的 SCB->CFSR (0xE000ED28) 与 SCB->HFSR (0xE000ED2C) 寄存器值。</p></li>`;
        return;
      }

      const bfarHint =
        (cfsr & (1 << 15)) || (cfsr & (1 << 7))
          ? `<li class="fault-item is-fault"><div class="fault-head"><span>故障目标地址有效</span><span class="fault-tag">BFAR/MMFAR = 0x${toHex(bfar, 8)}</span></div><p class="fault-desc">${
              bfar < 0x00001000
                ? "地址靠近 0x00000000，高度怀疑为 NULL 空指针解引用或结构体成员偏移访问（如 ptr->member 且 ptr==NULL）。"
                : bfar >= 0x40000000 && bfar < 0x60000000
                  ? "地址位于外设寄存器区 (0x40000000+)，请检查对应外设 RCC 时钟是否已使能，或访问了保留寄存器偏移。"
                  : "请结合 Keil .map 文件或 Memory 窗口排查该地址所属的段及越界偏移。"
            }</p></li>`
          : "";

      faultOut.innerHTML =
        bfarHint +
        items
          .map(
            (it) => `<li class="fault-item is-fault">
              <div class="fault-head">
                <span>${it.name} (Bit ${it.bit})</span>
                <span class="fault-tag">${it.group}</span>
              </div>
              <p class="fault-desc">${it.desc}</p>
            </li>`
          )
          .join("");
    }

    [cfsrInput, hfsrInput, bfarInput].forEach((el) => el.addEventListener("input", decodeFaults));

    $$("[data-fault-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        cfsrInput.value = btn.getAttribute("data-cfsr") || "0x00000000";
        hfsrInput.value = btn.getAttribute("data-hfsr") || "0x40000000";
        bfarInput.value = btn.getAttribute("data-bfar") || "0x00000000";
        regVal = parseInt(cfsrInput.value.replace(/^0x/i, ""), 16) >>> 0;
        syncRegisterUI();
        decodeFaults();
      });
    });

    decodeFaults();
  }

  // =========================================================================
  // 04. ADC Code/Voltage Converter & MCU Timer/PWM/Baudrate Calculator
  // =========================================================================
  function initAdcTimerTool() {
    const bitsSel = $("#adc-bits");
    const vrefInput = $("#adc-vref");
    const pgaSel = $("#adc-pga");
    const modeSel = $("#adc-mode");
    const codeInput = $("#adc-code");
    const voltInput = $("#adc-volt-mv");
    const adcSummary = $("#adc-summary");

    if (!bitsSel) return;

    function getAdcParams() {
      const bits = Number(bitsSel.value) || 24;
      const vref = Number(vrefInput.value) || 2.5;
      const pga = Number(pgaSel.value) || 1;
      const mode = modeSel.value; // unipolar | bipolar_offset | twos_comp
      const fullScaleV = vref / pga;
      const maxCode = Math.pow(2, bits) - 1;
      const halfScale = Math.pow(2, bits - 1);
      const lsbV = mode === "unipolar" ? fullScaleV / maxCode : (2 * fullScaleV) / Math.pow(2, bits);
      return { bits, vref, pga, mode, fullScaleV, maxCode, halfScale, lsbV };
    }

    function parseCode(str, maxCode) {
      const s = str.trim();
      const v = s.startsWith("0x") || s.startsWith("0X") ? parseInt(s, 16) : Number(s);
      if (!Number.isFinite(v)) return 0;
      return Math.max(0, Math.min(maxCode, Math.round(v)));
    }

    function updateFromCode(skipVolt = false) {
      const p = getAdcParams();
      const rawCode = parseCode(codeInput.value, p.maxCode);
      let voltV = 0;
      let signedCounts = rawCode;

      if (p.mode === "unipolar") {
        voltV = (rawCode / p.maxCode) * p.fullScaleV;
      } else if (p.mode === "bipolar_offset") {
        signedCounts = rawCode - p.halfScale;
        voltV = (signedCounts / p.halfScale) * p.fullScaleV;
      } else {
        signedCounts = rawCode >= p.halfScale ? rawCode - Math.pow(2, p.bits) : rawCode;
        voltV = (signedCounts / p.halfScale) * p.fullScaleV;
      }

      if (!skipVolt) {
        voltInput.value = (voltV * 1000).toFixed(p.bits >= 20 ? 4 : 2);
      }

      const hexWidth = Math.ceil(p.bits / 4);
      const lsbUv = p.lsbV * 1e6;
      adcSummary.innerHTML =
        `<tr><th>原始码值 (DEC / HEX)</th><td>${rawCode} / <code>0x${rawCode.toString(16).toUpperCase().padStart(hexWidth, "0")}</code> (净计数: ${signedCounts})</td></tr>` +
        `<tr><th>换算差分电压</th><td><strong>${voltV >= 0 ? "+" : ""}${(voltV * 1000).toFixed(4)} mV</strong> (${(voltV * 1e6).toFixed(2)} μV / ${voltV.toFixed(6)} V)</td></tr>` +
        `<tr><th>满量程输入范围 (FSR)</th><td>${p.mode === "unipolar" ? `0 ~ +${(p.fullScaleV * 1000).toFixed(2)} mV` : `±${(p.fullScaleV * 1000).toFixed(2)} mV`} (Vref=${p.vref}V, PGA=${p.pga}×)</td></tr>` +
        `<tr><th>1 LSB 分辨率</th><td>${lsbUv >= 1 ? `${lsbUv.toFixed(3)} μV` : `${(lsbUv * 1000).toFixed(2)} nV`}</td></tr>`;
    }

    function updateFromVolt() {
      const p = getAdcParams();
      const mv = Number(voltInput.value) || 0;
      const v = mv / 1000;
      let code = 0;
      if (p.mode === "unipolar") {
        code = Math.round((v / p.fullScaleV) * p.maxCode);
      } else if (p.mode === "bipolar_offset") {
        code = Math.round((v / p.fullScaleV) * p.halfScale + p.halfScale);
      } else {
        const sc = Math.max(-p.halfScale, Math.min(p.halfScale - 1, Math.round((v / p.fullScaleV) * p.halfScale)));
        code = sc < 0 ? sc + Math.pow(2, p.bits) : sc;
      }
      code = Math.max(0, Math.min(p.maxCode, code));
      const hexWidth = Math.ceil(p.bits / 4);
      codeInput.value = `0x${code.toString(16).toUpperCase().padStart(hexWidth, "0")}`;
      updateFromCode(true);
    }

    [bitsSel, vrefInput, pgaSel, modeSel].forEach((el) => el.addEventListener("change", () => updateFromCode(false)));
    vrefInput.addEventListener("input", () => updateFromCode(false));
    codeInput.addEventListener("input", () => updateFromCode(false));
    voltInput.addEventListener("input", updateFromVolt);

    // Timer / PWM & UART Baudrate Calculator
    const timClkInput = $("#tim-clk-mhz");
    const timFreqInput = $("#tim-target-hz");
    const timDutyInput = $("#tim-duty");
    const timTableBody = $("#tim-results-body");
    const uartTableBody = $("#uart-results-body");

    function updateTimerAndUart() {
      const clkMhz = Math.max(1, Number(timClkInput.value) || 144);
      const fClk = clkMhz * 1e6;
      const targetHz = Math.max(0.01, Number(timFreqInput.value) || 1000);
      const enteredDuty = timDutyInput.value.trim() === "" ? NaN : Number(timDutyInput.value);
      const duty = Math.min(100, Math.max(0, Number.isFinite(enteredDuty) ? enteredDuty : 50));

      const totalCounts = fClk / targetHz;
      const candidates = [];

      const minPsc = Math.max(0, Math.floor(totalCounts / 65536) - 1);
      const maxPsc = Math.min(65535, Math.ceil(totalCounts / 2) + 2);

      for (let psc = minPsc; psc <= Math.min(maxPsc, minPsc + 4000); psc += 1) {
        const periodCounts = Math.round(totalCounts / (psc + 1));
        if (periodCounts >= 2 && periodCounts <= 65536) {
          const arr = periodCounts - 1;
          const actualHz = fClk / ((psc + 1) * (arr + 1));
          const errPpm = ((actualHz - targetHz) / targetHz) * 1e6;
          candidates.push({
            psc,
            arr,
            ccr: Math.round(((arr + 1) * duty) / 100),
            actualHz,
            absErr: Math.abs(errPpm),
            errPpm,
          });
        }
      }

      candidates.sort((a, b) => a.absErr - b.absErr || b.arr - a.arr);
      const top = candidates.slice(0, 4);

      if (!top.length) {
        timTableBody.innerHTML = `<tr><td colspan="4">目标频率超出 16-bit 定时器单级分频范围，请使用 32-bit 定时器或级联主从定时器。</td></tr>`;
      } else {
        timTableBody.innerHTML = top
          .map(
            (c) => `<tr>
              <td><code>PSC = ${c.psc}</code>, <code>ARR = ${c.arr}</code></td>
              <td><code>CCR = ${c.ccr}</code> (${((c.ccr / (c.arr + 1)) * 100).toFixed(2)}%)</td>
              <td>${c.actualHz.toFixed(2)} Hz (${(1000 / c.actualHz).toFixed(3)} ms)</td>
              <td><span class="status-pill ${c.absErr < 1 ? "ok" : c.absErr < 1000 ? "warn" : "err"}">${c.absErr < 0.05 ? "0 ppm (精确)" : `${c.errPpm >= 0 ? "+" : ""}${c.errPpm.toFixed(1)} ppm`}</span></td>
            </tr>`
          )
          .join("");
      }

      // Common UART baudrates check (16x oversampling)
      const bauds = [115200, 250000, 460800, 921600, 2000000];
      uartTableBody.innerHTML = bauds
        .map((baud) => {
          const brr = Math.round(fClk / baud); // 16x oversampling integer BRR (MANTISSA<<4 | FRAC)
          const actual = brr > 0 ? fClk / brr : 0;
          const errPct = ((actual - baud) / baud) * 100;
          const absPct = Math.abs(errPct);
          return `<tr>
            <td><strong>${baud} bps</strong>${baud === 250000 ? " (DMX512)" : ""}</td>
            <td><code>BRR=0x${toHex(brr, 4)}</code> (DIV=${(brr / 16).toFixed(4)})</td>
            <td><span class="status-pill ${absPct < 0.5 ? "ok" : absPct < 2.0 ? "warn" : "err"}">${errPct >= 0 ? "+" : ""}${errPct.toFixed(2)}%</span></td>
          </tr>`;
        })
        .join("");
    }

    [timClkInput, timFreqInput, timDutyInput].forEach((el) => el.addEventListener("input", updateTimerAndUart));

    updateFromCode(false);
    updateTimerAndUart();
  }

  // =========================================================================
  // 05. RGB888 <-> RGB565 Palette & 1-bit Bitmap Font Inspector/Editor
  // =========================================================================
  function initDisplayFontTool() {
    const colorPicker = $("#rgb-picker");
    const rgb888Input = $("#rgb888-hex");
    const rgb565Input = $("#rgb565-hex");
    const swatchOrig = $("#swatch-orig");
    const swatch565 = $("#swatch-565");
    const swatchSwap = $("#swatch-swap");
    const swatchOrigMeta = $("#swatch-orig-meta");
    const swatch565Meta = $("#swatch-565-meta");
    const swatchSwapMeta = $("#swatch-swap-meta");
    const rgbCodeOut = $("#rgb-c-code");

    if (!colorPicker) return;

    function syncFromRgb888(r, g, b, skip565 = false) {
      const hex888 = `#${toHex((r << 16) | (g << 8) | b, 6)}`;
      colorPicker.value = hex888.toLowerCase();
      rgb888Input.value = hex888;

      const r5 = (r >>> 3) & 0x1f;
      const g6 = (g >>> 2) & 0x3f;
      const b5 = (b >>> 3) & 0x1f;
      const rgb565 = ((r5 << 11) | (g6 << 5) | b5) & 0xffff;
      const swapped = (((rgb565 & 0xff) << 8) | ((rgb565 >>> 8) & 0xff)) & 0xffff;
      const bgr565 = ((b5 << 11) | (g6 << 5) | r5) & 0xffff;

      if (!skip565) rgb565Input.value = `0x${toHex(rgb565, 4)}`;

      // Reconstruct quantized 8-bit from 565
      const qr = (r5 << 3) | (r5 >>> 2);
      const qg = (g6 << 2) | (g6 >>> 4);
      const qb = (b5 << 3) | (b5 >>> 2);
      const qHex = `#${toHex((qr << 16) | (qg << 8) | qb, 6)}`;

      // What happens on screen if DMA byte order is wrong (swapped interpreted as RGB565)
      const sr5 = (swapped >>> 11) & 0x1f;
      const sg6 = (swapped >>> 5) & 0x3f;
      const sb5 = swapped & 0x1f;
      const sHex = `#${toHex((((sr5 << 3) | (sr5 >>> 2)) << 16) | (((sg6 << 2) | (sg6 >>> 4)) << 8) | ((sb5 << 3) | (sb5 >>> 2)), 6)}`;

      swatchOrig.style.background = hex888;
      swatchOrigMeta.textContent = `RGB888: ${hex888}\n(${r}, ${g}, ${b})`;

      swatch565.style.background = qHex;
      swatch565Meta.textContent = `RGB565: 0x${toHex(rgb565, 4)}\nR5=${r5} G6=${g6} B5=${b5}`;

      swatchSwap.style.background = sHex;
      swatchSwapMeta.textContent = `高低字节颠倒: 0x${toHex(swapped, 4)}\n(SPI 8-bit DMA 常见偏色)`;

      rgbCodeOut.textContent =
        `#define COLOR_RGB565       (0x${toHex(rgb565, 4)}U) /* R=${r5}, G=${g6}, B=${b5} */\n` +
        `#define COLOR_RGB565_SWAP  (0x${toHex(swapped, 4)}U) /* SPI 8-bit Big-Endian: 0x${toHex((rgb565 >>> 8) & 0xff, 2)}, 0x${toHex(rgb565 & 0xff, 2)} */\n` +
        `#define COLOR_BGR565       (0x${toHex(bgr565, 4)}U) /* MADCTL.BGR=1 反转模式 */`;
    }

    colorPicker.addEventListener("input", () => {
      const v = parseInt(colorPicker.value.slice(1), 16);
      syncFromRgb888((v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
    });

    rgb888Input.addEventListener("input", () => {
      const raw = rgb888Input.value.trim().replace(/^#|^0x/i, "");
      if (/^[0-9a-fA-F]{6}$/.test(raw)) {
        const v = parseInt(raw, 16);
        syncFromRgb888((v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
      }
    });

    rgb565Input.addEventListener("input", () => {
      const raw = rgb565Input.value.trim().replace(/^0x/i, "");
      if (/^[0-9a-fA-F]{1,4}$/.test(raw)) {
        const v = parseInt(raw, 16) & 0xffff;
        const r5 = (v >>> 11) & 0x1f;
        const g6 = (v >>> 5) & 0x3f;
        const b5 = v & 0x1f;
        const r = (r5 << 3) | (r5 >>> 2);
        const g = (g6 << 2) | (g6 >>> 4);
        const b = (b5 << 3) | (b5 >>> 2);
        syncFromRgb888(r, g, b, true);
      }
    });

    syncFromRgb888(0x0f, 0x81, 0x8d);

    // 1-bit Bitmap Font Inspector / Editor
    const sizeSelect = $("#font-size-select");
    const orderSelect = $("#font-order-select");
    const pixelGrid = $("#font-pixel-grid");
    const hexTextarea = $("#font-hex-textarea");

    let width = 8;
    let height = 16;
    let pixels = new Uint8Array(width * height);
    let isDrawing = false;
    let drawVal = 1;

    const PRESET_GLYPHS = {
      "8x16_A": {
        size: "8x16",
        bytes: [0x00, 0x00, 0x18, 0x24, 0x24, 0x42, 0x42, 0x7e, 0x42, 0x42, 0x42, 0x42, 0x00, 0x00, 0x00, 0x00],
      },
      "12x12_degC": {
        size: "12x12",
        bytes: [
          0x60, 0x00, 0x97, 0x80, 0x98, 0x40, 0x68, 0x00, 0x08, 0x00, 0x08, 0x00, 0x08, 0x00, 0x08, 0x00, 0x08, 0x40,
          0x07, 0x80, 0x00, 0x00, 0x00, 0x00,
        ],
      },
      "16x16_warn": {
        size: "16x16",
        bytes: [
          0x01, 0x80, 0x03, 0xc0, 0x03, 0xc0, 0x06, 0x60, 0x06, 0x60, 0x0d, 0xb0, 0x0d, 0xb0, 0x19, 0x98, 0x19, 0x98,
          0x31, 0x8c, 0x30, 0x0c, 0x61, 0x86, 0x61, 0x86, 0x7f, 0xfe, 0x3f, 0xfc, 0x00, 0x00,
        ],
      },
    };

    function renderPixelGrid() {
      pixelGrid.style.gridTemplateColumns = `repeat(${width}, auto)`;
      let html = "";
      for (let i = 0; i < width * height; i += 1) {
        const x = i % width;
        const y = Math.floor(i / width);
        html += `<button type="button" class="pixel-cell${pixels[i] ? " on" : ""}" data-px="${i}" aria-label="Pixel (${x}, ${y})"></button>`;
      }
      pixelGrid.innerHTML = html;
    }

    function encodePixelsToBytes() {
      const order = orderSelect.value; // row_msb | row_lsb | col_lsb
      const bytes = [];
      if (order === "row_msb" || order === "row_lsb") {
        const bytesPerRow = Math.ceil(width / 8);
        for (let y = 0; y < height; y += 1) {
          for (let bx = 0; bx < bytesPerRow; bx += 1) {
            let b = 0;
            for (let bit = 0; bit < 8; bit += 1) {
              const x = bx * 8 + bit;
              const on = x < width ? pixels[y * width + x] : 0;
              if (on) {
                b |= order === "row_msb" ? 1 << (7 - bit) : 1 << bit;
              }
            }
            bytes.push(b);
          }
        }
      } else {
        const pages = Math.ceil(height / 8);
        for (let p = 0; p < pages; p += 1) {
          for (let x = 0; x < width; x += 1) {
            let b = 0;
            for (let bit = 0; bit < 8; bit += 1) {
              const y = p * 8 + bit;
              const on = y < height ? pixels[y * width + x] : 0;
              if (on) b |= 1 << bit;
            }
            bytes.push(b);
          }
        }
      }
      return bytes;
    }

    function decodeBytesToPixels(bytes) {
      const order = orderSelect.value;
      pixels.fill(0);
      let idx = 0;
      if (order === "row_msb" || order === "row_lsb") {
        const bytesPerRow = Math.ceil(width / 8);
        for (let y = 0; y < height; y += 1) {
          for (let bx = 0; bx < bytesPerRow; bx += 1) {
            const b = bytes[idx++] || 0;
            for (let bit = 0; bit < 8; bit += 1) {
              const x = bx * 8 + bit;
              if (x < width) {
                const mask = order === "row_msb" ? 1 << (7 - bit) : 1 << bit;
                pixels[y * width + x] = b & mask ? 1 : 0;
              }
            }
          }
        }
      } else {
        const pages = Math.ceil(height / 8);
        for (let p = 0; p < pages; p += 1) {
          for (let x = 0; x < width; x += 1) {
            const b = bytes[idx++] || 0;
            for (let bit = 0; bit < 8; bit += 1) {
              const y = p * 8 + bit;
              if (y < height) {
                pixels[y * width + x] = b & (1 << bit) ? 1 : 0;
              }
            }
          }
        }
      }
    }

    function syncTextareaFromGrid() {
      const bytes = encodePixelsToBytes();
      const hexList = bytes.map((b) => `0x${toHex(b, 2)}`);
      const lines = [];
      for (let i = 0; i < hexList.length; i += 8) {
        lines.push("  " + hexList.slice(i, i + 8).join(", "));
      }
      hexTextarea.value = `/* ${width}x${height}, ${bytes.length} bytes (${orderSelect.options[orderSelect.selectedIndex].text}) */\nconst uint8_t glyph_${width}x${height}[${bytes.length}] = {\n${lines.join(",\n")}\n};`;
    }

    function applyPixelState(idx, val) {
      pixels[idx] = val;
      const cell = $(`[data-px="${idx}"]`, pixelGrid);
      if (cell) cell.classList.toggle("on", Boolean(val));
      syncTextareaFromGrid();
    }

    pixelGrid.addEventListener("pointerdown", (e) => {
      const cell = e.target.closest(".pixel-cell");
      if (!cell) return;
      e.preventDefault();
      const idx = Number(cell.getAttribute("data-px"));
      isDrawing = true;
      drawVal = pixels[idx] ? 0 : 1;
      applyPixelState(idx, drawVal);
    });

    pixelGrid.addEventListener("pointerover", (e) => {
      if (!isDrawing) return;
      const cell = e.target.closest(".pixel-cell");
      if (!cell) return;
      const idx = Number(cell.getAttribute("data-px"));
      if (pixels[idx] !== drawVal) applyPixelState(idx, drawVal);
    });

    window.addEventListener("pointerup", () => {
      isDrawing = false;
    });

    sizeSelect.addEventListener("change", () => {
      const [w, h] = sizeSelect.value.split("x").map(Number);
      width = w;
      height = h;
      pixels = new Uint8Array(width * height);
      renderPixelGrid();
      syncTextareaFromGrid();
    });

    orderSelect.addEventListener("change", syncTextareaFromGrid);

    hexTextarea.addEventListener("input", () => {
      const bodyMatch = hexTextarea.value.match(/\{([\s\S]*?)\}/);
      const raw = bodyMatch ? bodyMatch[1] : hexTextarea.value;
      const matches = [...raw.matchAll(/0x([0-9a-fA-F]{1,2})/g)];
      if (matches.length) {
        const bytes = matches.map((m) => parseInt(m[1], 16));
        decodeBytesToPixels(bytes);
        $$(".pixel-cell", pixelGrid).forEach((cell, i) => {
          cell.classList.toggle("on", Boolean(pixels[i]));
        });
      }
    });

    $$("[data-font-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.getAttribute("data-font-preset");
        if (key === "clear") {
          pixels.fill(0);
          renderPixelGrid();
          syncTextareaFromGrid();
          return;
        }
        if (key === "invert") {
          for (let i = 0; i < pixels.length; i += 1) pixels[i] ^= 1;
          renderPixelGrid();
          syncTextareaFromGrid();
          return;
        }
        const preset = PRESET_GLYPHS[key];
        if (!preset) return;
        sizeSelect.value = preset.size;
        orderSelect.value = "row_msb";
        const [w, h] = preset.size.split("x").map(Number);
        width = w;
        height = h;
        pixels = new Uint8Array(width * height);
        decodeBytesToPixels(preset.bytes);
        renderPixelGrid();
        syncTextareaFromGrid();
      });
    });

    // Load default 8x16 'A'
    decodeBytesToPixels(PRESET_GLYPHS["8x16_A"].bytes);
    renderPixelGrid();
    syncTextareaFromGrid();
  }

  initToolTabs();
  initRadixTool();
  initCrcModbusTool();
  initRegisterFaultTool();
  initAdcTimerTool();
  initDisplayFontTool();
})();
