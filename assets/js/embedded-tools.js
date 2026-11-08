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

  // =========================================================================
  // 06. Voltage Divider / E24, NTC Thermistor LUT & Battery Life Estimator
  // =========================================================================
  function initAnalogPowerTool() {
    const vinInput = $("#vdiv-vin");
    const r1Input = $("#vdiv-r1");
    const r2Input = $("#vdiv-r2");
    const targetInput = $("#vdiv-target");
    const vdivSummary = $("#vdiv-summary");

    if (!vinInput) return;

    const E24_BASE = [
      1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0,
      3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1,
    ];
    const E24_POOL = [];
    for (const dec of [1, 10, 100]) {
      for (const b of E24_BASE) E24_POOL.push(Number((b * dec).toFixed(1)));
    }

    function updateVdiv() {
      const vin = Math.max(0.01, Number(vinInput.value) || 4.2);
      const r1 = Math.max(0.001, Number(r1Input.value) || 100);
      const r2 = Math.max(0.001, Number(r2Input.value) || 100);
      const targetV = Math.max(0.01, Math.min(vin - 0.01, Number(targetInput.value) || vin / 2));

      const ratio = r2 / (r1 + r2);
      const vout = vin * ratio;
      const iDivUa = (vin / (r1 + r2)) * 1000; // R in kOhm -> mA * 1000 = uA
      const pMw = (vin * iDivUa) / 1000;
      const reqImpedance = (r1 * r2) / (r1 + r2);
      const adc3v3 = Math.min(4095, Math.max(0, Math.round((vout / 3.3) * 4095)));

      // Find best E24 pair in 10k..470k range for targetV
      let bestPair = { r1: 100, r2: 100, v: vin * 0.5, errPct: 100 };
      for (const c1 of E24_POOL) {
        if (c1 < 4.7 || c1 > 470) continue;
        for (const c2 of E24_POOL) {
          if (c2 < 4.7 || c2 > 470) continue;
          const v = vin * (c2 / (c1 + c2));
          const errPct = ((v - targetV) / targetV) * 100;
          if (Math.abs(errPct) < Math.abs(bestPair.errPct)) {
            bestPair = { r1: c1, r2: c2, v, errPct };
          }
        }
      }

      vdivSummary.innerHTML =
        `<tr><th>分压输出 Vout</th><td><strong>${vout.toFixed(4)} V</strong> (分压比 ${(ratio * 100).toFixed(2)}%, 3.3V 12-bit ADC ≈ <code>${adc3v3}</code>)</td></tr>` +
        `<tr><th>支路漏电流 &amp; 等效源阻抗</th><td>I_div = <strong>${iDivUa.toFixed(2)} μA</strong> (${pMw.toFixed(3)} mW) · R_eq = ${reqImpedance.toFixed(2)} kΩ ${reqImpedance > 50 ? '<span class="status-pill warn">建议并联 100nF 采样电容</span>' : '<span class="status-pill ok">SAR 直采友好</span>'}</td></tr>` +
        `<tr><th>目标 ${targetV.toFixed(2)}V 最优 E24 配对</th><td><code>R1 = ${bestPair.r1} kΩ</code> + <code>R2 = ${bestPair.r2} kΩ</code> → 实出 <strong>${bestPair.v.toFixed(4)} V</strong> (误差 ${bestPair.errPct >= 0 ? "+" : ""}${bestPair.errPct.toFixed(2)}%)</td></tr>`;
    }

    [vinInput, r1Input, r2Input, targetInput].forEach((el) => el.addEventListener("input", updateVdiv));

    // NTC B-Model & Lookup Table
    const ntcR25Input = $("#ntc-r25");
    const ntcBInput = $("#ntc-b");
    const ntcRpullInput = $("#ntc-rpull");
    const ntcTempInput = $("#ntc-temp");
    const ntcSummary = $("#ntc-summary");
    const ntcLutOut = $("#ntc-c-lut");

    function calcNtcKohm(r25, bVal, tempC) {
      const tK = tempC + 273.15;
      const t25 = 298.15;
      return r25 * Math.exp(bVal * (1 / tK - 1 / t25));
    }

    function updateNtc() {
      const r25 = Math.max(0.1, Number(ntcR25Input.value) || 10);
      const bVal = Math.max(1000, Number(ntcBInput.value) || 3950);
      const rPull = Math.max(0.1, Number(ntcRpullInput.value) || 10);
      const tempC = Number(ntcTempInput.value);
      const validTemp = Number.isFinite(tempC) ? tempC : 25;

      const rNtc = calcNtcKohm(r25, bVal, validTemp);
      const ratio = rNtc / (rPull + rNtc);
      const adc12 = Math.round(ratio * 4095);
      const vSense = ratio * 3.3;

      ntcSummary.innerHTML =
        `<tr><th>当前温度 (${validTemp}℃) NTC 阻值</th><td><strong>${rNtc >= 1 ? `${rNtc.toFixed(3)} kΩ` : `${(rNtc * 1000).toFixed(1)} Ω`}</strong> (R25=${r25}kΩ, B=${bVal}K)</td></tr>` +
        `<tr><th>分压比与 12-bit ADC 码值</th><td><code>ADC = ${adc12}</code> (0x${toHex(adc12, 3)}) · V_ntc = ${vSense.toFixed(3)} V (@3.3V)</td></tr>`;

      const temps = [];
      const codes = [];
      for (let t = -20; t <= 105; t += 5) {
        const rt = calcNtcKohm(r25, bVal, t);
        const c = Math.round((rt / (rPull + rt)) * 4095);
        temps.push(t);
        codes.push(c);
      }

      const rows = [];
      for (let i = 0; i < codes.length; i += 6) {
        const slice = codes.slice(i, i + 6).map((c) => String(c).padStart(4, " "));
        const tStart = temps[i];
        const tEnd = temps[Math.min(temps.length - 1, i + 5)];
        rows.push(`  ${slice.join(", ")}, /* ${String(tStart).padStart(3, " ")}℃ .. ${String(tEnd).padStart(3, " ")}℃ */`);
      }

      ntcLutOut.textContent =
        `/* NTC R25=${r25}k, B=${bVal}K, Rpull=${rPull}k, 12-bit ADC (0..4095), Step=5℃ */\n` +
        `#define NTC_LUT_MIN_TEMP  (-20)\n` +
        `#define NTC_LUT_STEP      (5)\n` +
        `#define NTC_LUT_LEN       (${codes.length}U)\n` +
        `static const uint16_t g_ntc_adc_lut[NTC_LUT_LEN] = {\n${rows.join("\n")}\n};`;
    }

    [ntcR25Input, ntcBInput, ntcRpullInput, ntcTempInput].forEach((el) => el.addEventListener("input", updateNtc));

    // Battery Life Estimator
    const batCapInput = $("#bat-cap");
    const batEffInput = $("#bat-eff");
    const batPeriodInput = $("#bat-period");
    const batIRunInput = $("#bat-i-run");
    const batTRunInput = $("#bat-t-run");
    const batITxInput = $("#bat-i-tx");
    const batTTxInput = $("#bat-t-tx");
    const batISleepInput = $("#bat-i-sleep");
    const batSummary = $("#bat-summary");
    const batBars = $("#bat-bars");

    const BAT_PRESETS = {
      handheld: { cap: 1500, eff: 85, period: 1, iRun: 28, tRun: 900, iTx: 45, tTx: 100, iSleep: 15 },
      sensor: { cap: 1200, eff: 85, period: 10, iRun: 18, tRun: 40, iTx: 65, tTx: 15, iSleep: 12 },
      meter: { cap: 2400, eff: 80, period: 60, iRun: 8, tRun: 25, iTx: 85, tTx: 40, iSleep: 3.5 },
    };

    function updateBattery() {
      const capMah = Math.max(1, Number(batCapInput.value) || 1200);
      const effPct = Math.min(100, Math.max(10, Number(batEffInput.value) || 85));
      const periodS = Math.max(0.05, Number(batPeriodInput.value) || 10);
      const iRunMa = Math.max(0, Number(batIRunInput.value) || 0);
      const tRunMs = Math.max(0, Number(batTRunInput.value) || 0);
      const iTxMa = Math.max(0, Number(batITxInput.value) || 0);
      const tTxMs = Math.max(0, Number(batTTxInput.value) || 0);
      const iSleepUa = Math.max(0.05, Number(batISleepInput.value) || 10);

      const tRunS = Math.min(periodS, tRunMs / 1000);
      const tTxS = Math.min(Math.max(0, periodS - tRunS), tTxMs / 1000);
      const tSleepS = Math.max(0, periodS - tRunS - tTxS);

      const qRunMc = iRunMa * tRunS;
      const qTxMc = iTxMa * tTxS;
      const qSleepMc = (iSleepUa / 1000) * tSleepS;
      const qTotalMc = Math.max(1e-9, qRunMc + qTxMc + qSleepMc);

      const iAvgMa = qTotalMc / periodS;
      const iAvgUa = iAvgMa * 1000;
      const effCapMah = capMah * (effPct / 100);
      const hours = effCapMah / iAvgMa;
      const days = hours / 24;
      const years = days / 365;

      const pctRun = (qRunMc / qTotalMc) * 100;
      const pctTx = (qTxMc / qTotalMc) * 100;
      const pctSleep = (qSleepMc / qTotalMc) * 100;

      const dutyPct = ((tRunS + tTxS) / periodS) * 100;

      batSummary.innerHTML =
        `<tr><th>周期平均电流 I_avg</th><td><strong>${iAvgMa >= 1 ? `${iAvgMa.toFixed(3)} mA` : `${iAvgUa.toFixed(2)} μA`}</strong> (唤醒占空比 ${dutyPct.toFixed(2)}%)</td></tr>` +
        `<tr><th>有效可用容量</th><td><strong>${effCapMah.toFixed(0)} mAh</strong> (标称 ${capMah} mAh × ${effPct}%)</td></tr>` +
        `<tr><th>预计连续续航时间</th><td><strong>${days >= 365 ? `${years.toFixed(2)} 年 (${days.toFixed(0)} 天)` : days >= 2 ? `${days.toFixed(1)} 天 (${hours.toFixed(0)} 小时)` : `${hours.toFixed(1)} 小时`}</strong></td></tr>`;

      batBars.innerHTML =
        `<div class="usage-bar-item"><div class="usage-bar-head"><span>MCU 唤醒阶段 (${tRunMs}ms @ ${iRunMa}mA)</span><span>${pctRun.toFixed(1)}%</span></div><div class="usage-bar-track"><div class="usage-bar-fill" style="width:${pctRun.toFixed(1)}%"></div></div></div>` +
        `<div class="usage-bar-item"><div class="usage-bar-head"><span>采集/通信脉冲 (${tTxMs}ms @ ${iTxMa}mA)</span><span>${pctTx.toFixed(1)}%</span></div><div class="usage-bar-track"><div class="usage-bar-fill warn" style="width:${pctTx.toFixed(1)}%"></div></div></div>` +
        `<div class="usage-bar-item"><div class="usage-bar-head"><span>深度休眠底流 (${tSleepS.toFixed(2)}s @ ${iSleepUa}μA)</span><span>${pctSleep.toFixed(1)}%</span></div><div class="usage-bar-track"><div class="usage-bar-fill ok" style="width:${pctSleep.toFixed(1)}%"></div></div></div>`;
    }

    [batCapInput, batEffInput, batPeriodInput, batIRunInput, batTRunInput, batITxInput, batTTxInput, batISleepInput].forEach((el) =>
      el.addEventListener("input", updateBattery)
    );

    $$("[data-bat-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = BAT_PRESETS[btn.getAttribute("data-bat-preset")];
        if (!p) return;
        batCapInput.value = p.cap;
        batEffInput.value = p.eff;
        batPeriodInput.value = p.period;
        batIRunInput.value = p.iRun;
        batTRunInput.value = p.tRun;
        batITxInput.value = p.iTx;
        batTTxInput.value = p.tTx;
        batISleepInput.value = p.iSleep;
        updateBattery();
      });
    });

    updateVdiv();
    updateNtc();
    updateBattery();
  }

  // =========================================================================
  // 07. SPI NOR Flash Map, EEPROM Page-Write Splitter & Wear-Leveling
  // =========================================================================
  function initStorageLayoutTool() {
    const flashAddrInput = $("#flash-addr");
    const pageSizeSel = $("#eeprom-page-size");
    const flashSummary = $("#flash-map-summary");
    const eepromStartInput = $("#eeprom-start");
    const eepromLenInput = $("#eeprom-len");
    const eepromChunks = $("#eeprom-chunks");

    if (!flashAddrInput) return;

    function parseAddr(str) {
      const s = str.trim();
      const n = s.startsWith("0x") || s.startsWith("0X") ? parseInt(s, 16) : Number(s);
      return Number.isFinite(n) && n >= 0 ? n >>> 0 : 0;
    }

    function updateFlashAndEeprom() {
      const addr = parseAddr(flashAddrInput.value);
      const block64 = addr >>> 16;
      const sector4k = addr >>> 12;
      const page256 = addr >>> 8;
      const secBase = (sector4k * 4096) >>> 0;
      const secEnd = (secBase + 4095) >>> 0;
      const secOffset = addr & 0xfff;
      const pageOffset = addr & 0xff;
      const a23_16 = (addr >>> 16) & 0xff;
      const a15_8 = (addr >>> 8) & 0xff;
      const a7_0 = addr & 0xff;

      flashSummary.innerHTML =
        `<tr><th>64KB Block / 4KB Sector</th><td><code>Block #${block64}</code> · <code>Sector #${sector4k}</code> (扇区内偏移 <code>+0x${toHex(secOffset, 3)}</code> / ${secOffset} B)</td></tr>` +
        `<tr><th>所属 4KB 扇区物理边界</th><td><code>0x${toHex(secBase, 6)} ~ 0x${toHex(secEnd, 6)}</code> (擦除指令: <code>20 ${toHex(a23_16, 2)} ${toHex(a15_8 & 0xf0, 2)} 00</code>)</td></tr>` +
        `<tr><th>256B Page 索引与页内偏移</th><td><code>Page #${page256}</code> · 页内偏移 <code>+0x${toHex(pageOffset, 2)}</code> (本页剩余可写 ${256 - pageOffset} B)</td></tr>`;

      // EEPROM / Flash Page Splitter
      const pageSize = Number(pageSizeSel.value) || 16;
      const startAddr = parseAddr(eepromStartInput.value);
      const totalLen = Math.min(4096, Math.max(1, Number(eepromLenInput.value) || 1));

      const chunks = [];
      let cur = startAddr;
      let rem = totalLen;
      while (rem > 0) {
        const pageIdx = Math.floor(cur / pageSize);
        const offsetInPage = cur % pageSize;
        const canWrite = Math.min(rem, pageSize - offsetInPage);
        chunks.push({
          idx: chunks.length + 1,
          start: cur,
          end: cur + canWrite - 1,
          len: canWrite,
          pageIdx,
          offsetInPage,
        });
        cur += canWrite;
        rem -= canWrite;
      }

      eepromChunks.innerHTML = chunks
        .map(
          (c) => `<div class="chunk-item">
            <span class="fault-tag">事务 #${c.idx}</span>
            <span>Page ${c.pageIdx} (页内偏移 +${c.offsetInPage})</span>
            <code>Addr: 0x${toHex(c.start, 4)}..0x${toHex(c.end, 4)}</code>
            <strong>写入 ${c.len} Bytes</strong>
          </div>`
        )
        .join("");
    }

    [flashAddrInput, pageSizeSel, eepromStartInput, eepromLenInput].forEach((el) =>
      el.addEventListener("input", updateFlashAndEeprom)
    );

    // Wear-Leveling Estimator
    const wlSectorsInput = $("#wl-sectors");
    const wlHdrInput = $("#wl-hdr-size");
    const wlRecInput = $("#wl-rec-size");
    const wlWritesInput = $("#wl-writes-day");
    const wlEnduranceSel = $("#wl-endurance");
    const wlSummary = $("#wl-summary");
    const wlCodeOut = $("#wl-c-code");

    function updateWearLeveling() {
      const sectors = Math.max(2, Number(wlSectorsInput.value) || 16);
      const hdrSize = Math.min(512, Math.max(0, Number(wlHdrInput.value) || 16));
      const recSize = Math.max(4, Number(wlRecInput.value) || 32);
      const writesPerDay = Math.max(1, Number(wlWritesInput.value) || 500);
      const endurance = Number(wlEnduranceSel.value) || 100000;

      const recsPerSector = Math.max(1, Math.floor((4096 - hdrSize) / recSize));
      const wasteBytes = 4096 - hdrSize - recsPerSector * recSize;
      const totalRecs = sectors * recsPerSector;
      const activeRecs = (sectors - 1) * recsPerSector; // 1 spare sector for GC
      const totalLifetimeWrites = totalRecs * endurance;
      const lifeDays = totalLifetimeWrites / writesPerDay;
      const lifeYears = lifeDays / 365;

      wlSummary.innerHTML =
        `<tr><th>单扇区可存记录数</th><td><strong>${recsPerSector} 条/扇区</strong> (扇区头 ${hdrSize}B + 记录区 ${recsPerSector * recSize}B，尾部空闲 ${wasteBytes}B)</td></tr>` +
        `<tr><th>环形区总容量 (${sectors}×4KB = ${sectors * 4}KB)</th><td>总槽位 <strong>${totalRecs} 条</strong> · 有效留存 <strong>${activeRecs} 条</strong> (预留 1 扇区用于非阻塞擦除回收)</td></tr>` +
        `<tr><th>全区轮转 1 圈写入量</th><td>每写入 <strong>${totalRecs.toLocaleString()} 条</strong> 记录，各扇区仅发生 1 次擦除</td></tr>` +
        `<tr><th>预计存储介质寿命</th><td><span class="status-pill ok">约 ${lifeYears >= 100 ? `${Math.round(lifeYears)} 年` : `${lifeYears.toFixed(1)} 年`}</span> (累计可写 ${(totalLifetimeWrites / 1e6).toFixed(1)}M 条记录)</td></tr>`;

      const payloadBytes = Math.max(1, recSize - 8);
      wlCodeOut.textContent =
        `#define LOG_SECTOR_COUNT      (${sectors}U)\n` +
        `#define LOG_SECTOR_HDR_SIZE   (${hdrSize}U)\n` +
        `#define LOG_RECORD_SIZE       (${recSize}U)\n` +
        `#define LOG_RECS_PER_SECTOR   (${recsPerSector}U) /* (4096 - ${hdrSize}) / ${recSize} */\n\n` +
        `typedef struct {\n` +
        `  uint8_t  stage_flag;              /* 0xFF:Free, 0xFE:Writing, 0xFC:Committed, 0x00:Tombstone */\n` +
        `  uint8_t  version;\n` +
        `  uint16_t crc16_modbus;            /* 覆盖 seq + payload */\n` +
        `  uint32_t seq_id;                  /* 单调递增世代序号 */\n` +
        `  uint8_t  payload[${payloadBytes}];             /* 业务负载 (${payloadBytes}B)，总长严格对齐 ${recSize}B */\n` +
        `} __attribute__((packed)) flash_record_t;`;
    }

    [wlSectorsInput, wlHdrInput, wlRecInput, wlWritesInput, wlEnduranceSel].forEach((el) =>
      el.addEventListener("input", updateWearLeveling)
    );

    updateFlashAndEeprom();
    updateWearLeveling();
  }

  // =========================================================================
  // 08. CAN / CAN-FD Bit-Timing Sample Point & I2C Pull-Up Calculator
  // =========================================================================
  function initBusTimingTool() {
    const canClkInput = $("#can-clk-mhz");
    const canBaudSel = $("#can-baud-kbps");
    const canSpInput = $("#can-sp-target");
    const canResultsBody = $("#can-results-body");
    const canCodeOut = $("#can-c-code");

    if (!canClkInput) return;

    function updateCanTiming() {
      const fCanMhz = Math.max(1, Number(canClkInput.value) || 36);
      const baudKbps = Number(canBaudSel.value) || 500;
      const targetSp = Math.min(95, Math.max(50, Number(canSpInput.value) || 87.5));

      const fCanHz = fCanMhz * 1e6;
      const targetBaud = baudKbps * 1000;
      const candidates = [];

      for (let tq = 8; tq <= 25; tq += 1) {
        const brp = Math.round(fCanHz / (targetBaud * tq));
        if (brp < 1 || brp > 1024) continue;
        const actualBaud = fCanHz / (brp * tq);
        const baudErrPct = ((actualBaud - targetBaud) / targetBaud) * 100;
        if (Math.abs(baudErrPct) > 1.5) continue;

        for (let ts1 = 1; ts1 <= 16; ts1 += 1) {
          const ts2 = tq - 1 - ts1;
          if (ts2 < 1 || ts2 > 8) continue;
          const sp = ((1 + ts1) / tq) * 100;
          const spDiff = Math.abs(sp - targetSp);
          const tqPenalty = Math.abs(tq - 16) * 0.08;
          const score = Math.abs(baudErrPct) * 50 + spDiff + tqPenalty;
          candidates.push({
            brp,
            tq,
            ts1,
            ts2,
            sjw: Math.min(4, ts2),
            sp,
            actualBaud,
            baudErrPct,
            score,
          });
        }
      }

      candidates.sort((a, b) => a.score - b.score);
      const top = candidates.slice(0, 4);

      if (!top.length) {
        canResultsBody.innerHTML = `<tr><td colspan="4">当前外设时钟 (${fCanMhz} MHz) 无法分频出误差 &lt;1.5% 的 ${baudKbps} kbps 波特率，请调整 APB1/CAN 时钟频率。</td></tr>`;
        canCodeOut.textContent = "/* 无可用分频解 */";
        return;
      }

      canResultsBody.innerHTML = top
        .map(
          (c, idx) => `<tr>
            <td>${idx === 0 ? "<strong>★ 推荐</strong> " : ""}<code>BRP = ${c.brp}</code> (${c.tq} Tq)</td>
            <td><code>TS1 = ${c.ts1}</code>, <code>TS2 = ${c.ts2}</code>, <code>SJW = ${c.sjw}</code></td>
            <td>采样点 <strong>${c.sp.toFixed(1)}%</strong></td>
            <td><span class="status-pill ${Math.abs(c.baudErrPct) < 0.05 ? "ok" : "warn"}">${Math.abs(c.baudErrPct) < 0.01 ? "0.00% (精确)" : `${c.baudErrPct >= 0 ? "+" : ""}${c.baudErrPct.toFixed(2)}%`}</span></td>
          </tr>`
        )
        .join("");

      const best = top[0];
      canCodeOut.textContent =
        `/* CAN Clock = ${fCanMhz} MHz, Target = ${baudKbps} kbps, Sample Point = ${best.sp.toFixed(1)}% (${best.tq} Tq) */\n` +
        `CAN_InitStructure.BaudRatePrescaler = ${best.brp};          /* BRP (寄存器值 = ${best.brp - 1}) */\n` +
        `CAN_InitStructure.BitSegment1       = CAN_BS1_${best.ts1}tq;  /* Prop_Seg + Phase_Seg1 = ${best.ts1} Tq */\n` +
        `CAN_InitStructure.BitSegment2       = CAN_BS2_${best.ts2}tq;  /* Phase_Seg2 = ${best.ts2} Tq */\n` +
        `CAN_InitStructure.SJW               = CAN_SJW_${best.sjw}tq;  /* Resync Jump Width */`;
    }

    [canClkInput, canBaudSel, canSpInput].forEach((el) => el.addEventListener("input", updateCanTiming));

    $$("[data-can-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [clk, baud, sp] = btn.getAttribute("data-can-preset").split(",");
        canClkInput.value = clk;
        canBaudSel.value = baud;
        canSpInput.value = sp;
        updateCanTiming();
      });
    });

    // I2C Pull-Up Resistor Calculator
    const i2cVddInput = $("#i2c-vdd");
    const i2cSpeedSel = $("#i2c-speed");
    const i2cCbusInput = $("#i2c-cbus");
    const i2cRpInput = $("#i2c-rp-sel");
    const i2cSummary = $("#i2c-summary");

    function updateI2c() {
      const vdd = Math.max(1.2, Number(i2cVddInput.value) || 3.3);
      const speedK = Number(i2cSpeedSel.value) || 400;
      const cbusPf = Math.max(5, Number(i2cCbusInput.value) || 100);
      const rpKohm = Math.max(0.1, Number(i2cRpInput.value) || 4.7);

      const volMax = vdd > 2.0 ? 0.4 : 0.2 * vdd;
      const iolMaxMa = speedK === 1000 ? 20.0 : 3.0;
      const trMaxNs = speedK === 100 ? 1000 : speedK === 400 ? 300 : 120;

      const rpMinK = (vdd - volMax) / iolMaxMa;
      const rpMaxK = trMaxNs / (0.8473 * cbusPf); // tr(ns) / (0.8473 * C(pF)) = kOhm
      const actualTrNs = 0.8473 * rpKohm * cbusPf;
      const iSinkMa = vdd / rpKohm;

      const trOk = actualTrNs <= trMaxNs;
      const iolOk = rpKohm >= rpMinK;

      i2cSummary.innerHTML =
        `<tr><th>允许上拉阻值区间 [Rp_min .. Rp_max]</th><td><strong>${rpMinK.toFixed(2)} kΩ ~ ${rpMaxK.toFixed(2)} kΩ</strong> (I_OL ≤ ${iolMaxMa}mA, t_r ≤ ${trMaxNs}ns)</td></tr>` +
        `<tr><th>当前 Rp=${rpKohm}kΩ 实际上升时间 t_r</th><td><strong>${actualTrNs.toFixed(1)} ns</strong> (0.3VDD → 0.7VDD) <span class="status-pill ${trOk ? "ok" : "err"}">${trOk ? `满足 ≤ ${trMaxNs}ns` : `超标！边沿过缓易丢 ACK`}</span></td></tr>` +
        `<tr><th>低电平灌电流与静态功耗</th><td>I_sink = <strong>${iSinkMa.toFixed(2)} mA</strong> (${(vdd * iSinkMa).toFixed(2)} mW/线) <span class="status-pill ${iolOk ? "ok" : "err"}">${iolOk ? "灌电流安全" : "阻值过小，VOL 将被抬高"}</span></td></tr>` +
        `<tr><th>工程推荐标准阻值</th><td><code>${speedK === 100 ? "4.7 kΩ" : speedK === 400 ? (cbusPf > 150 ? "1.8 kΩ ~ 2.2 kΩ" : "2.2 kΩ ~ 3.3 kΩ") : "1.0 kΩ ~ 1.5 kΩ"}</code></td></tr>`;
    }

    [i2cVddInput, i2cSpeedSel, i2cCbusInput, i2cRpInput].forEach((el) => el.addEventListener("input", updateI2c));

    updateCanTiming();
    updateI2c();
  }

  // =========================================================================
  // 09. Hardware RC / 1st-Order Digital IIR Filter & C99 LUT Generator
  // =========================================================================
  function initDspLutTool() {
    const rcRInput = $("#rc-r");
    const rcCInput = $("#rc-c");
    const iirFsInput = $("#iir-fs");
    const iirFcInput = $("#iir-fc");
    const dspSummary = $("#dsp-summary");
    const iirCodeOut = $("#iir-c-code");

    if (!rcRInput) return;

    function updateDspFilter() {
      const rKohm = Math.max(0.001, Number(rcRInput.value) || 10);
      const cNf = Math.max(0.001, Number(rcCInput.value) || 100);
      const fs = Math.max(1, Number(iirFsInput.value) || 1000);
      const fcIir = Math.min(fs * 0.49, Math.max(0.01, Number(iirFcInput.value) || 15));

      const tauUs = rKohm * cNf; // kOhm * nF = us
      const tauMs = tauUs / 1000;
      const fcRc = 1e6 / (2 * Math.PI * tauUs);
      const t90Ms = 2.3026 * tauMs;
      const t99Ms = 4.6052 * tauMs;

      const dt = 1 / fs;
      const rcDigital = 1 / (2 * Math.PI * fcIir);
      const alpha = dt / (rcDigital + dt);
      const alphaQ15 = Math.min(32767, Math.max(1, Math.round(alpha * 32768)));
      const shiftK = Math.max(1, Math.min(12, Math.round(-Math.log2(alpha))));
      const shiftFc = (fs / (2 * Math.PI)) * (1 / ((1 << shiftK) - 1));

      dspSummary.innerHTML =
        `<tr><th>硬件 RC 截止频率 (-3dB)</th><td><strong>${fcRc >= 1000 ? `${(fcRc / 1000).toFixed(2)} kHz` : `${fcRc.toFixed(2)} Hz`}</strong> (时间常数 τ = ${tauMs >= 1 ? `${tauMs.toFixed(2)} ms` : `${tauUs.toFixed(1)} μs`})</td></tr>` +
        `<tr><th>RC 阶跃响应稳定时间</th><td>90% 稳定: <strong>${t90Ms.toFixed(2)} ms</strong> · 99% 稳定 (≈5τ): <strong>${t99Ms.toFixed(2)} ms</strong></td></tr>` +
        `<tr><th>数字 IIR 系数 α (fs=${fs}Hz, fc=${fcIir}Hz)</th><td><code>α = ${alpha.toFixed(5)}</code> → 定点 <code>ALPHA_Q15 = ${alphaQ15}</code> (0x${toHex(alphaQ15, 4)})</td></tr>` +
        `<tr><th>免乘法移位近似 (1/2^${shiftK})</th><td><code>y += (x - y) &gt;&gt; ${shiftK}</code> (等效截止频率 ≈ ${shiftFc.toFixed(2)} Hz)</td></tr>`;

      iirCodeOut.textContent =
        `/* 一阶低通 IIR: fs = ${fs} Hz, fc = ${fcIir} Hz, alpha = ${alpha.toFixed(5)} (Q15 = ${alphaQ15}) */\n` +
        `#define IIR_ALPHA_Q15  (${alphaQ15}L)\n\n` +
        `static inline int32_t iir_lowpass_q15(int32_t x, int32_t *state_q15)\n` +
        `{\n` +
        `  int32_t x_q15 = x << 8; /* 保留 8-bit 小数余量防截断死区 */\n` +
        `  *state_q15 += (int32_t)(((int64_t)(x_q15 - *state_q15) * IIR_ALPHA_Q15) >> 15);\n` +
        `  return (*state_q15 + 128) >> 8;\n` +
        `}`;
    }

    [rcRInput, rcCInput, iirFsInput, iirFcInput].forEach((el) => el.addEventListener("input", updateDspFilter));

    // C99 Waveform / Gamma LUT Generator
    const lutTypeSel = $("#lut-type");
    const lutLenSel = $("#lut-len");
    const lutMaxInput = $("#lut-max");
    const lutPreviewBars = $("#lut-preview-bars");
    const lutOut = $("#lut-c-output");

    function updateLut() {
      const type = lutTypeSel.value;
      const n = Number(lutLenSel.value) || 32;
      const maxVal = Math.min(65535, Math.max(1, Number(lutMaxInput.value) || 999));

      const values = [];
      for (let i = 0; i < n; i += 1) {
        let norm = 0;
        if (type === "gamma22") {
          norm = Math.pow(i / Math.max(1, n - 1), 2.2);
        } else if (type === "sine") {
          norm = 0.5 * (1 + Math.sin((2 * Math.PI * i) / n));
        } else if (type === "halfsine") {
          norm = Math.sin((Math.PI * i) / Math.max(1, n - 1));
        } else if (type === "triangle") {
          const phase = i / n;
          norm = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
        } else if (type === "breathing") {
          norm = (Math.exp(Math.sin((2 * Math.PI * i) / n)) - 1 / Math.E) / (Math.E - 1 / Math.E);
        }
        values.push(Math.round(norm * maxVal));
      }

      const previewStep = Math.max(1, Math.floor(n / 32));
      const sampled = [];
      for (let i = 0; i < n; i += previewStep) sampled.push(values[i]);

      lutPreviewBars.innerHTML = sampled
        .map((v) => {
          const hPct = Math.max(6, Math.round((v / maxVal) * 100));
          return `<span class="lut-bar" style="height:${hPct}%" title="${v}"></span>`;
        })
        .join("");

      const cType = maxVal <= 255 ? "uint8_t" : "uint16_t";
      const rows = [];
      for (let i = 0; i < values.length; i += 8) {
        rows.push("  " + values.slice(i, i + 8).map((v) => String(v).padStart(4, " ")).join(", "));
      }

      lutOut.value =
        `/* ${lutTypeSel.options[lutTypeSel.selectedIndex].text}, N=${n}, Max=${maxVal} */\n` +
        `const ${cType} g_${type}_lut[${n}] = {\n${rows.join(",\n")}\n};`;
    }

    [lutTypeSel, lutLenSel, lutMaxInput].forEach((el) => el.addEventListener("input", updateLut));

    updateDspFilter();
    updateLut();
  }

  // =========================================================================
  // 10. Cortex-M Exception Stack Frame & Keil / GCC Memory Analyzer
  // =========================================================================
  function initStackMapTool() {
    const stkDumpInput = $("#stk-dump");
    const stkExcInput = $("#stk-exc-return");
    const stkSpInput = $("#stk-sp-addr");
    const stkSummary = $("#stk-summary");

    if (!stkDumpInput) return;

    const STK_PRESETS = {
      thread_msp: {
        dump: "0x00000000 0x20000418 0x00000001 0x40013800 0x00000000 0x08003A15 0x08003B42 0x61000000",
        exc: "0xFFFFFFF9",
        sp: "0x20003F80",
      },
      rtos_psp: {
        dump: "0x200018A0 0x00000000 0x00000010 0x08009120 0x00000004 0x08004C2B 0x08004C58 0x21000000",
        exc: "0xFFFFFFED",
        sp: "0x20001740",
      },
      isr_nest: {
        dump: "0x40020000 0x00000002 0x20000100 0x00000000 0x08001234 0x08002109 0x08002180 0x6000001C",
        exc: "0xFFFFFFF1",
        sp: "0x20003EC0",
      },
    };

    function decodeStackFrame() {
      const tokens = stkDumpInput.value
        .replace(/[,;[\]{}()]/g, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean);

      const words = [];
      for (let i = 0; i < 8; i += 1) {
        const tok = tokens[i] || "0";
        const clean = tok.replace(/^0x/i, "");
        words.push(/^[0-9a-fA-F]{1,8}$/.test(clean) ? parseInt(clean, 16) >>> 0 : 0);
      }

      const [r0, r1, r2, r3, r12, lr, pc, xpsr] = words;
      const excRet = parseInt(stkExcInput.value.trim().replace(/^0x/i, "") || "FFFFFFF9", 16) >>> 0;
      const spBase = parseInt(stkSpInput.value.trim().replace(/^0x/i, "") || "20000000", 16) >>> 0;

      const thumbBit = (xpsr >>> 24) & 1;
      const isrNum = xpsr & 0x1ff;
      const lrAligned = (lr & ~1) >>> 0;

      let isrDesc = "Thread Mode (主循环或 RTOS 任务上下文)";
      if (isrNum === 3) isrDesc = "HardFault_Handler (#3)";
      else if (isrNum === 11) isrDesc = "SVCall_Handler (#11)";
      else if (isrNum === 14) isrDesc = "PendSV_Handler (#14)";
      else if (isrNum === 15) isrDesc = "SysTick_Handler (#15)";
      else if (isrNum >= 16) isrDesc = `外部外设中断 IRQ #${isrNum - 16} (Vector #${isrNum})`;

      const fpuExtended = ((excRet >>> 4) & 1) === 0;
      const isThreadMode = ((excRet >>> 3) & 1) === 1;
      const usePsp = ((excRet >>> 2) & 1) === 1;
      const frameBytes = fpuExtended ? 104 : 32;
      const origSp = (spBase + frameBytes) >>> 0;

      stkSummary.innerHTML =
        `<tr><th>故障指令地址 PC (+0x18)</th><td><strong><code>0x${toHex(pc, 8)}</code></strong> <span class="status-pill ${pc >= 0x08000000 && pc < 0x08200000 ? "ok" : "err"}">${pc >= 0x08000000 && pc < 0x08200000 ? "位于 Flash 代码区" : "非法 PC 地址 (疑似野函数指针/毁栈)"}</span></td></tr>` +
        `<tr><th>调用者返回地址 LR (+0x14)</th><td><code>0x${toHex(lr, 8)}</code> → 反汇编定位地址: <strong><code>0x${toHex(lrAligned, 8)}</code></strong> (调用指令位于其前 2~4 字节)</td></tr>` +
        `<tr><th>xPSR 状态 (+0x1C)</th><td><code>0x${toHex(xpsr, 8)}</code> · Thumb 位 T=${thumbBit} ${thumbBit ? '<span class="status-pill ok">正常 (T=1)</span>' : '<span class="status-pill err">T=0 触发 INVSTATE!</span>'} · ${isrDesc}</td></tr>` +
        `<tr><th>EXC_RETURN (<code>0x${toHex(excRet, 8)}</code>)</th><td>异常发生于 <strong>${isThreadMode ? "Thread 线程模式" : "Handler 中断嵌套模式"}</strong> · 使用 <strong>${usePsp ? "PSP (进程栈)" : "MSP (主栈)"}</strong> · ${fpuExtended ? "含 FPU 扩展栈帧 (104B)" : "标准 8 字基础栈帧 (32B)"} · 压栈前 SP = <code>0x${toHex(origSp, 8)}</code></td></tr>` +
        `<tr><th>R0..R3, R12 现场</th><td><code>R0=0x${toHex(r0, 8)}</code>, <code>R1=0x${toHex(r1, 8)}</code>, <code>R2=0x${toHex(r2, 8)}</code>, <code>R3=0x${toHex(r3, 8)}</code>, <code>R12=0x${toHex(r12, 8)}</code></td></tr>` +
        `<tr><th>一键 addr2line 定位命令</th><td><code>arm-none-eabi-addr2line -e build/firmware.elf -f -C 0x${toHex(pc, 8)} 0x${toHex(lrAligned, 8)}</code></td></tr>`;
    }

    [stkDumpInput, stkExcInput, stkSpInput].forEach((el) => el.addEventListener("input", decodeStackFrame));

    $$("[data-stk-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = STK_PRESETS[btn.getAttribute("data-stk-preset")];
        if (!p) return;
        stkDumpInput.value = p.dump;
        stkExcInput.value = p.exc;
        stkSpInput.value = p.sp;
        decodeStackFrame();
      });
    });

    // Keil MDK / GCC Memory Analyzer
    const memPasteInput = $("#mem-paste");
    const memCodeInput = $("#mem-code");
    const memRoInput = $("#mem-ro");
    const memRwInput = $("#mem-rw");
    const memZiInput = $("#mem-zi");
    const memChipSel = $("#mem-chip");
    const memBars = $("#mem-bars");
    const memSummary = $("#mem-summary");

    function updateMemoryMap() {
      const code = Math.max(0, Number(memCodeInput.value) || 0);
      const ro = Math.max(0, Number(memRoInput.value) || 0);
      const rw = Math.max(0, Number(memRwInput.value) || 0);
      const zi = Math.max(0, Number(memZiInput.value) || 0);
      const [flashKb, ramKb] = memChipSel.value.split(",").map(Number);

      const flashTotal = flashKb * 1024;
      const ramTotal = ramKb * 1024;

      const flashUsed = code + ro + rw;
      const ramUsed = rw + zi;
      const flashFree = flashTotal - flashUsed;
      const ramFree = ramTotal - ramUsed;

      const flashPct = (flashUsed / flashTotal) * 100;
      const ramPct = (ramUsed / ramTotal) * 100;

      memBars.innerHTML =
        `<div class="usage-bar-item"><div class="usage-bar-head"><span>Flash 占用: ${(flashUsed / 1024).toFixed(2)} KB / ${flashKb} KB (Code + RO + RW)</span><strong>${flashPct.toFixed(1)}%</strong></div><div class="usage-bar-track"><div class="usage-bar-fill ${flashPct > 90 ? "err" : flashPct > 75 ? "warn" : "ok"}" style="width:${Math.min(100, flashPct).toFixed(1)}%"></div></div></div>` +
        `<div class="usage-bar-item"><div class="usage-bar-head"><span>SRAM 静态占用: ${(ramUsed / 1024).toFixed(2)} KB / ${ramKb} KB (RW + ZI)</span><strong>${ramPct.toFixed(1)}%</strong></div><div class="usage-bar-track"><div class="usage-bar-fill ${ramPct > 85 ? "err" : ramPct > 70 ? "warn" : "ok"}" style="width:${Math.min(100, ramPct).toFixed(1)}%"></div></div></div>`;

      memSummary.innerHTML =
        `<tr><th>Flash 烧录镜像体积</th><td><strong>${flashUsed.toLocaleString()} Bytes</strong> (${(flashUsed / 1024).toFixed(2)} KB · <code>0x${toHex(flashUsed, 6)}</code>)</td></tr>` +
        `<tr><th>Flash 剩余可用空间</th><td>${flashFree >= 0 ? `<strong>${(flashFree / 1024).toFixed(2)} KB</strong> (${flashFree.toLocaleString()} B)` : `<span class="status-pill err">超出 Flash 容量 ${(-flashFree).toLocaleString()} B!</span>`}</td></tr>` +
        `<tr><th>SRAM 静态占用 (含栈/堆段)</th><td><strong>${ramUsed.toLocaleString()} Bytes</strong> (${(ramUsed / 1024).toFixed(2)} KB · <code>0x${toHex(ramUsed, 5)}</code>)</td></tr>` +
        `<tr><th>SRAM 剩余未分配裕量</th><td>${ramFree >= 0 ? `<strong>${(ramFree / 1024).toFixed(2)} KB</strong> (${ramFree.toLocaleString()} B)` : `<span class="status-pill err">超出 SRAM 容量 ${(-ramFree).toLocaleString()} B!</span>`}</td></tr>`;
    }

    memPasteInput.addEventListener("input", () => {
      const s = memPasteInput.value;
      const mCode = s.match(/Code\s*=\s*(\d+)/i);
      const mRo = s.match(/RO-data\s*=\s*(\d+)/i);
      const mRw = s.match(/RW-data\s*=\s*(\d+)/i);
      const mZi = s.match(/ZI-data\s*=\s*(\d+)/i);
      if (mCode) memCodeInput.value = mCode[1];
      if (mRo) memRoInput.value = mRo[1];
      if (mRw) memRwInput.value = mRw[1];
      if (mZi) memZiInput.value = mZi[1];
      updateMemoryMap();
    });

    [memCodeInput, memRoInput, memRwInput, memZiInput, memChipSel].forEach((el) =>
      el.addEventListener("input", updateMemoryMap)
    );

    decodeStackFrame();
    updateMemoryMap();
  }

  initToolTabs();
  initRadixTool();
  initCrcModbusTool();
  initRegisterFaultTool();
  initAdcTimerTool();
  initDisplayFontTool();
  initAnalogPowerTool();
  initStorageLayoutTool();
  initBusTimingTool();
  initDspLutTool();
  initStackMapTool();
})();
