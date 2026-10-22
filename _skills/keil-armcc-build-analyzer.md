---
layout: skill
title: Keil MDK 命令行构建与 .map 资源审计 (keil-armcc-build-analyzer)
skill_id: keil-armcc-build-analyzer
description: 从命令行构建 Keil 工程，解析警告和 .map 文件，对比修改前后的 Flash 与 RAM 占用。
category: common
category_label: 通用与工程基建
scope: global
target: Keil MDK-ARM (UV4.exe / ARMCC 5 / ARMClang 6)
order: 2
tags:
  - Keil
  - ARMCC5
  - Map分析
  - 内存审计
---

## SKILL.md 元数据

```yaml
---
name: keil-armcc-build-analyzer
description: >-
  [Scope: global] Keil MDK-ARM (ARMCC 5 / ARMClang 6) 命令行无头构建、.build_log.htm 警告分类审查与 .map 内存占用（Code/RO/RW/ZI 及栈水位）自动对比分析。
  当用户需要编译 .uvprojx 工程、排查 ARMCC 5 编译/链接警告（如 UTF-8/GBK 编码告警、C89/C99 混用）、或审计每次代码修改前后的 Flash/RAM 字节增量时使用此技能。
---
```

## 1. 适用范围

- **技术方向**：`common`
- **使用范围 (Scope)**：`global`（适用于所有使用 Keil MDK-ARM `.uvprojx` / `.uvproj` 的 MCU 工程）
- **适用工具链**：Keil μVision (`UV4.exe`)，ARM Compiler 5 (`armcc` V5.06) 与 ARM Compiler 6 (`armclang`)。

## 2. 设计要求

1. **绝不盲目宣称“编译通过”或“零警告”**：
   - `UV4.exe -b` 或 `-r` 的进程退出码（Exit Code）：`0` 表示 0 Error / 0 Warning，`1` 表示仅存在 Warning（无 Error），`>= 2` 表示存在 Error。
   - **警告处理**：退出码为 `1` 时虽然生成了 `.axf/.hex`，但必须逐行解析 `.build_log.htm` 区分**本次新增警告**与**历史遗留警告**（如历史 GBK/UTF-8 特殊字符警告），严禁新增任何警告，也严禁在存在历史警告时笼统汇报“零警告”。
2. **强制量化每次改动的 Flash / RAM 增量 (`Code / RO / RW / ZI`)**：
   - 在嵌入式裸机工程中新增缓冲、字库、状态表后，必须从 `.build_log.htm` 或 `.map` 提取四项核心指标并计算增量（Δ）：
     - **Flash 占用** = `Code + RO-data + RW-data`
     - **SRAM 静态占用** = `RW-data + ZI-data`
3. **保护 `.uvprojx` 与编译器基线**：
   - 未经用户明确授权，绝不将 ARMCC 5 (V5.06) 工程切换为 ARMClang 6，不修改优化等级（如 `-O1`）、芯片 Pack 版本或分散加载文件（`.sct`）。

> 可直接运行的构建日志与 `.map` 对比脚本见 [scripts/analyze_keil_build.ps1](#script-ps1)（Windows 免依赖首选）与 [scripts/analyze_keil_build.py](#script-py)；ARMCC 5 高频警告修复与 `.map` 符号审计指南见 [references/armcc5-common-warnings-and-map.md](#ref-armcc5-map)。

## 3. 操作步骤

1. **修改前采集基线（Baseline Snapshot）**：
   - 修改代码前先运行分析脚本读取现有 `Objects/*.build_log.htm` 与 `Listings/*.map`（或 `Objects/*.map`），保存基线 JSON：
     ```powershell
     powershell -NoProfile -ExecutionPolicy Bypass -File "<skill-dir>/scripts/analyze_keil_build.ps1" -LogPath "N32G455/MDK-ARM/Objects/N32G455.build_log.htm" -SaveBaseline "baseline.json"
     ```
2. **执行 Keil 命令行无头构建（Headless Build）**：
   - 优先增量构建 `-b`（修改头文件或编译宏时使用全量重构 `-r`），指定 `-t <TargetName>` 与 `-j0 -o build_cmd.log`：
     ```powershell
     & "C:\Keil_v5\UV4\UV4.exe" -b "N32G455\MDK-ARM\N32G455.uvprojx" -t "N32G455" -j0 -o "build_output.log"
     ```
   - 若当前环境未安装 `UV4.exe`，必须明确向用户报告“当前环境无法运行 Keil 构建，仅完成静态检查”，绝不伪造编译结果。
3. **解析构建日志与对比资源增量**：
   - 运行 `scripts/analyze_keil_build.ps1` 对比修改前后的 `Code / RO-data / RW-data / ZI-data` 及警告列表：
     ```powershell
     powershell -NoProfile -ExecutionPolicy Bypass -File "<skill-dir>/scripts/analyze_keil_build.ps1" -LogPath "N32G455/MDK-ARM/Objects/N32G455.build_log.htm" -MapPath "N32G455/MDK-ARM/Listings/N32G455.map" -CompareBaseline "baseline.json"
     ```
4. **清理构建副产物（Git 保护）**：
   - 确认 `Objects/`、`Listings/`、`*.build_log.htm`、`*.dep`、`*.uvguix.*` 均未被 `git add` 暂存。

## 4. 关键安全与工具链检查清单

- [ ] **只读常量进 Flash (`RO-data`)**：新增字库、状态转移表、菜单配置表、CRC 查表必须加 `const`，并在 `.map` 中核对已落入 `RO-data` 而非 `RW-data`。
- [ ] **UTF-8 无 BOM 与 ARMCC 5 中文字符串**：ARMCC 5 在未加 `--locale=english` 或多字节字符跨界时易触发 `#870-D: invalid multibyte character sequence`；对 UI 字面量优先使用 `\xHH` 十六进制 UTF-8 转义或统一通过 `app_i18n` 字典表管理。
- [ ] **栈空间 (`STACK`) 与堆 (`HEAP`) 检查**：在 `.map` 中检查 `STACK` 段的基址与大小，确保 `ZI-data` 增长后不会挤压栈空间，且裸机工程 `HEAP` 设为 `0`（禁用 `malloc`）。

## 5. 验证与交付汇报模板 (Verification Report)

每次交付代码时，按以下标准格式输出构建与资源证据：

- **编译器版本**：`ARMCC V5.06 update 6 (build 750)`
- **编译结果**：`0 Error(s), 0 New Warning(s)`（如有历史警告，注明具体 `文件:行号` 与原因）
- **资源占用与增量**：
  - `Code`: `127,928 B (+1,796 B)`
  - `RO-data`: `34,272 B (+968 B)`
  - `RW-data`: `304 B (+0 B)`
  - `ZI-data`: `28,776 B (+16 B)`
  - **总 Flash**: `162,504 B` | **总静态 RAM**: `29,080 B`

<h2 id="ref-armcc5-map">参考文档：ARMCC 5 高频警告排查与 .map 检查指南 (references/armcc5-common-warnings-and-map.md)</h2>

### 1. ARMCC V5.06 高频编译警告与标准修复法

| 警告编号与信息 | 触发原因 | 规范修复方式（零副作用） |
| :--- | :--- | :--- |
| `#870-D: invalid multibyte character sequence` | 源码为 UTF-8（无 BOM）且注释或字符串中含有多字节中文字符（如 `≈`、繁体字或奇数半角/全角边界），被 ARMCC 5 按系统默认 ANSI/GBK 代码页解析 | 1. C 字符串字面量改用十六进制字节转义（如 `"\xE5\xAD\x98\xE5\x82\xA8"`）；<br>2. 注释中避免生僻符号（如将 `≈` 改为 `~` 或 `约`）；<br>3. 未经授权不要批量把文件转码为 GBK。 |
| `#177-D: variable "xxx" was declared but never referenced` / `function was declared but never referenced` | 条件编译宏（如 `APP_RECORD_STORE_VALIDATION_ENABLE == 0`）关闭后，局部静态辅助函数或变量未参与调用 | 将仅在验证宏开启时使用的 `static` 函数放入同一 `#if ... #endif` 块内，或对未使用的接口形参显式写 `(void)param;`。 |
| `#188-D: enumerated type mixed with another type` | 将 `uint8_t` 整数直接赋值给枚举类型变量，或不同枚举间隐式混用 | 先校验 `uint8_t` 范围合法，再使用显式类型转换 `(MyEnumType)rawVal`。 |
| `#68-D: integer conversion resulted in a change of sign` | 无符号宏常量与有符号整数混算或将 `-1` 赋给无符号类型 | 明确无符号常量后缀 `U` / `UL`，有符号与无符号比较前先做范围确认与显式转换。 |
| `#223-D: function "xxx" declared implicitly` | 调用了未包含头文件的函数（C99 下极易导致返回值截断或入参压栈错误） | 必须在对应模块 `.h` 中声明公共原型并 `#include`，严禁在 `.c` 内部手写外部 `extern` 声明。 |

### 2. Keil `.map` 文件的四大关键审查段落

打开 `Listings/<Target>.map`（或 `Objects/<Target>.map`），按顺序核查以下 4 个核心区域：

1. **`Section Cross References`（模块交叉引用表）**：
   - 检查是否违反 `APP -> DRV` 单向依赖原则（若发现 `drv_xxx.o` 引用了 `app_xxx.o` 的符号，说明驱动层反向耦合了业务层）。
2. **`Removing Unused input sections from the image`（死代码消除表）**：
   - 确认开启 `--split_sections` 后未使用的库函数已被 Linker 裁剪；若新增的业务函数意外出现在此列表，说明漏接了主循环或表驱动入口。
3. **`Memory Map of the image`（内存地址排布表）**：
   - **`ER_IROM1 (0x08000000)`**：确认固件末尾地址未侵入片内 Flash 尾部参数扇区（如双槽 EEPROM 替代方案的尾页）或 Bootloader 区。
   - **`RW_IRAM1 (0x20000000)`**：
     - 定位最大的几个 `ZERO` (ZI) 段（如 `s_stripBuffer`、传感器环形队列、页缓存）；
     - 定位 `STACK` 段起始地址与顶地址（Cortex-M 满递减栈从 `STACK` 顶部向下生长），确认栈大小（如 `0x00001000 = 4 KiB`）充足。
4. **`Image Component Sizes`（组件体积汇总表）**：
   - 逐个 `.o` 目标文件列出 `Code | RO Data | RW Data | ZI Data`，快速抓出哪一个模块吃掉了最多的 SRAM 或 Flash。

<h2 id="script-ps1">配套脚本：analyze_keil_build.ps1 (PowerShell 免依赖版)</h2>

```powershell
# analyze_keil_build.ps1
# Zero-dependency PowerShell script to parse Keil MDK (.build_log.htm) and .map files.
param(
    [Parameter(Mandatory = $true)]
    [string]$LogPath,
    [string]$MapPath = "",
    [string]$SaveBaseline = "",
    [string]$CompareBaseline = "",
    [int]$Top = 8
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $LogPath)) {
    Write-Error "Build log not found: $LogPath"
    exit 2
}

$raw = Get-Content -Path $LogPath -Raw -Encoding UTF8
$clean = $raw -replace '<[^>]+>', ''
$clean = [System.Net.WebUtility]::HtmlDecode($clean)
$lines = $clean -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }

$compiler = "Unknown"
$errors = $null
$warnings = $null
$size = $null
$diagnostics = @()

foreach ($line in $lines) {
    if ($line -match 'V5\.06|ARMClang|ArmCC') {
        $compiler = $line
    }
    if ($line -match 'Program Size:\s*Code=(\d+)\s+RO-data=(\d+)\s+RW-data=(\d+)\s+ZI-data=(\d+)') {
        $code = [int]$Matches[1]
        $ro   = [int]$Matches[2]
        $rw   = [int]$Matches[3]
        $zi   = [int]$Matches[4]
        $size = [ordered]@{
            code        = $code
            ro_data     = $ro
            rw_data     = $rw
            zi_data     = $zi
            total_flash = $code + $ro + $rw
            total_ram   = $rw + $zi
        }
    }
    if ($line -match '"[^"]+"\s*-\s*(\d+)\s*Error\(s\),\s*(\d+)\s*Warning\(s\)\.') {
        $errors   = [int]$Matches[1]
        $warnings = [int]$Matches[2]
    }
    if ($line -match '^(.+?)\((\d+)\):\s*(warning|error):\s*(#[0-9A-Za-z-]+:.*)') {
        $diagnostics += [PSCustomObject]@{
            file     = $Matches[1]
            line     = [int]$Matches[2]
            severity = $Matches[3].ToUpper()
            message  = $Matches[4]
        }
    }
}

$result = [ordered]@{
    log_path    = (Resolve-Path $LogPath).Path
    compiler    = $compiler
    errors      = $errors
    warnings    = $warnings
    size        = $size
    diagnostics = $diagnostics
}

if ($SaveBaseline -ne "") {
    $result | ConvertTo-Json -Depth 5 | Set-Content -Path $SaveBaseline -Encoding UTF8
    Write-Host "Saved baseline to $SaveBaseline" -ForegroundColor Cyan
}

$baseSize = $null
if ($CompareBaseline -ne "" -and (Test-Path $CompareBaseline)) {
    $baseObj = Get-Content -Path $CompareBaseline -Raw -Encoding UTF8 | ConvertFrom-Json
    $baseSize = $baseObj.size
}

function Format-Delta([int]$curr, $baseVal) {
    if ($null -eq $baseVal) { return ("{0:N0} B" -f $curr) }
    $diff = $curr - [int]$baseVal
    $sign = if ($diff -ge 0) { "+" } else { "" }
    return ("{0:N0} B ({1}{2:N0} B)" -f $curr, $sign, $diff)
}

Write-Host "=== Keil MDK Build Summary ===" -ForegroundColor Green
Write-Host ("Compiler : {0}" -f $compiler)
Write-Host ("Result   : {0} Error(s), {1} Warning(s)" -f $errors, $warnings)

if ($null -ne $size) {
    Write-Host "`n=== Memory Footprint (Program Size) ===" -ForegroundColor Green
    Write-Host ("  Code        : {0}" -f (Format-Delta $size.code ($baseSize.code)))
    Write-Host ("  RO-data     : {0}" -f (Format-Delta $size.ro_data ($baseSize.ro_data)))
    Write-Host ("  RW-data     : {0}" -f (Format-Delta $size.rw_data ($baseSize.rw_data)))
    Write-Host ("  ZI-data     : {0}" -f (Format-Delta $size.zi_data ($baseSize.zi_data)))
    Write-Host ("  Total Flash : {0}" -f (Format-Delta $size.total_flash ($baseSize.total_flash)))
    Write-Host ("  Total RAM   : {0}" -f (Format-Delta $size.total_ram ($baseSize.total_ram)))
}

if ($diagnostics.Count -gt 0) {
    Write-Host ("`n=== Diagnostics ({0}) ===" -f $diagnostics.Count) -ForegroundColor Yellow
    foreach ($d in $diagnostics) {
        Write-Host ("  [{0}] {1}:{2} -> {3}" -f $d.severity, $d.file, $d.line, $d.message)
    }
}

if ($MapPath -ne "" -and (Test-Path $MapPath)) {
    $ramSyms = @()
    Get-Content -Path $MapPath -Encoding UTF8 | ForEach-Object {
        if ($_ -match '^\s*(0x[0-9a-fA-F]{8})\s+(0x[0-9a-fA-F]{8})\s+(Code|Data|Zero)\s+(RO|RW)\s+\d+\s+(\S+)\s+(\S+)') {
            $szBytes = [Convert]::ToInt32($Matches[2], 16)
            if ($szBytes -gt 0 -and $Matches[4] -eq "RW") {
                $ramSyms += [PSCustomObject]@{
                    Size    = $szBytes
                    Type    = "$($Matches[3])/$($Matches[4])"
                    Section = $Matches[5]
                    Object  = $Matches[6]
                }
            }
        }
    }
    $topRam = $ramSyms | Sort-Object -Property Size -Descending | Select-Object -First $Top
    if ($topRam.Count -gt 0) {
        Write-Host ("`n=== Top {0} RAM (RW/ZI) Sections in .map ===" -f $Top) -ForegroundColor Green
        foreach ($s in $topRam) {
            Write-Host ("  {0,8:N0} B | {1,-7} | {2} ({3})" -f $s.Size, $s.Type, $s.Section, $s.Object)
        }
    }
}
```

<h2 id="script-py">配套脚本：analyze_keil_build.py (Python 跨平台版)</h2>

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
analyze_keil_build.py
Parse Keil MDK (.build_log.htm / build log) and .map file to extract:
1. Compiler version, Error count, Warning count & detailed warning list
2. Program Size (Code, RO-data, RW-data, ZI-data) and Flash/RAM totals
3. Delta comparison against a saved baseline JSON
4. Top largest RAM (ZI/RW) and Flash (Code/RO) symbols from the .map file
"""

import argparse
import html
import json
import os
import re
import sys
from typing import Dict, List, Optional, Any

RE_COMPILER = re.compile(r"Toolchain:\s*(.+)|Compiler:\s*(.+)|ARMCC\s+V[\d.]+.*")
RE_PROG_SIZE = re.compile(
    r"Program Size:\s*Code=(\d+)\s+RO-data=(\d+)\s+RW-data=(\d+)\s+ZI-data=(\d+)"
)
RE_SUMMARY = re.compile(r'"[^"]+"\s*-\s*(\d+)\s*Error\(s\),\s*(\d+)\s*Warning\(s\)\.')
RE_DIAG_LINE = re.compile(
    r"^(.+?)\((\d+)\):\s*(warning|error):\s*(#[0-9A-Za-z-]+:.*)", re.IGNORECASE
)
RE_MAP_SYM = re.compile(
    r"^\s*(0x[0-9a-fA-F]{8})\s+(0x[0-9a-fA-F]{8})\s+(Code|Data|Zero)\s+(RO|RW)\s+\d+\s+(\S+)\s+(\S+)"
)


def strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", "", text)
    return html.unescape(text)


def parse_build_log(log_path: str) -> Dict[str, Any]:
    with open(log_path, "r", encoding="utf-8", errors="replace") as f:
        raw = f.read()

    clean = strip_html(raw) if log_path.lower().endswith((".htm", ".html")) else raw
    lines = [line.strip() for line in clean.splitlines() if line.strip()]

    result: Dict[str, Any] = {
        "log_path": os.path.abspath(log_path),
        "compiler": "Unknown",
        "errors": None,
        "warnings": None,
        "size": None,
        "diagnostics": [],
    }

    for line in lines:
        if "V5.06" in line or "ARMClang" in line or "ArmCC" in line:
            result["compiler"] = line
        m_size = RE_PROG_SIZE.search(line)
        if m_size:
            code, ro, rw, zi = map(int, m_size.groups())
            result["size"] = {
                "code": code,
                "ro_data": ro,
                "rw_data": rw,
                "zi_data": zi,
                "total_flash": code + ro + rw,
                "total_ram": rw + zi,
            }
        m_sum = RE_SUMMARY.search(line)
        if m_sum:
            result["errors"] = int(m_sum.group(1))
            result["warnings"] = int(m_sum.group(2))

        m_diag = RE_DIAG_LINE.match(line)
        if m_diag:
            result["diagnostics"].append(
                {
                    "file": m_diag.group(1),
                    "line": int(m_diag.group(2)),
                    "severity": m_diag.group(3).lower(),
                    "message": m_diag.group(4),
                }
            )

    return result


def parse_top_map_symbols(map_path: str, top_n: int = 10) -> Dict[str, List[Dict[str, Any]]]:
    ram_syms: List[Dict[str, Any]] = []
    flash_syms: List[Dict[str, Any]] = []

    if not map_path or not os.path.isfile(map_path):
        return {"top_ram": [], "top_flash": []}

    with open(map_path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            m = RE_MAP_SYM.match(line)
            if not m:
                continue
            addr, size_hex, kind, attr, section, obj = m.groups()
            size_bytes = int(size_hex, 16)
            if size_bytes == 0:
                continue
            entry = {
                "addr": addr,
                "size": size_bytes,
                "type": f"{kind}/{attr}",
                "section": section,
                "object": obj,
            }
            if attr == "RW":
                ram_syms.append(entry)
            else:
                flash_syms.append(entry)

    ram_syms.sort(key=lambda x: x["size"], reverse=True)
    flash_syms.sort(key=lambda x: x["size"], reverse=True)
    return {"top_ram": ram_syms[:top_n], "top_flash": flash_syms[:top_n]}


def fmt_delta(curr: int, base: Optional[int]) -> str:
    if base is None:
        return f"{curr:,} B"
    diff = curr - base
    sign = "+" if diff >= 0 else ""
    return f"{curr:,} B ({sign}{diff:,} B)"


def main() -> int:
    parser = argparse.ArgumentParser(description="Analyze Keil MDK build log and map file.")
    parser.add_argument("--log", required=True, help="Path to .build_log.htm or build output log")
    parser.add_argument("--map", default="", help="Optional path to .map file")
    parser.add_argument("--save-baseline", default="", help="Save parsed metrics to JSON file")
    parser.add_argument("--compare-baseline", default="", help="Compare against saved baseline JSON")
    parser.add_argument("--top", type=int, default=8, help="Number of top symbols from .map")
    args = parser.parse_args()

    if not os.path.isfile(args.log):
        print(f"ERROR: Build log not found: {args.log}", file=sys.stderr)
        return 2

    data = parse_build_log(args.log)

    if args.save_baseline:
        with open(args.save_baseline, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"Saved baseline to {args.save_baseline}")

    base_size = None
    if args.compare_baseline and os.path.isfile(args.compare_baseline):
        with open(args.compare_baseline, "r", encoding="utf-8") as f:
            base_data = json.load(f)
            base_size = base_data.get("size")

    print("=== Keil MDK Build Summary ===")
    print(f"Compiler : {data['compiler']}")
    print(f"Result   : {data['errors']} Error(s), {data['warnings']} Warning(s)")

    sz = data.get("size")
    if sz:
        print("\n=== Memory Footprint (Program Size) ===")
        print(f"  Code        : {fmt_delta(sz['code'], base_size['code'] if base_size else None)}")
        print(f"  RO-data     : {fmt_delta(sz['ro_data'], base_size['ro_data'] if base_size else None)}")
        print(f"  RW-data     : {fmt_delta(sz['rw_data'], base_size['rw_data'] if base_size else None)}")
        print(f"  ZI-data     : {fmt_delta(sz['zi_data'], base_size['zi_data'] if base_size else None)}")
        print(f"  Total Flash : {fmt_delta(sz['total_flash'], base_size['total_flash'] if base_size else None)}")
        print(f"  Total RAM   : {fmt_delta(sz['total_ram'], base_size['total_ram'] if base_size else None)}")

    if data["diagnostics"]:
        print(f"\n=== Diagnostics ({len(data['diagnostics'])}) ===")
        for d in data["diagnostics"]:
            print(f"  [{d['severity'].upper()}] {d['file']}:{d['line']} -> {d['message']}")

    if args.map:
        top_syms = parse_top_map_symbols(args.map, args.top)
        if top_syms["top_ram"]:
            print(f"\n=== Top {args.top} RAM (RW/ZI) Sections in .map ===")
            for s in top_syms["top_ram"]:
                print(f"  {s['size']:>8,} B | {s['type']:<7} | {s['section']} ({s['object']})")

    return 0 if (data["errors"] == 0) else 1


if __name__ == "__main__":
    sys.exit(main())
```
