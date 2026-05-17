---
layout: article
title: ECAT 移植及基础
description: EtherCAT 从站协议栈移植、硬件适配、动态 PDO、Slot/Module 和状态机相关学习笔记。
date: 2026-05-18
category: 嵌入式
tags:
  - EtherCAT
  - STM32
  - LAN9252
  - 协议栈移植
---

## 从站
#### 协议栈移植
##### 参考链接
1. [基于STM32F407-LAN9252的EtherCAT从站协议移植过程-CSDN博客](https://blog.csdn.net/qq_41580996/article/details/130291788)
2. [【亲测免费】 STM32F407与LAN9252 Ethercat HBI资源文件介绍-CSDN博客](https://blog.csdn.net/gitblog_09761/article/details/143404001)
3. [EtherCAT之TwinCAT3安装、使用_twincat3安装教程-CSDN博客](https://blog.csdn.net/LclLsh/article/details/122863502)
4. [【STM32+LAN9252+HAL库】EtherCAT从站搭建 保姆级教程_stm32 ethercat-CSDN博客](https://blog.csdn.net/a1547998353/article/details/146331849)
5. [从零搭建EtherCAT 从站（STM32F407+ET1200）学习记录_stm32 ethercat-CSDN博客](https://blog.csdn.net/xuexidexiaohai/article/details/138668675)
6. `EtherCAT从站学习板参考资料V 2.1\00_必读`
##### 硬件适配
1. 三个中断：IQR，SYNC0，SYNC1
2. 1ms定时器
3. SPI接口或者并行总线接口

##### 驱动适配
- 使用twincat3做主站进行测试
1. 通信关键函数
	1. `PMPReadWord`
	2. `PMPReadDWord`
	3. `PMPWriteWord`
	4. `PMPWriteDWord`
2. ecat协议栈回调函数
	1. `APPL_InputMapping` --- 输入映射
	2. `APPL_OutputMapping` --- 输出映射
	3. `APPL_Application` --- 自定义应用
#### slot和module
##### 参考链接
1. [Beckhoff Information System - English](https://infosys.beckhoff.com/english.php?content=../content/1033/el6695/1317558667.html&id=)
2. [EtherCAT PDO映射概述_ethercat动态pdo映射的实现方法-CSDN博客](https://blog.csdn.net/m0_74823933/article/details/146030778)
3. [[EtherCAT]从站实现动态PDO功能 – HPMicro 知识库](https://kb.hpmicro.com/2025/08/26/ethercat%e4%bb%8e%e7%ab%99%e5%ae%9e%e7%8e%b0%e5%8a%a8%e6%80%81pdo%e5%8a%9f%e8%83%bd/)
4. [EtherCAT Module and Slot_从站ssc添加slots-CSDN博客](https://blog.csdn.net/qq_42039294/article/details/148441210)
5. 定义模块化设备的核心文档是 **ETG.5001 (Modular Device Profile Specification)**
##### 动态PDO 
###### COE字典
```c
/**
 * \brief Object dictionary entry structure
 */
typedef struct OBJ_ENTRY
{
    struct OBJ_ENTRY                      *pPrev; 
    struct OBJ_ENTRY                      *pNext; 

    UINT16                                Index; /**对象地址**/
    TSDOINFOOBJDESC                       ObjDesc; /**对象特征，包括对象类型、对象索引最大值等**/
    OBJCONST TSDOINFOENTRYDESC OBJMEM     *pEntryDesc; /**子索引描述符**/
    OBJCONST UCHAR OBJMEM                 *pName; /**子索引名称**/
    void MBXMEM                           *pVarPtr; /**实际变量的数据指针**/
    UINT8 (* Read)( UINT16 Index, UINT8 Subindex, UINT32 Size, UINT16 MBXMEM * pData, UINT8 bCompleteAccess ); 
    UINT8 (* Write)( UINT16 Index, UINT8 Subindex, UINT32 Size, UINT16 MBXMEM * pData, UINT8 bCompleteAccess );
    UINT16                                 NonVolatileOffset; 
}
TOBJECT;

```
- 先理解coe字典，代码里面就是`TOBJECT`这个结构体，后续slot和module也是围绕这个结构体操作
###### SDO和PDO
1. 理解动态pdo的关键在于理解sdo和pdo的关系，也就是0x1c12/0x1c13，0x16xx/0x1Axx，0x6000/0x7000之间的关系
	1. **`0x1C12/13`** 决定了 **哪些 PDO** 生效。
	2. **`0x16xx/1Axx`** 决定了 **PDO 里有哪些数据**。
	3. **`0x6000/7000`** 是 **数据的源头或终点**。
2. 先**完全理解**动态pdo，再学习slot和module
##### xml文件
- `xml` 文件详解
-  连接从站硬件开发与主站工程配置的**桥梁**和**说明书**，将物理上的从站变成主站可以解析的文件对象
- xml文件必须和代码一致，下面代码适配详细分析
##### 代码适配
###### `ecat_def.h`
1. 以下必须和xml中对应保持一致
	- `VENDOR_ID` 厂商ID，在xml中Vendor标签下
	- `PRODUCT_CODE` 产品代码，在xml中device中type标签下
	- `REVISION_NUMBER` 版本号，在xml中device中type标签下
	- `DEVICE_PROFILE_TYPE` 这里设为0x1389，也就是5001，对应为模块化设备，在xml中device-profile-channelinfo下
2. 其他重要定义可参考ssc tool中的注释及其操作教程
###### `SSC-9252`相关
1. `ssc-9252.c`、`ssc-9252.h`和`SSC-9252Objects.h`文件必须**完全理解**，是模块化设备功能实现关键代码
2. `SlotIndexIncrement`和`SlotPdoIncrement`需要与xml中对应参数保持一致，否则会导致从第二个插槽开始pdo出现错位

#### 状态机
##### 所有状态
1. **Init (I - 初始化)**：无应用层通信，仅能读写基础寄存器。
2. **Pre-Operational (P - 预运行)**：开启邮箱通信（Mailbox，用于 SDO 配置），无过程数据（Process Data）
3. **Safe-Operational (S - 安全运行)**：开启过程数据输入（Inputs，从站到主站），输出保持安全状态（不驱动硬件）。
4. **Operational (O - 运行)**：全功能开启，过程数据输入与输出（Outputs）完全激活。
5. **Bootstrap (B - 引导，可选)**：仅用于固件升级（FoE）（未实现）
##### 状态转换
- 相关代码在函数`AL_ControlInd`
###### Init (I) $\rightarrow$ Pre-Operational (P)
**目标**：建立非周期性的邮箱（Mailbox）通信通道，以便后续发送 SDO 进行参数配置。
- **主站必须完成的配置条件**
    - 为主站发送/从站接收（Mailbox Out）配置 **SyncManager 0 (SM0)**。
    - 为主站接收/从站发送（Mailbox In）配置 **SyncManager 1 (SM1)**。
    - 通过写入 AL Control 寄存器请求 `Pre-Op` 状态。
- **从站内部的校验条件**：
    - 验证 SM0 和 SM1 的基地址、大小和控制寄存器设置是否符合设备描述文件（ESI/XML）的要求。
    - 成功初始化内部的邮箱处理机制。
###### Pre-Operational (P) $\rightarrow$ Safe-Operational (S)
**目标**：配置周期性过程数据（Process Data）通道，并启动从站的数据采集。这是**最复杂且最容易报错**的转换阶段（特别是涉及动态 PDO 和模块化设备时）。
- **主站必须完成的配置条件**：
    - 通过 SDO（邮箱通信）完成对象字典（OD）的参数配置，包括**动态 PDO 映射**。
    - 为过程数据输出（Outputs）配置 **SyncManager 2 (SM2)**。
    - 为过程数据输入（Inputs）配置 **SyncManager 3 (SM3)**。
    - 配置 **FMMU**（现场总线内存管理单元），将逻辑地址映射到物理地址。
    - 如果使用分布式时钟（DC），配置 DC 相关的寄存器（如同步周期、偏移量）。
    - 写入 AL Control 寄存器请求 `Safe-Op` 状态。
- **从站内部的校验条件**：
    - 校验 SM2 和 SM3 的长度是否与当前 PDO 映射的总长度完全一致。
    - 校验 FMMU 的映射设置是否合法。
    - 校验 DC 同步设置是否正确（如果启用了 DC）。
    - 成功分配内部内存并准备好更新输入数据。
###### Safe-Operational (S) $\rightarrow$ Operational (O)
**目标**：建立完整的闭环控制，允许主站的输出数据实际驱动从站的物理硬件（如电机转动、继电器闭合）。
- **主站必须完成的配置条件**：
    - 主站必须在请求 `Op` 状态**之前**，发送有效的、工作计数器（WKC）正确的输出过程数据。
    - 写入 AL Control 寄存器请求 `Op` 状态。
- **从站内部的校验条件**：
    - 确认接收到了有效的主站输出数据（SM2 缓冲区被成功写入）。
    - 如果启用了分布式时钟（DC），从站的本地时钟必须已经与主站时钟实现**同步锁定（Sync Locked）**。
    - 确认应用层准备就绪，释放输出硬件的安全锁。
##### 常见错误码
- `0x001E`: Invalid SM IN Configuration（通常是 SM3 长度与 PDO 映射不符）。
- `0x001D`: Invalid SM OUT Configuration（SM2 长度问题）。
- `0x001B`: SM Latch Process Informed（通常是同步触发问题）。
