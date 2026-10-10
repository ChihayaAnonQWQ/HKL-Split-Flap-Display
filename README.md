# HKR Split-Flap Display

**中文** | [English](README_EN.md)

[![Release](https://img.shields.io/github/v/release/ChihayaAnonQWQ/HKR-Split-Flap-Display?label=%E4%B8%8B%E8%BD%BD%20download)](https://github.com/ChihayaAnonQWQ/HKR-Split-Flap-Display/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Minecraft](https://img.shields.io/badge/Minecraft-1.19.4%20--%201.21-62b47a.svg)](#%E4%BE%9D%E8%B5%96)
[![MTR](https://img.shields.io/badge/MTR-4.x-e2231a.svg)](#%E4%BE%9D%E8%B5%96)

JCM（Joban Client Mod）翻牌显示器风格的 MTR PIDS 资源包 —— 复刻 MTR 官方服务器上「花越线」的翻牌显示屏。

![预览](preview.png)

**游戏内实拍**（三种种别同屏，可以看到翻牌接缝、种别配色和线路图）：

![游戏内实拍](screenshots/ingame.png)

---

## 出处与致谢

本资源包复刻的对象，是 **MTR 官方服务器（MTR Let's Play）** 上由 **Forest_E233** 修建的
**花越线（Hana-Koshi Line）** 站台上的翻牌显示器。

- 服务器介绍：<https://wiki.minecrafttransitrailway.com/zh:mtr_letsplay:start>
- 原版屏幕是 **3:2** 比例
- Joban Client Mod 的 PIDS 画布是 **2:1**（136 × 76 设计单位）

> **所以版面会有细微差别。** 画布比例不同，元素必须重新排布；
> 本包按参考图逐项标定了字号、行高、基线、徽章宽度等数值，
> 让 2:1 的画面尽量还原 3:2 原版的观感。

MTR 与 Joban Client Mod 均为其各自作者的作品，本项目与它们没有隶属关系。

---

## 安装

1. 从 [**Releases**](https://github.com/ChihayaAnonQWQ/HKR-Split-Flap-Display/releases/latest)
   下载 `HKR-Split-Flap-Display.zip`，放进 `.minecraft/resourcepacks/`
   （**不要解压**，也不要把里面的文件夹再套一层）
2. 游戏内 **选项 → 资源包** 启用它
3. 放置 JCM 的 PIDS 方块，右键打开设置，在**自订显示屏格式**里选
   **HKR Split-Flap Display**
4. 改了脚本配置后按 **F3 + T** 重载资源包即可生效

### 支持的方块

只对 **JCM 的 PIDS 方块**有效：

`jsblock:rv_pids`、`rv_pids_sil_1`、`rv_pids_sil_2`、`lcd_pids`、`pids_projector`、`pids_1a`

> **不适用于 MTR 自带的 `mtr:pids_1` … `pids_4`** —— 那些方块不支持脚本预设。

## 依赖

| 模组 | 版本 |
| --- | --- |
| Minecraft | 1.19.4 – 1.21 |
| Minecraft Transit Railway (MTR) | 4.x |
| Joban Client Mod (JCM) | 2.x |

---

## 它显示什么

| 区域 | 内容 |
| --- | --- |
| **标题** | 下班車 Next Train |
| **種別 Type** | 快慢车种别徽章：中文 + 英文，颜色按种别区分 |
| **目的地 Destination** | 终点站名（中英双语），来自 MTR 数据 |
| **月台 Plat.** | 站台编号圆圈，底色跟随 MTR 路线颜色 |
| **開出 Dep. Time** | 剩余 < 10 分钟显示倒计时「N 分鐘」；≥ 10 分钟显示现实时刻 `xx:xx` |
| **停靠站 Stopping at** | 整条线路图：灰点＝不停靠，亮白灯＝停靠，终点站呼吸灯，当前站大圆点 |
| **第二班 / 第三班** | 后续两班车 |

### 翻牌显示器细节

参考图是翻牌显示器，所以本包也做了对应的视觉：

- **正中接缝**：每个翻牌格正中有一条横向暗缝（从参考图的 `00:18` 逐像素量出来的）
- **翻牌动画**：内容变化时，旧牌的上半瓣往下翻，下半瓣**不动** —— 真实翻牌就是这样
- **翻牌音效**：翻牌时播放「咔嗒」声，带坐标衰减 + 全局限流

---

## 快线线路号码配置表

**这是最常需要改的地方。** 徽章的显示文字和颜色由 `SERVICE_OVERRIDE` 表决定，
位置在 `assets/jsblock/scripts/next_train.js` 顶部。

### 推荐的 MTR 路线命名

MTR 的路线名格式是 `中文|English`，双竖线 `||` 后面是备注。
**推荐把种别写在名称或线路号里**，脚本会自动识别：

| 種別 | 中文 | English | 徽章底色 | 建议的路线名 / 线路号 | 匹配关键字 |
| --- | --- | --- | --- | --- | --- |
| 特急 | 特急 | Spec.press | `#D32F2F` 红 | `特急\|Spec.press` | `特急` |
| 準急 | 準急 | Semi Exp. | `#27AE60` 绿 | `準急\|Semi Exp.` | `準急`、`Semi Exp.` |
| 特快 | 特快 | Special Rapid | `#453EA5` 紫 | `特快\|Special Rapid` | `特快` |
| 通快 | 通快 | Com.Rapid | `#0E9E9E` 蓝绿 | `通快\|Com.Rapid` | `通快`、`Com.Rapid` |
| 急行 | 急行 | Ex.press | `#E67E22` 橙 | `急行\|Ex.press` | `急行`、`Ex.press` |
| 快速 | 快速 | Rapid | `#215DB3` 蓝 | `快速\|Rapid` | `快速` |
| 各停 | 各停 | Local | `#3C3C3C` 灰 | `各停\|Local` | `各停` |

### 填在【线路号】里

**种别只从 MTR 的「线路号」读。** 所以上表的写法要填在**线路号**那一栏，
路线的**名称**填什么都不影响（填 `test`、留空都行）。

- **线路号没填时**才退回路线名称，避免徽章一片空白
- 线路号里可以用 `||` 备注 → `花越线|Hana Line||特急|Spec.press`
- **上下行方向词会被自动忽略** → `快速|Rapid||上行` 仍然显示「快速 Rapid」
  （方向对 PIDS 没意义，哪个站台只来哪个方向的车是固定的）

> 早期版本会「自动判断名称和线路号哪个更像种别」，现在取消了 ——
> 唯一来源就是线路号，行为可预测，不会因为名称里恰好带了某个词就串味。

### 自定义映射表

不想依赖 MTR 命名，就直接在脚本里写死：

```js
const SERVICE_OVERRIDE = [
    { name: ["特急"],                color: "D32F2F" },  // 红
    { name: ["準急", "Semi Exp."],   color: "27AE60" },  // 绿
    { name: ["特快"],                color: "453EA5" },  // 紫
    { name: ["通快", "Com.Rapid"],   color: "0E9E9E" },  // 蓝绿
    { name: ["急行", "Ex.press"],    color: "E67E22" },  // 橙
    { name: ["快速"],                color: "215DB3" },  // 蓝
    { name: ["各停"],                color: "3C3C3C" }   // 灰

    // 按路线号码匹配
    // { number: "507", zh: "各停", en: "Local", color: "00A650" },
    // 连文字一起写死
    // { name: ["普通"], zh: "普通", en: "Ordinary", color: "7F8C8D" }
];
```

- 从上往下匹配，**先命中的先用**（更具体的写法放前面）
- `name` 可以是**字符串**或**数组**，数组里任意一个命中即可
- `number` 是路线号码，**完全相等**才算命中
- **只写 `color` 时，徽章文字照常从路线名 / `||` 备注里取**

### 快慢车怎么在 MTR 里设

MTR 本身**没有「快慢车」概念**。快慢车 = **停靠站台不同的几条路线**：

1. 给「快速」单独建一条路线
2. **只把要停的站台加进去**，不加的站台列车会直接通过
3. 线路图上跳过的站就会显示成**灰点**

| 路线 | 停靠站台 | 线路图效果 |
| --- | --- | --- |
| 各停 Local | 全部 11 个 | 全是亮白灯 |
| 快速 Rapid | 只加 6 个 | 跳过的 5 个站显示灰点 |
| 特急 Spec.press | 只加 4 个 | 跳过的 7 个站显示灰点 |

> 灰点／白点**完全**由这条路线的停靠站台列表决定，**不需要改脚本**。

---

## 自定义

脚本顶部集中了所有可调项，按顺序：

| 配置 | 作用 |
| --- | --- |
| `SS` | 超采样倍率（默认 8 → 1088×608 纹理） |
| `C_*` | 全套配色 |
| `SERVICE_OVERRIDE` | 种别映射表（见上） |
| `SERVICE_IGNORE_EXTRA` | 要忽略的方向词 |
| `BADGE_*` | 徽章宽度、字号、折行、斜体 |
| `LABELS` | 屏幕上所有写死的词 |
| `COUNTDOWN_WITHIN_MINUTES` | 倒计时 / 现实时刻的分界（默认 10 分钟） |
| `TIME_SOURCE` | 时间以到达还是开出为准 |
| `SEAM_*` | 翻牌接缝 |
| `FLIP_*` | 翻牌动画与音效 |
| `TERMINAL_LED_*` | 终点站呼吸灯 |
| `STOP_BLINK_*` | 停靠站白灯 |
| `CURRENT_STATION_MARK` | 当前车站是否画大圆点 |
| `BAR_COLOR_FROM` / `PLATFORM_COLOR_FROM` | 线路条 / 月台圆圈取哪个颜色 |
| `L` | 整套版面数值 |
| `F_CJK` / `F_LATIN` / `F_MONO` | 字体名 |

### 屏幕上写死的词

标题、栏目标题、第二班/第三班这些都在 `LABELS` 里：

```js
const LABELS = {
    title:       { zh: "下班車",       en: "Next Train" },
    type:        { zh: "種別",         en: "Type" },
    destination: { zh: "目的地",       en: "Destination" },
    platform:    { zh: "月台",         en: "Plat." },
    depTime:     { zh: "開出",         en: "Dep. Time" },
    stoppingAt:  { zh: "停靠站",       en: "Stopping at" },
    secondTrain: { zh: "第二班",       en: "Second train" },
    thirdTrain:  { zh: "第三班",       en: "Third train" },
    noService:   { zh: "暫無列車資訊", en: "No train information" }
};
```

英文给空字符串 `""` 就只显示中文。

### 性能

- 纹理默认 **1088×608**（`SS = 8`）
- 脚本做了「**画面没变化就不重画、不重传纹理**」：PIDS 内容一秒才变一次
- 闪烁类效果（终点站灯）的相位**量化成 10 档**，所以每秒只重传约 9 次而非 60 次
- 嫌卡就把 `SS` 降到 4；想更清晰可以上 10 / 12

---

## 文件结构

```
HKR-Split-Flap-Display/
├── LICENSE                             # MIT
├── NOTICE.md                           # 第三方作品说明
├── pack.mcmeta
├── pack.png
├── preview.png
├── screenshots/ingame.png              # 游戏内实拍
└── assets/jsblock/
    ├── joban_custom_resources.json      # 预设注册
    ├── scripts/next_train.js            # 全部渲染逻辑
    └── textures/pids/next_train/
        └── thumbnail.png                # 预设选择器里的缩略图
```

---

## 二次开发：JCM 的 Rhino 有四个坑

这个包的脚本跑在 JCM 内嵌的 **Rhino 1.9.1** 上，和浏览器 / Node 的 JS 有不少差别。
踩过的坑都记在这里，改脚本前建议先读：

### 1. 循环体里不要用 `const`

Rhino 会**把块级 `const` 当成函数级**，循环里每次迭代**不会重新初始化**。
`for` 里用 `const` 会静默保留第一轮的值：

```js
// ✗ splitRuns("Next Train") 会返回 "NNNNNNNNNN"
for (var i = 0; i < s.length; i++) { const c = s.charAt(i); ... }

// ✓ 用 var
for (var i = 0; i < s.length; i++) { var c = s.charAt(i); ... }
```

所以本包脚本的**函数体内一律用 `var`**（顶层配置仍然用 `const`）。

### 2. 同一个函数里不能重名

Rhino 对块级 `let` / `const` 做**函数级**重名检查，
`if` / `else` 两个分支里各写一个同名 `const` 会直接报
`变量 "x" 的重定义或冲突`。取不同的名字。

### 3. 不要用 `new Color(r, g, b)`

`java.awt.Color` 同时有 `Color(int,int,int)` 和 `Color(float,float,float)`，
Rhino 会挑到 **float** 那个重载 → `IllegalArgumentException`。用单参形式：

```js
new Color((r << 16) | (g << 8) | b)   // ✓
```

同理 `Font.deriveFont(int style)` 和 `deriveFont(float size)` 也有歧义，
**一律用双参** `deriveFont(style, size)`。

### 4. 不要用 `Font.deriveFont(ITALIC)` 做斜体

JCM 的 `Resources.getSystemFont()` 返回的是 `Font.createFont` 加载的字体，
不在系统字体表里，`deriveFont(ITALIC)` 不可靠。本包用
`g.shear(-0.21, 0)` 加 x 补偿实现斜体。

### 5. 音效坐标是【相对】的

`PIDSScriptContext.getSoundManager()` 的文档里写着
「**The base position are set to the block's position**」，
而 `playSound(id, pos, ...)` 的 `pos` 是**相对基准点**的。
所以要传**零向量** `new Vector3f(0, 0, 0)`（= 声源就在方块处），
传 `pids.blockPos()` 这种绝对坐标会把声源放到两倍坐标处，直接听不见。

### 出错时会显示什么

脚本崩溃时不会黑屏，而是显示 `PIDS script error` + 错误信息，
方便在游戏里直接看到问题。

---

## 怎么验证的

改动都过了这几层检查：

| 层次 | 检查内容 |
| --- | --- |
| 结构 | `pack.mcmeta` / 预设 JSON / 脚本路径一致、括号配平 |
| 静态 | 无 `const`/`let` 重名、无多参 `Color`、无单参 `deriveFont` |
| **真实 Rhino** | 用真的 Rhino 1.9.1 + 真的 `java.awt` 跑 `create`/`render`/`dispose` |
| 边界 | 无到站数据、无路线数据、LCD 133×72、PIDS 1A 90×46、单车、40×20 小屏、272×152 大屏 |
| 行为 | 种别解析、线路缓存、翻牌方向、当前站标记、翻牌音效 |
| 渲染 | 模拟器逐帧渲染，禁止出现错误屏 |

翻牌动画和终点站灯这类**动态行为是逐像素验证的**，不是靠肉眼看：

- 翻牌：「下半格在翻牌落地前必须纹丝不动」有断言测试
- 终点站灯：「半径恒定、只有颜色在灰↔白之间变」有逐相位取样

---

## 贡献者

- **ChihayaAnonQWQ** —— 需求、参考素材、测试、配色与版面的反复打磨
- **DeepSeek** —— 脚本实现、版面标定、验证工具链

## 许可

[MIT](LICENSE)

> 版面设计参考自 MTR 官方服务器上 Forest_E233 修建的花越线翻牌显示器，
> 仅供学习与个人使用。MTR 与 Joban Client Mod 的版权归其各自作者所有。
>
> 详见 [NOTICE.md](NOTICE.md)（第三方作品说明）。
