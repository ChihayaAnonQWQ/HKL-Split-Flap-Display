/* =====================================================================
 *  下班車 Next Train  —  JCM Scripted PIDS Preset
 *  ---------------------------------------------------------------------
 *  适用：Joban Client Mod (JCM) 2.x  +  MTR 4
 *  文件：assets/jsblock/scripts/next_train.js
 *
 *  屏幕内容：
 *    · 标题「下班車 Next Train」
 *    · 第一班车：种别徽章 + 目的地（中/英）+ 月台圆圈 + 开出时间
 *    · 「停靠站 Stopping at」线路图（起讫站大圆点、停车站白点、通过站灰点）
 *    · 第二班 / 第三班
 *
 *  想改屏幕上的固定词（種類/停車站…），改下面的 LABELS 就行，不用往下翻。
 *
 *  实现：用 AWT Graphics2D 把整屏画进一张 GraphicsTexture（超采样抗锯齿），
 *        再用一个 Texture 绘制调用铺满 PIDS 屏幕。
 *
 *  三条硬性约束（踩过的坑）：
 *    1. Resources.getSystemFont() 返回的字体是 Font.createFont 载入的，
 *       不在系统字体注册表里 → 只能 deriveFont()，不能 new Font(family,...)。
 *    2. deriveFont(size) 可能误匹配 deriveFont(int style) 重载
 *       → 统一用无歧义的 deriveFont(int style, float size)。
 *    3. AWT 的 fillRect/fillOval/drawString 有 int 重载，设计单位直接传会丢精度
 *       → 所有坐标先换算成设备像素并取整再传。
 * ===================================================================== */

importPackage(java.awt);
importPackage(java.awt.geom);

/* ============================ 可调参数 ============================ */

/* 超采样倍率：纹理会做成 pids.width × SS 像素。
   4 = 544×304，8 = 1088×608（默认）。
   调大更清晰，代价是显存和首次绘制开销；
   脚本已经做了「画面没变化就不重画、不重传纹理」，静止时几乎不耗性能。
   嫌卡就降到 4，还想更清晰可以上 10 或 12。 */
const SS = 8;
const DW = 136, DH = 76;      // 设计基准分辨率（RV PIDS 尺寸）

/* 配色（取自参考图） */
const C_BG      = [0x18, 0x18, 0x18];   // 屏幕底色
const C_PANEL   = [0x23, 0x24, 0x26];   // 行面板
const C_FRAME   = [0x4E, 0x4E, 0x52];   // 虚线外框
const C_HAIR    = [0x3A, 0x3B, 0x3E];   // 实线分隔线
const C_WHITE   = [0xFF, 0xFF, 0xFF];
const C_DIM     = [0xA8, 0xA8, 0xAC];   // 栏目标题（中文）
const C_DIM2    = [0x86, 0x86, 0x8A];   // 栏目标题（英文）
const C_SUB     = [0xC4, 0xC4, 0xC8];   // 目的地英文副名
const C_BAR     = [0xED, 0x8F, 0x90];   // 线路条
const C_DOT_ON  = [0xFC, 0xF9, 0xE3];   // 停车站圆点
const C_DOT_OFF = [0x8E, 0x90, 0x90];   // 通过站圆点
const C_BADGE   = [0x3C, 0x3C, 0x3C];   // 徽章兜底底色
const C_PLAT_BG = [0xED, 0x8F, 0x90];   // 月台圆圈底色（不跟随路线色时的兜底）
const C_PLAT_FG = [0xFF, 0xFF, 0xFF];

/* ================= 线路条 / 月台圆圈取哪个颜色 =================
 * MTR 里「路线」只有 名称 / 颜色 / 号码 / 类型 四个字段，没有单独的「线路」对象。
 * 下面这个开关决定屏幕上这两处用哪一路颜色：
 *
 *   "route"   = 该班车自己的 MTR 路线颜色（默认。三行是三条路线时颜色会各不同）
 *   "line"    = 「全线」那条路线的 MTR 颜色（通常是站数最多的各停；三行统一一个色）
 *   "service" = 跟种别徽章同一套颜色（也就是「快慢车色」，会被 SERVICE_OVERRIDE 改写）
 *   "fixed"   = 写死的粉色 C_BAR / C_PLAT_BG
 *
 * 注意：如果 SERVICE_OVERRIDE 里给种别指定了 color，那「快慢车色」和
 *       「路线色」就是两回事了 —— 徽章走 override，这里走 MTR 路线色。 */
const BAR_COLOR_FROM = "route";
const PLATFORM_COLOR_FROM = "route";

/* ======================= 快慢车（种别徽章）配置 =======================
 *
 * 【默认规则】徽章文字 = 你在 MTR 里填的路线名称（按 | 拆成中/英）
 *             徽章底色 = 你在 MTR 里给这条路线设的颜色
 *
 * 也就是说，MTR 里把路线命名成「快速|Rapid」，屏幕上就显示「快速 Rapid」。
 * MTR 本身没有快慢车概念，快慢车 = 停靠站台多少不同的几条路线。
 *
 * 【想换别的名字/颜色】不用改 MTR，往下面的表里加一行即可。
 * 匹配顺序从上到下，先命中的先用：
 *     number —— 路线号码，完全相等才算命中（对应 MTR 的「路线号码」）
 *     name   —— 路线名称关键字，包含就算命中（中英都行）
 *     zh/en  —— 徽章上显示的文字；不填就沿用路线名
 *     color  —— 徽章底色，RRGGBB 字符串；不填就沿用路线颜色
 *
 * 例：把号码 1 的路线一律显示成红色「急行 Express」：
 *     { number: "1", zh: "急行", en: "Express", color: "C0392B" },
 */
/* 种别（快慢车）的专属颜色。
   ★ 这里的颜色和 MTR 路线颜色是【两回事】：
     ・徽章（各停/快速/特快…）走这张表
     ・停车站线路条、月台圆圈走 MTR 路线颜色（见下面 BAR_COLOR_FROM / PLATFORM_COLOR_FROM）
   只写 color 时，徽章文字仍然照常从 || 备注 / 路线名里取。
   name 可以是字符串，也可以是数组（中英任意一个命中就算）。
   顺序有讲究：越靠前越优先，把更具体的写法放前面。 */
const SERVICE_OVERRIDE = [
    { name: ["特急"],                        color: "D32F2F" },  // 红
    { name: ["準急", "Semi Exp."],           color: "27AE60" },  // 绿
    { name: ["特快"],                        color: "453EA5" },  // 紫
    { name: ["通快", "Com.Rapid"],           color: "0E9E9E" },  // 蓝绿
    { name: ["急行", "Ex.press"],            color: "E67E22" },  // 橙
    { name: ["快速"],                        color: "215DB3" },  // 蓝
    { name: ["各停"],                        color: "3C3C3C" }   // 灰

    // 想按路线号码匹配就加 number：
    // { number: "507", zh: "各停", en: "Local", color: "00A650" },
    // 想连文字一起写死就补 zh / en：
    // { name: ["普通"], zh: "普通", en: "Ordinary", color: "7F8C8D" }
];

/* 种别文字【只从 MTR 的「线路号」读】。
   线路号没填时才退回路线名称，避免徽章一片空白 —— 除此之外不再看名称。
   （早期版本还会自动判断「名称和线路号哪个更像种别」，现在统一以线路号为唯一来源：
     行为可预测，不会因为名称里恰好带了某个词就串味。） */

/* 上下行的备注词。
   MTR 官方推荐把两个方向写成「同一线路名 + || 方向」：
       快速|Rapid||上行      快速|Rapid||下行
   但方向不是车种，不该占着「種別」徽章 —— 哪个站台只来哪个方向的车是固定的。
   所以 || 后面若只是这些词，就当它没有备注，继续用路线名当种别。
   （不区分大小写，包含即算） */
const SERVICE_IGNORE_EXTRA = [
    "上行", "下行", "上行方向", "下行方向",
    "東行", "西行", "南行", "北行", "东行", "南行",
    "顺时针", "逆时针", "順時針", "逆時針",
    "up", "down", "eastbound", "westbound", "northbound", "southbound",
    "clockwise", "anticlockwise", "counterclockwise"
];

/* ======================= 种别徽章的外观 =======================
 * BADGE_UNIFORM_WIDTH = true 时，三行徽章统一宽度（左边对齐、右边也整齐）。
 * 宽度在下面 L.badgeW 调。英文太长会自动折成两行（"Spec. Rapid" -> Spec. / Rapid），
 * 折完还放不下就自动缩小英文字号。
 * 想要「徽章宽度跟着文字走」就把它改成 false。 */
const BADGE_UNIFORM_WIDTH = true;
const BADGE_MAX_LINES = 2;          // 英文最多折几行

/* 统一宽度下，徽章内容是否在徽章里水平居中。
   false = 一律左对齐（默认；三个徽章的中文左边缘能对齐成一条竖线）
   true  = 内容短的一行（各停/快速）在徽章里居中，但那会和「特快」的左边缘错开 */
const BADGE_CENTER_CONTENT = false;

/* 徽章字号（设计单位）。三行共用同一套，所以「各停/快速/特快」一样大。
   想整排更大更小就改这两个数。 */
const BADGE_CJK_SIZE = 4.6;         // 中文（各停 / 快速 / 特快）
const BADGE_EN_SIZE  = 3.5;         // 英文（Local / Rapid / Spec. Rapid）

/* 折行后的排版（参考图里「Spec. / Rapid」是斜体，且第二行有缩进） */
const BADGE_ITALIC_WHEN_WRAPPED = true;  // 英文折成两行时用斜体（与参考图一致）
const BADGE_ITALIC_ALL = false;          // true = 徽章英文一律用斜体
const BADGE_LINE2_INDENT = 4;            // 折行后第二行缩进几个空格
const BADGE_ITALIC_SHEAR = 0.21;         // 倾斜程度，0.21 约等于常规斜体

/* ======================= 翻牌显示器外观 =======================
 * 参考图是翻牌显示器：每个字格由上下两瓣翻板拼成，正中有一条横向接缝。
 * 放大参考图的「00:18」可以量到：数字正中那一行亮度从 90+ 掉到 55，
 * 就是这条缝；缝宽约 0.30 设计单位。 */
const SEAM_ENABLED = true;               // 是否画正中接缝
const SEAM_THICKNESS = 0.15;             // 缝的粗细（设计单位）
const SEAM_COLOR = [0x10, 0x10, 0x14];   // 缝的颜色（比底色更暗）

const CELL_FRAME_ENABLED = true;         // 是否给徽章 / 面板描一圈细边
const CELL_FRAME_COLOR = [0x0A, 0x0A, 0x0C];
const CELL_FRAME_THICKNESS = 0.16;

/* 停靠站那一块是固定面板（不是翻牌机构），默认不加接缝。
   想让它也带缝就改成 true。 */
const SEAM_ON_ROUTE_MAP = false;

/* 标题、栏目标题（種別/目的地/月台/開出）、停靠站、第二班/第三班
   这些是「说明文字」，不是翻牌格子，默认不画接缝。
   只有会变的内容（种别徽章、目的地、月台圆圈、时间）才带缝。 */
const SEAM_ON_LABELS = false;

/* 当前所在的车站（PIDS 所在站）也画成大圆点，和起点站、终点站一个样式。
   判定顺序：先看本 PIDS 的目标站台，再退回 pids.station() 的站名。
   注意它【不】闪灯 —— 只有终点站呼吸。 */
const CURRENT_STATION_MARK = true;

/* 翻牌动画：内容变化时旧牌绕中线压扁到 0，新牌再从中线展开 */
const FLIP_ENABLED = true;
const FLIP_DURATION = 420;               // 一次翻牌多少毫秒

/* ======================= 翻牌音效 =======================
 * 种别徽章 / 时间格翻牌时放「咔嗒」声。
 * 一次翻牌连播几声（模拟翻牌机构连续翻动的声响），
 * 并且全局限流 —— 数据刷新时好几格会同时翻，不限流会炸成一片噪音。 */
const FLIP_SOUND_ENABLED = true;
const FLIP_SOUND = "minecraft:block.lever.click";   // 尖锐的「嗒」声；见 README 有备选
const FLIP_SOUND_VOLUME = 0.55;
const FLIP_SOUND_PITCH = 1.70;           // 音高调高一点更像塑料翻板
const FLIP_SOUND_PITCH_JITTER = 0.18;    // 音高随机抖动，避免听着像复读机
const FLIP_SOUND_CLICKS = 4;             // 每次翻牌播几声
const FLIP_SOUND_MIN_GAP = 55;           // 两声之间至少隔多少毫秒（全局限流）

/* 排查用：开启后在游戏里（需在 JCM 设置里打开 Script Debug Overlay）
   左上角会显示音效是否拿到坐标、累计放了几声。 */
const DEBUG_INFO = false;

/* ======================= 终点站白色 LED 闪烁 =======================
 * 停靠站线路图两端的终点站大圆点做成会呼吸的白色 LED。
 * 相位量化成 STEPS 档，所以纹理每秒只重传 STEPS 次而不是每帧一次 ——
 * 这是能开着闪烁又不掉帧的关键。 */
const TERMINAL_LED_ENABLED = true;
const TERMINAL_LED_PERIOD = 1100;        // 一次呼吸多少毫秒
const TERMINAL_LED_STEPS = 10;           // 量化档数：越大越顺滑（颜色渐变更吃档数）
const TERMINAL_LED_MIN = 0.18;           // 最暗时的亮度 0..1
const TERMINAL_LED_COLOR = [0xFF, 0xFF, 0xFF];
/* 最暗时的颜色：灰色。终点站的呼吸只改【颜色】灰<->白，半径固定不变 ——
   变大变小看着像在跳，不是呼吸。 */
const TERMINAL_LED_DIM = [0x8E, 0x90, 0x90];

/* ======================= 线路图三种圆点 =======================
 *   不停靠 -> 灰色，静止
 *   停靠   -> 亮白灯（恒亮）
 *   终点站 -> 闪白灯（呼吸）
 * 默认恒亮。想让它也闪就把 STOP_BLINK_ENABLED 改成 true。 */
const STOP_BLINK_ENABLED = false;
const STOP_BLINK_PERIOD = 1100;          // 一次明暗多少毫秒（只在上面开关为 true 时生效）
const STOP_BLINK_STEPS = 6;              // 量化档数
const STOP_BLINK_MIN = 0.12;             // 最暗时的亮度 0..1
/* 最暗时的颜色。必须明显亮于「通过站」的灰点 C_DOT_OFF，
   否则闪烁暗下去的那一刻，停靠站会和通过站糊成一样。 */
const STOP_BLINK_DIM = [0xC4, 0xC0, 0xB4];
const STOP_BLINK_COLOR = [0xFF, 0xFF, 0xFF];
const STOP_BLINK_GROW = 0.30;            // 最亮时半径放大比例


/* 版面（单位 = 设计单位，基准 136 × 76；数值按参考图逐项标定） */
const L = {
    padL: 3.2, padR: 3.2,
    frameInset: 1.3, frameThick: 0.30,

    titleBase: 7.6, titleCjkSize: 7.4, titleLatSize: 6.0, titleGap: 2.4,
    colBase: 12.4, colSize: 2.8, colLatSize: 2.2, destHdrX: 30.0,

    row1Top: 13.5, row1H: 8.2,
    row2Top: 54.7, row3Top: 67.0, rowH: 7.1,

    stopLblBase: 24.9,
    topCjkBase: 31.0, topLatBase: 33.9,
    barY: 36.1, barH: 3.1,
    botCjkBase: 42.5, botLatBase: 44.5,

    sepY: 47.4, lbl2Base: 52.4, lbl3Base: 65.0,

    badgeH: 5.9, badgePadX: 1.8,
    badgeRadius: 0.0,        // 种别徽章圆角；0 = 直角（翻牌显示器是方块，不是圆角）
    badgeGap: 2.6,
    destRadius: 0.0,         // 目的地面板圆角；同上，0 = 直角
    badgeW: 30.0,            // 统一徽章宽度（设计单位）；要放得下「特快 Spec. / Rapid」两行英文
    badgeWMin: 11.0,         // 不统一宽度时的最小宽度
    badgeTextGap: 1.7,       // 徽章里中文与英文之间的间距
    badgeLineGap: 3.45,      // 英文折成两行时的行距（行矮时会自动收窄）
    destRight: 103.0,

    platHdrCx: 104.5, platCx: 108.5, platR: 2.5, timeRight: 133.5,
    timeCellX0: 111.5, timeCellX1: 135.4,   // 时间格的翻牌动画范围（固定，避免内容变了格子跳）
    platCellW: 6.4,                          // 月台格宽度（比圆圈宽，缝要横穿整格）
    timeCellPad: 0.7,                        // 时间格左右留白

    stnCjkSize: 3.40, stnLatSize: 1.75,
    barX0: 4.9, barX1: 128.7
};

/* ================= 时间显示 =================
 * 按【剩余时间】分档，和参考图的规律一致：
 *     剩余 < COUNTDOWN_WITHIN_MINUTES 分钟  -> 「N 分鐘 / N min」倒计时
 *     剩余 >= 那个分钟数                    -> 现实时刻 xx:xx（24 小时制）
 * 参考图里「1 分鐘」「2 分鐘」都是快到站的班次，「00:18」是还早的班次。 */
const COUNTDOWN_WITHIN_MINUTES = 10;

/* 倒计时和现实时刻都以哪个时间为准：
   "arrival"   = 到达时刻（默认）
   "departure" = 开出时刻 */
const TIME_SOURCE = "arrival";

/* 不足 1 分钟时是否切成读秒。
   false（默认）= 照常显示「0 分鐘」（参考图没有秒数显示）
   true         = 00:45 / 45 秒 读秒 */
const TIME_SECONDS_BELOW_MINUTE = false;

/* 读秒样式（只在上面开关为 true 时生效）：
   "clock" = 00:45（数字字体）
   "unit"  = 45 秒 / 45 sec */
const TIME_SECONDS_STYLE = "clock";

/* ============================ 固定标签文字 ============================
 * 屏幕上所有写死的词都在这里，嫌哪个不对直接改，不用翻代码。
 * zh = 中文，en = 英文。英文留空字符串就只显示中文。 */
const LABELS = {
    title:       { zh: "下班車",      en: "Next Train" },
    type:        { zh: "種別",        en: "Type" },
    destination: { zh: "目的地",      en: "Destination" },
    platform:    { zh: "月台",        en: "Plat." },
    depTime:     { zh: "開出",        en: "Dep. Time" },
    stoppingAt:  { zh: "停靠站",      en: "Stopping at" },
    secondTrain: { zh: "第二班",      en: "Second train" },
    thirdTrain:  { zh: "第三班",      en: "Third train" },
    noService:   { zh: "暫無列車資訊", en: "No train information" }
};

/* 字体名（JCM 内置 AWT 字体，各平台一致） */
const F_CJK   = "Noto Sans CJK TC Medium";
const F_LATIN = "Noto Sans SemiBold";
const F_MONO  = "Monospaced";

/* 本 PIDS 的绘制变换：设备像素 = 设计单位 × k + 偏移 */
const T = { k: 1, ox: 0, oy: 0 };

/* ============================ 入口函数 ============================ */

function create(ctx, state, pids) {
    state.W = Math.max(1, Math.round(pids.width * SS));
    state.H = Math.max(1, Math.round(pids.height * SS));
    state.err = null;

    /* 先把纹理建出来：这样即使后面出错，也能把错误信息画到屏幕上，
       而不是留下一块什么都没有的黑屏（方便排查，也方便用户反馈）。 */
    state.tex = new GraphicsTexture(state.W, state.H);
    try {
        setupTransform(state, pids);
        state.fonts = makeFonts();
        fillBackground(state);
    } catch (e) {
        state.err = errText(e);
        drawErrorScreen(state);
    }
    state.tex.upload();
}

function render(ctx, state, pids) {
    if (state.tex == null) return;

    /* 翻牌音效要用：播放器上下文，以及「相对方块位置」的零向量（只取一次） */
    state.ctx = ctx;
    if (state.soundOrigin === undefined) {
        state.soundOrigin = soundOrigin(pids);
        if (DEBUG_INFO) {
            try {
                ctx.setDebugInfo("flipSound", FLIP_SOUND
                    + " origin=" + (state.soundOrigin == null ? "NONE(用本地声)" : "ok")
                    + " clicks=" + flipSoundCount);
            } catch (e) { }
        }
    }

    /* 画面内容没变就跳过重画和纹理上传。
       GraphicsTexture.upload() 是整张纹理往显存传，超采样倍率调高之后
       每帧都传会很贵；而 PIDS 的内容其实一秒才变一次（倒计时读秒）。
       注意：绘制调用（Texture.create...draw）必须每帧提交，
       JCM 每轮脚本执行后都会丢弃上一轮的绘制调用。 */
    var sig;
    try {
        sig = stateSignature(pids, state);
    } catch (e) {
        sig = "err:" + nowMs();          // 取数据出错就每帧重画，让错误屏能及时刷出来
    }

    if (sig !== state.sig || hasActiveFlip(state)) {
        try {
            setupTransform(state, pids);
            setHints(state.tex.graphics);
            fillBackground(state);
            drawAll(state.tex.graphics, state, pids);
            state.err = null;
        } catch (e) {
            state.err = errText(e);
            try { drawErrorScreen(state); } catch (e2) { /* 连错误屏都画不出来就放弃 */ }
        }
        state.tex.upload();
        state.sig = sig;
    }

    Texture.create("Next Train PIDS")
        .texture(state.tex.identifier)
        .size(pids.width, pids.height)
        .draw(ctx);
}

/* 把「会影响画面的一切」拼成一个字符串，用来判断要不要重画。
   倒计时按秒、路钟按分钟参与，所以实时车每秒重画一次，计划车每分钟一次。
   线路数据也一起带上（客户端可能是分几批把路线同步下来的）。 */
function stateSignature(pids, state) {
    var parts = [pids.width, pids.height, pids.rows];
    var now = nowMs();

    /* LED / 停靠点闪烁的相位：量化后每秒只变 STEPS 次，不会每帧重传纹理 */
    state_led = ledBrightness(now);
    state_blink = stopBlinkBrightness(now);
    parts.push("led" + (state_led < 0 ? "-" : Math.round(state_led * 1000))
             + "bk" + Math.round(state_blink * 1000));
    var arr = pids.arrivals();

    for (var i = 0; i < 4; i++) {
        var a = arr.get(i);
        if (a == null) { parts.push("-"); continue; }
        var when = TIME_SOURCE === "departure"
            ? num(a.departureTime())
            : num(a.arrivalTime());
        var left = when - now;
        /* 倒计时按分钟刷新；开了读秒才按秒刷新。现实时刻也是每分钟变一次。 */
        var tick = Math.floor(left / 60000);
        if (TIME_SECONDS_BELOW_MINUTE && left < 60000) tick = Math.floor(left / 1000);
        parts.push(a.routeName() + "\u0001" + a.routeNumber() + "\u0001" + a.destination()
            + "\u0001" + a.platformName() + "\u0001" + a.routeColor()
            + "\u0001" + (a.realtime() ? 1 : 0) + "\u0001" + tick
            + "\u0001" + (pids.isRowHidden(i) ? 1 : 0) + "\u0001" + safeStr(pids.getCustomMessage(i)));
    }

    /* 线路图：复用 pickLine 的结果，drawAll 里直接用 state.line，避免算两遍 */
    var line = pickLine(arr, state, pids);
    state.line = line;
    if (line != null) {
        parts.push("L" + line.stations.length);
        for (var j = 0; j < line.stations.length; j++) {
            parts.push(line.stations[j].id + "\u0002" + line.stations[j].name
                + (line.stopsOf[line.stations[j].id] === false ? "0" : "1")
                + (line.majors[line.stations[j].id] === true ? "M" : ""));
        }
    } else {
        parts.push("L0");
    }

    return parts.join("\u0003");
}

function fillBackground(state) {
    var g = state.tex.graphics;
    g.setColor(col(C_BG));
    g.fillRect(0, 0, state.W, state.H);
}

/* 出错的兜底画面：只用最保险的 API，这里再抛异常就真没救了 */
function drawErrorScreen(state) {
    var g = state.tex.graphics;
    g.setColor(new Color(0x101014));
    g.fillRect(0, 0, state.W, state.H);
    g.setFont(new Font("SansSerif", Font.BOLD, Math.max(10, Math.round(state.H / 16))));
    g.setColor(new Color(0xFF5555));
    g.drawString("PIDS script error", Math.round(state.W * 0.05), Math.round(state.H * 0.32));
    g.setColor(new Color(0xFFFFFF));
    var msg = String(state.err == null ? "unknown" : state.err);
    if (msg.length > 56) msg = msg.substring(0, 56);
    g.drawString(msg, Math.round(state.W * 0.05), Math.round(state.H * 0.60));
}

function errText(e) {
    if (e == null) return "unknown error";
    var s = "";
    try { s = "" + e; } catch (x) { s = ""; }
    if (s === "" || s === "undefined") {
        try { s = "" + e.message; } catch (x2) { s = "unknown error"; }
    }
    return s;
}

function dispose(ctx, state, pids) {
    if (state.tex != null) {
        state.tex.close();
        state.tex = null;
    }
}

function setupTransform(state, pids) {
    T.k = Math.min(state.W / DW, state.H / DH);
    T.ox = (state.W - DW * T.k) / 2;
    T.oy = (state.H - DH * T.k) / 2;
}

function setHints(g) {
    g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
    g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
    g.setRenderingHint(RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE);
    g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
    g.setRenderingHint(RenderingHints.KEY_FRACTIONALMETRICS, RenderingHints.VALUE_FRACTIONALMETRICS_ON);
}

/* ============================ 主绘制流程 ============================ */

function drawAll(g, state, pids) {
    var F = state.fonts;
    var arrivals = pids.arrivals();
    var a0 = arrivals.get(0);
    var line = state.line !== undefined ? state.line : pickLine(arrivals, state, pids);

    /* 接缝先收集、最后统一画，这样缝一定压在文字和底色上面 */
    state.seams = [];

    /* 虚线外框 */
    dashedFrame(g, L.frameInset, L.frameInset, DW - L.frameInset, DH - L.frameInset);

    /* 标题 */
    var tx = L.padL;
    tx = drawMixed(g, LABELS.title.zh, tx, L.titleBase, F.titleLat, F.titleCjk, C_WHITE, C_WHITE, 0);
    tx = drawMixed(g, LABELS.title.en, tx + L.titleGap, L.titleBase, F.titleLat, F.titleCjk, C_WHITE, C_WHITE, 0);
    /* 标题、栏目标题、第二班/第三班这类「说明文字」不是翻牌格子，默认不画接缝；
       只有会变的内容（种别、目的地、月台、时间）才带缝。 */
    if (SEAM_ON_LABELS) {
        addSeam(state, L.padL, tx, textCellCenter(L.titleBase, L.titleCjkSize, L.titleLatSize));
    }

    /* 栏目标题：一律「跟着自己的列走」，和参考图一样：
         種別 -> 左内边距（= 徽章左边缘）
         目的地 -> 徽章右边 + 间距（= 目的地面板左边缘）
         月台   -> 居中在月台编号上方
         開出   -> 右对齐到时间格右边缘 */
    var hdrSvc = a0 != null ? resolveService(a0) : null;
    var hdrDestX = L.padL + badgeWidthFor(g, state, hdrSvc) + L.badgeGap;
    var hdrTimeRight = L.timeRight + L.timeCellPad;

    var cols = [
        [L.padL, LABELS.type],
        [hdrDestX, LABELS.destination]
    ];
    for (var i = 0; i < cols.length; i++) {
        var w = textWidth(g, cols[i][1].zh, F.colCjk, F.colCjk) / T.k;
        drawMixed(g, cols[i][1].zh, cols[i][0], L.colBase, F.col, F.colCjk, C_DIM, C_DIM2, 0);
        drawMixed(g, cols[i][1].en, cols[i][0] + w + 1.1, L.colBase, F.col, F.colCjk, C_DIM, C_DIM2, 0);
    }
    /* 「月台 Plat.」居中在月台编号上方（量参考图：表头中心 438.5px vs 圆圈 442px） */
    drawMixedCentered(g, LABELS.platform.zh, LABELS.platform.en,
                      L.platCx, L.colBase, F.col, F.colCjk, C_DIM, C_DIM2, 1.1);
    drawMixedRight(g, LABELS.depTime.zh, LABELS.depTime.en,
                   hdrTimeRight, L.colBase, F.col, F.colCjk, C_DIM, C_DIM2, 1.1);
    if (SEAM_ON_LABELS) {
        addSeam(state, L.padL, DW - L.padR, textCellCenter(L.colBase, L.colSize, L.colSize));
    }

    /* 第一班 */
    if (a0 != null && !pids.isRowHidden(0)) {
        drawRow(g, state, a0, L.row1Top, L.row1H, true);
    } else if (a0 == null) {
        /* 没有到站数据：显示提示，避免整屏空白 */
        drawMixedCentered(g, LABELS.noService.zh, LABELS.noService.en,
                          (L.padL + L.destRight) / 2, L.row1Top + L.row1H / 2 + 1.6,
                          F.destLatBig, F.destCjkBig, C_WHITE, C_DIM, 2.0);
    }

    /* 停车站线路图 */
    var sw = textWidth(g, LABELS.stoppingAt.zh, F.colCjk, F.colCjk) / T.k;
    drawMixed(g, LABELS.stoppingAt.zh, L.padL, L.stopLblBase, F.col, F.colCjk, C_DIM, C_DIM2, 0);
    var sx = drawMixed(g, LABELS.stoppingAt.en, L.padL + sw + 1.1, L.stopLblBase,
                       F.col, F.colCjk, C_DIM, C_DIM2, 0);
    if (SEAM_ON_LABELS) {
        addSeam(state, L.padL, sx, textCellCenter(L.stopLblBase, L.colSize, L.colSize));
    }
    if (line != null && line.stations.length > 0) {
        /* 线路条颜色，见顶部 BAR_COLOR_FROM 说明 */
        var barSvc = a0 != null ? resolveService(a0) : null;
        var barColor = pickColor(BAR_COLOR_FROM, a0, line, barSvc, C_BAR);
        drawRouteMap(g, state, line, barColor);
    }

    /* 分隔线 */
    g.setColor(col(C_HAIR));
    fRect(g, L.padL, L.sepY, DW - L.padR, L.sepY + 0.22);

    /* 第二 / 第三班 */
    var a1 = arrivals.get(1);
    var a2 = arrivals.get(2);

    var w2 = textWidth(g, LABELS.secondTrain.zh, F.colCjk, F.colCjk) / T.k;
    drawMixed(g, LABELS.secondTrain.zh, L.padL, L.lbl2Base, F.col, F.colCjk, C_DIM, C_DIM2, 0);
    var x2 = drawMixed(g, LABELS.secondTrain.en, L.padL + w2 + 1.1, L.lbl2Base, F.col, F.colCjk, C_DIM, C_DIM2, 0);
    if (SEAM_ON_LABELS) {
        addSeam(state, L.padL, x2, textCellCenter(L.lbl2Base, L.colSize, L.colSize));
    }
    if (a1 != null && !pids.isRowHidden(1)) {
        drawRow(g, state, a1, L.row2Top, L.rowH, false);
    }

    var w3 = textWidth(g, LABELS.thirdTrain.zh, F.colCjk, F.colCjk) / T.k;
    drawMixed(g, LABELS.thirdTrain.zh, L.padL, L.lbl3Base, F.col, F.colCjk, C_DIM, C_DIM2, 0);
    var x3 = drawMixed(g, LABELS.thirdTrain.en, L.padL + w3 + 1.1, L.lbl3Base, F.col, F.colCjk, C_DIM, C_DIM2, 0);
    if (SEAM_ON_LABELS) {
        addSeam(state, L.padL, x3, textCellCenter(L.lbl3Base, L.colSize, L.colSize));
    }
    if (a2 != null && !pids.isRowHidden(2)) {
        drawRow(g, state, a2, L.row3Top, L.rowH, false);
    }

    /* 所有接缝最后统一画，压在文字与底色之上 */
    drawSeams(g, state);
}

/* ======================= 翻牌接缝 / 细边框 ======================= */

/* 登记一条接缝：[x0, x1] 横向范围，cy 纵向中心 */
function addSeam(state, x0, x1, cy) {
    if (!SEAM_ENABLED) return;
    state.seams.push([x0, x1, cy]);
}

/* 把登记过的接缝画出来 */
function drawSeams(g, state) {
    if (!SEAM_ENABLED || state.seams == null || state.seams.length === 0) return;
    var h = SEAM_THICKNESS;
    g.setColor(col(SEAM_COLOR));
    for (var i = 0; i < state.seams.length; i++) {
        var s = state.seams[i];
        fRect(g, s[0], s[2] - h / 2, s[1], s[2] + h / 2);
    }
}

/* 给一个格子描一圈细边（翻牌显示器的字格外框） */
function cellFrame(g, x0, y0, x1, y1) {
    if (!CELL_FRAME_ENABLED) return;
    var t = CELL_FRAME_THICKNESS;
    g.setColor(col(CELL_FRAME_COLOR));
    fRect(g, x0, y0, x1, y0 + t);
    fRect(g, x0, y1 - t, x1, y1);
    fRect(g, x0, y0, x0 + t, y1);
    fRect(g, x1 - t, y0, x1, y1);
}

/* 一个文字格子的纵向中心（接缝位置）。
   接缝对齐的是「字面中心」而不是格子几何中心：
   中文基线在 base，字面中心约在基线上方 0.40em；英文约 0.38em。
   这里给两种字号各算一次，取居中的那个。 */
function textCellCenter(base, cjkSize, latSize) {
    var cjk = base - cjkSize * 0.40;
    var lat = base - latSize * 0.38;
    return (cjk + lat) / 2;
}

/* ======================= 终点站 LED ======================= */

/* 终点站 LED 的亮度 0..1（三角波，比正弦更像指示灯）。
   相位量化成 TERMINAL_LED_STEPS 档，配合 stateSignature 让纹理
   每秒只重传 STEPS 次，而不是每帧一次。 */
function ledBrightness(now) {
    if (!TERMINAL_LED_ENABLED) return -1;
    var steps = TERMINAL_LED_STEPS < 2 ? 2 : TERMINAL_LED_STEPS;
    var q = Math.floor((now % TERMINAL_LED_PERIOD) / TERMINAL_LED_PERIOD * steps) / steps;
    /* 正弦波：两端平滑，看着像呼吸；三角波会有明显的折返点 */
    var wave = 0.5 - 0.5 * Math.cos(2 * Math.PI * q);
    return TERMINAL_LED_MIN + (1 - TERMINAL_LED_MIN) * wave;
}

/* 停靠点白点的闪烁亮度 0..1（同样量化成档） */
function stopBlinkBrightness(now) {
    if (!STOP_BLINK_ENABLED) return 1;
    var steps = STOP_BLINK_STEPS < 2 ? 2 : STOP_BLINK_STEPS;
    var q = Math.floor((now % STOP_BLINK_PERIOD) / STOP_BLINK_PERIOD * steps) / steps;
    var tri = q < 0.5 ? q * 2 : (1 - q) * 2;
    return STOP_BLINK_MIN + (1 - STOP_BLINK_MIN) * tri;
}

/* 把颜色 baseColor 朝 rgb 数组混过去，t 是混合比例。
   统一走单参 Color(int)，避开 Rhino 的 float 重载坑。 */
function blendColor(baseColor, rgb, t) {
    if (t < 0) t = 0; else if (t > 1) t = 1;
    var r = Math.round(baseColor.getRed() + (rgb[0] - baseColor.getRed()) * t);
    var g = Math.round(baseColor.getGreen() + (rgb[1] - baseColor.getGreen()) * t);
    var b = Math.round(baseColor.getBlue() + (rgb[2] - baseColor.getBlue()) * t);
    return new Color((r << 16) | (g << 8) | b);
}

/* 终点站大圆点 + 会呼吸的白色 LED 光环。
   cx / cy 是圆心（设计单位），rMajor 是内芯半径，barColor 是线路条颜色。 */
function drawTerminalDot(g, cx, cy, rMajor, ring, barColor, blink) {
    var led = state_led;                       // 由 drawAll 预先算好，见 stateSignature

    /* 固定的线路色外圈：它不动，闪烁只发生在圈里面 */
    g.setColor(barColor);
    fOval(g, cx, cy, rMajor + ring, rMajor + ring);

    /* 起点站（blink 为假）：跟普通停靠站一样恒亮白灯，不闪 */
    if (!blink || led < 0) {
        g.setColor(col(C_DOT_ON));
        fOval(g, cx, cy, rMajor, rMajor);
        return;
    }

    /* 终点站：圈内圆芯的【颜色】在灰与白之间呼吸，半径始终是满圆。
       光不出圈 —— 之前是在圈外扩光环，和「指示灯」的感觉不对。 */
    g.setColor(blendColor(col(TERMINAL_LED_DIM), TERMINAL_LED_COLOR, led));
    fOval(g, cx, cy, rMajor, rMajor);
}

/* 本班车「停靠」的站：恒亮白灯（STOP_BLINK_ENABLED 为真时才会呼吸） */
function drawStopDot(g, cx, cy, r, barColor) {
    var b = state_blink;
    if (b < 0) b = 1;

    /* 恒亮时 b = 1，直接是纯白；开了闪烁才在暗奶油色与纯白之间呼吸。
       ★ 关键：即使闪烁，最暗时也不能暗到跟「不停靠」的灰点分不出来。 */
    g.setColor(blendColor(col(STOP_BLINK_DIM), STOP_BLINK_COLOR, b));
    var rr = r * (1 + STOP_BLINK_GROW * (b - 0.5));
    fOval(g, cx, cy, rr, rr);
}

/* 亮度缓存：stateSignature 算一次，drawAll 里直接用，
   避免同一帧里两次调用取到不同的相位。 */
var state_led = -1;
var state_blink = 1;

/* ======================= 翻牌动画 ======================= */

/* 翻牌合成：把 region 这块格子画成「正在翻牌」的样子。
   真实翻牌是【上半瓣往下翻】，下半瓣不动 —— 不是整张牌绕中线一起转：
     p <  0.5  下半格保持旧内容；上半格的旧内容绕中线压扁（1 -> 0），
               被它让出来的位置露出新内容
     p >= 0.5  上半格已经是新内容；下半格由新内容从中线往下盖住旧内容 */
function flipCompose(g, region, p, paintOld, paintNew) {
    var xa = px(region.x0), xb = px(region.x1);
    var ya = py(region.y0), yb = py(region.y1);
    var w = Math.max(1, xb - xa);
    var cyDev = py((region.y0 + region.y1) / 2);
    var topH = Math.max(1, cyDev - ya);
    var botH = Math.max(1, yb - cyDev);

    if (p < 0.5) {
        /* 下半格：旧内容，全程不动 */
        g.setClip(xa, cyDev, w, botH);
        paintOld();

        /* 上半格：先铺新内容，再把旧内容绕中线压扁盖上去 */
        g.setClip(xa, ya, w, topH);
        paintNew();
        var f = 1 - 2 * p;
        if (f > 0.004) {
            var saved = g.getTransform();
            g.translate(0, cyDev);
            g.scale(1, f);
            g.translate(0, -cyDev);
            paintOld();
            g.setTransform(saved);
        }
    } else {
        /* 上半格：新内容，不再变 */
        g.setClip(xa, ya, w, topH);
        paintNew();

        /* 下半格：旧内容打底，新内容从中线往下展开盖住它（= 翻下来的那半张落在上面） */
        g.setClip(xa, cyDev, w, botH);
        paintOld();
        var gg = 2 * p - 1;
        if (gg > 0.004) {
            var saved2 = g.getTransform();
            g.translate(0, cyDev);
            g.scale(1, gg);
            g.translate(0, -cyDev);
            paintNew();
            g.setTransform(saved2);
        }
    }

    g.setClip(null);
}

/* 上一次翻牌声的时间，用来做全局限流 */
var lastFlipSoundMs = -100000;
var flipSoundCount = 0;             // 累计播放次数，供调试信息显示

/* ★ 关键：playSound 的坐标是【相对 getSoundManager() 的 base position】的，
   而 base position 已经被设成方块位置。
   所以这里要传【零向量】= 声源就在方块处。
   之前误把 pids.blockPos()（绝对坐标）当相对坐标传进去，
   等于把声源放到了「方块位置 + 方块位置」，直接飞出听觉范围 —— 这就是没声音的原因。 */
function soundOrigin(pids) {
    try { return new Vector3f(0, 0, 0); } catch (e) { }
    try {
        var bp = pids.blockPos();          // 退路：拿方块坐标自己减自己，得到零向量
        if (bp != null) return bp.sub(bp);
    } catch (e) { }
    return null;
}

/* 播放一声翻牌咔嗒。
   优先用带坐标的 playSound（远处会随距离衰减）；拿不到坐标才退回 playLocalSound。
   任何一步失败都直接放弃 —— 没声音也不能影响画面。 */
function playFlipSound(state, now) {
    if (!FLIP_SOUND_ENABLED) return;
    if (now - lastFlipSoundMs < FLIP_SOUND_MIN_GAP) return;
    var ctx = state == null ? null : state.ctx;
    if (ctx == null) return;
    lastFlipSoundMs = now;
    flipSoundCount++;

    try {
        var sm = ctx.getSoundManager();
        if (sm == null) return;
        var id = Resources.id(FLIP_SOUND);
        var jitter = FLIP_SOUND_PITCH * FLIP_SOUND_PITCH_JITTER;
        var pitch = FLIP_SOUND_PITCH - jitter / 2 + Math.random() * jitter;
        if (state.soundOrigin != null && typeof sm.playSound === "function") {
            sm.playSound(id, state.soundOrigin, FLIP_SOUND_VOLUME, pitch);
        } else if (typeof sm.playLocalSound === "function") {
            /* 退路：没有坐标就用本地声。缺点是远近都听得见，但总比没声音强 */
            sm.playLocalSound(id, FLIP_SOUND_VOLUME, pitch);
        }
    } catch (e) { /* 静默失败 */ }
}

/* 带翻牌动画的格子。
   key      格子唯一标识
   region   {x0,x1,y0,y1} 设计单位
   fp       当前内容的指纹（变了就翻牌）
   value    当前内容（纯数据）
   paint(v) 把内容 v 画进格子的函数 */
function flipCell(g, state, key, region, fp, value, paint) {
    if (state.flip == null) state.flip = {};
    var rec = state.flip[key];
    if (rec == null) {
        rec = { fp: fp, value: value, prev: null, t0: 0 };
        state.flip[key] = rec;
    }

    var now = nowMs();
    if (rec.fp !== fp) {
        rec.prev = rec.value;          // 上一份内容拿来当旧牌
        rec.fp = fp;
        rec.t0 = now;
        rec.clicks = 0;                // 这次翻牌还没响过
    }
    rec.value = value;

    var p = 1;
    if (!FLIP_ENABLED || FLIP_DURATION <= 0 || rec.prev == null) {
        rec.prev = null;
    } else {
        p = (now - rec.t0) / FLIP_DURATION;
        if (p >= 1) { rec.prev = null; p = 1; }
        else if (p < 0) p = 0;
    }

    if (rec.prev == null) { paint(rec.value); return; }

    /* 翻牌过程中按进度播咔嗒声，播够 FLIP_SOUND_CLICKS 声为止 */
    if (FLIP_SOUND_ENABLED && FLIP_SOUND_CLICKS > 0) {
        var want = Math.floor(p * FLIP_SOUND_CLICKS) + 1;
        if (want > FLIP_SOUND_CLICKS) want = FLIP_SOUND_CLICKS;
        if (want > (rec.clicks == null ? 0 : rec.clicks)) {
            rec.clicks = want;
            playFlipSound(state, now);
        }
    }

    var oldValue = rec.prev;
    flipCompose(g, region, p,
        function () { paint(oldValue); },
        function () { paint(rec.value); });
}

/* 还有格子正在翻牌吗？有的话 render() 不能跳帧 */
function hasActiveFlip(state) {
    if (!FLIP_ENABLED || state.flip == null) return false;
    for (var k in state.flip) {
        if (state.flip[k] != null && state.flip[k].prev != null) return true;
    }
    return false;
}

/* Java List 用 size()/get()，JS 数组用 length/[i] —— 两种都认，且都不抛异常。
   （模拟器里的 mock 返回的就可能是普通数组） */
function listSize(list) {
    if (list == null) return 0;
    try { if (typeof list.size === "function") return list.size(); } catch (e) { }
    try { if (list.length != null) return list.length; } catch (e) { }
    return 0;
}

function listGet(list, i) {
    if (list == null) return null;
    try { if (typeof list.get === "function") return list.get(i); } catch (e) { }
    try { return list[i]; } catch (e) { }
    return null;
}

/* 找出「PIDS 当前所在的车站」在站点表里的 id。
   优先用本 PIDS 的目标站台 id（最准），拿不到再退回 pids.station() 的站名。
   都拿不到就返回 null，此时不画当前站标记。 */
function currentStationId(pids, stations) {
    if (pids == null || stations == null || stations.length === 0) return null;

    var targets = null;
    try { targets = pids.getTargetPlatformIds(); } catch (e) { targets = null; }
    var tn = listSize(targets);
    if (tn > 0) {
        for (var i = 0; i < stations.length; i++) {
            for (var j = 0; j < tn; j++) {
                if (String(listGet(targets, j)) === String(stations[i].id)) return stations[i].id;
            }
        }
    }

    var st = null;
    try { st = pids.station(); } catch (e) { st = null; }
    if (st != null) {
        var nm = cjkPart(stripExtra(safeStr(st.getName())));
        if (nm !== "") {
            for (var i = 0; i < stations.length; i++) {
                if (cjkPart(stations[i].name) === nm) return stations[i].id;
            }
        }
    }
    return null;
}

/* 徽章宽度。drawRow 和表头对齐都要用同一个值，所以抽出来。
   统一宽度时就是 L.badgeW；跟着文字走时才按内容算。 */
function badgeWidthFor(g, state, svc) {
    if (BADGE_UNIFORM_WIDTH) return L.badgeW;
    var F = state.fonts;
    var wZh = (svc == null || svc.zh === "") ? 0 : textWidth(g, svc.zh, F.badge, F.badge) / T.k;
    var wEn = (svc == null || svc.en === "") ? 0 : textWidth(g, svc.en, F.badgeEn, F.badgeEn) / T.k;
    var gap = (svc != null && svc.zh !== "" && svc.en !== "") ? L.badgeTextGap : 0;
    return Math.max(L.badgeWMin, wZh + gap + wEn + L.badgePadX * 2);
}

/* ============================ 一行 ============================ */

function drawRow(g, state, arrival, rowTop, rowH, big) {
    var F = state.fonts;
    var cy = rowTop + rowH / 2;
    var rowId = (rowTop === L.row1Top) ? "r0" : (rowTop === L.row2Top ? "r1" : "r2");

    /* ---- 种别徽章（快慢车）---- */
    var svc = resolveService(arrival);
    svc.fill = svc.color != null ? new Color(svc.color) : intColor(arrival.routeColor(), C_BADGE);

    var bw = badgeWidthFor(g, state, svc);

    var badgeRegion = { x0: L.padL, x1: L.padL + bw, y0: rowTop, y1: rowTop + rowH };
    cellFrame(g, badgeRegion.x0, badgeRegion.y0, badgeRegion.x1, badgeRegion.y1);
    flipCell(g, state, rowId + "b", badgeRegion,
             svc.zh + "\u0001" + svc.en + "\u0001" + svc.fill.getRGB(), svc,
             function (v) { drawServiceBadge(g, state, v, arrival, rowTop, rowH, big); });
    addSeam(state, badgeRegion.x0, badgeRegion.x1, cy);

    /* ---- 目的地面板 ---- */
    var destX = L.padL + bw + L.badgeGap;
    var destW = L.destRight - destX;
    if (destW > 8) {
        g.setColor(col(C_PANEL));
        fRound(g, destX, rowTop + 0.35, destX + destW, rowTop + rowH - 0.35, L.destRadius);
        cellFrame(g, destX, rowTop + 0.35, destX + destW, rowTop + rowH - 0.35);
    }

    var dest = splitName(safeStr(arrival.destination()));
    var dCjk = big ? F.destCjkBig : F.destCjk;
    var dLat = big ? F.destLatBig : F.destLat;
    var dBase = cy + (big ? 2.0 : 1.6);
    var dx = destX + 2.0;
    dx = drawMixed(g, dest.cjk, dx, dBase, dLat, dCjk, C_WHITE, C_WHITE, 0);
    if (dest.latin !== "") {
        drawMixed(g, dest.latin, dx + 1.6, dBase - (big ? 0.15 : 0.1),
                  dLat, dCjk, C_SUB, C_SUB, 0);
    }
    if (destW > 8) {
        addSeam(state, destX, destX + destW, cy);      // 翻牌格子是等分的，缝在格子正中
    }

    /* ---- 月台圆圈 ---- */
    /* 参考图里缝是横穿整个「月台格」的，不是只画在圆圈上，
       格子比圆圈宽，所以缝要往两边各多伸一截。 */
    var platNo = extractPlatformNo(safeStr(arrival.platformName()));
    var pr = big ? L.platR : L.platR * 0.9;
    var platCellX0 = L.platCx - L.platCellW / 2;
    var platCellX1 = L.platCx + L.platCellW / 2;
    g.setColor(pickColor(PLATFORM_COLOR_FROM, arrival, state.line, svc, C_PLAT_BG));
    fOval(g, L.platCx, cy, pr, pr);
    drawCentered(g, platNo, L.platCx, cy + (big ? 1.4 : 1.2),
                 big ? F.platBig : F.plat, C_PLAT_FG);
    addSeam(state, platCellX0, platCellX1, cy);

    /* ---- 开出时间（带翻牌动画）---- */
    var tBase = cy + (big ? 1.7 : 1.45);
    var timeRegion = { x0: L.timeCellX0, x1: L.timeCellX1, y0: rowTop, y1: rowTop + rowH };
    var tv = timeValue(arrival);
    flipCell(g, state, rowId + "t", timeRegion, timeFingerprint(tv), tv,
             function (v) { paintTime(g, state, v, big, tBase); });

    /* 时间格的缝紧贴内容，不是固定从某个 x 开始 */
    var tw = timeContentWidth(g, state, tv, big);
    addSeam(state, L.timeRight - tw - L.timeCellPad, L.timeRight + L.timeCellPad, cy);
}

/* 时间格要显示的内容，算成一个纯数据对象。
   拆成「算值」和「画值」两步，翻牌动画才能拿旧值重画一遍。 */
function timeValue(arrival) {
    /* MTR 的到达/开出时刻本身就是现实时间戳，直接相减就是剩余时间 */
    var when = TIME_SOURCE === "departure"
        ? num(arrival.departureTime())
        : num(arrival.arrivalTime());
    var ms = when - nowMs();

    if (ms < COUNTDOWN_WITHIN_MINUTES * 60000) {
        if (ms < 60000 && TIME_SECONDS_BELOW_MINUTE) {
            var sec = Math.floor(ms / 1000);
            if (sec < 0) sec = 0;
            return { kind: "sec", n: sec, style: TIME_SECONDS_STYLE };
        }
        var n = Math.floor(ms / 60000);
        if (n < 0) n = 0;                       // 到站后停在「0 分鐘」，不出负数
        /* 与 MTR/JCM 内置写法一致：2 分钟及以内用单数 min */
        return { kind: "min", n: n, en: ms <= 120000 ? "min" : "mins" };
    }
    var d = new Date(when);
    return { kind: "clock", text: pad2(d.getHours()) + ":" + pad2(d.getMinutes()) };
}

/* 时间值的指纹，用来判断「变没变」 */
function timeFingerprint(tv) {
    if (tv.kind === "clock") return "c" + tv.text;
    if (tv.kind === "sec") return "s" + tv.n + tv.style;
    return "m" + tv.n + tv.en;
}

/* 时间格内容的宽度（设计单位），用来定接缝长度和格子范围 */
function timeContentWidth(g, state, tv, big) {
    var F = state.fonts;
    if (tv.kind === "clock" || (tv.kind === "sec" && tv.style === "clock")) {
        var cf = big ? F.clockBig : F.clock;
        var cs = tv.kind === "clock" ? tv.text : "00:00";
        return textWidth(g, cs, cf, cf) / T.k;
    }
    var numF = big ? F.timeNumBig : F.timeNum;
    var unitF = big ? F.timeUnitBig : F.timeUnit;
    var unitCjk = big ? F.unitCjkBig : F.unitCjk;
    var zhUnit = tv.kind === "sec" ? "秒" : "分鐘";
    var enUnit = tv.kind === "sec" ? "sec" : tv.en;
    return textWidth(g, String(tv.n), numF, numF) / T.k + 0.9
         + Math.max(textWidth(g, zhUnit, unitCjk, unitCjk) / T.k,
                    textWidth(g, enUnit, unitF, unitF) / T.k);
}

/* 把时间值画到时间格上（右对齐到 L.timeRight） */
function paintTime(g, state, tv, big, base) {
    var F = state.fonts;

    if (tv.kind === "clock") { drawClock(g, state, tv.text, big, base); return; }
    if (tv.kind === "sec" && tv.style === "clock") {
        drawClock(g, state, "00:" + pad2(tv.n % 60), big, base);
        return;
    }

    var numF = big ? F.timeNumBig : F.timeNum;
    var unitF = big ? F.timeUnitBig : F.timeUnit;
    var unitCjk = big ? F.unitCjkBig : F.unitCjk;
    var numStr = String(tv.n);
    var zhUnit = tv.kind === "sec" ? "秒" : "分鐘";
    var enUnit = tv.kind === "sec" ? "sec" : tv.en;

    var wNum = textWidth(g, numStr, numF, numF) / T.k;
    var wUnit = Math.max(textWidth(g, zhUnit, unitCjk, unitCjk) / T.k,
                         textWidth(g, enUnit, unitF, unitF) / T.k);

    var x = L.timeRight - (wNum + 0.9 + wUnit);
    drawMixed(g, numStr, x, base, numF, numF, C_WHITE, C_WHITE, 0);
    var ux = x + wNum + 0.9;
    drawMixed(g, zhUnit, ux, base - 0.9, unitF, unitCjk, C_WHITE, C_WHITE, 0);
    drawMixed(g, enUnit, ux, base + 2.0, unitF, unitCjk, C_WHITE, C_WHITE, 0);
}

/* 用数字字体右对齐画一串时间（HH:MM），字形宽度均匀 */
function drawClock(g, state, txt, big, base) {
    var f = big ? state.fonts.clockBig : state.fonts.clock;
    var w = textWidth(g, txt, f, f) / T.k;
    drawMixed(g, txt, L.timeRight - w, base, f, f, C_WHITE, C_WHITE, 0);
}

/* ============================ 种别徽章 ============================ */
/* 布局：[中文大字] [英文小字]
   ・三行共用 BADGE_CJK_SIZE / BADGE_EN_SIZE 一套字号，各停/快速/特快一样大
   ・BADGE_UNIFORM_WIDTH 为真时三行统一宽度，左边对齐右边也整齐
   ・英文放不下时按空格折成两行（"Spec. Rapid" -> "Spec." / "Rapid"）
   ・折完仍放不下就等比缩小英文字号；两行放不进这一行的高度也会自动收
   返回徽章实际宽度（设计单位）。 */
function drawServiceBadge(g, state, svc, arrival, rowTop, rowH, big) {
    var F = state.fonts;
    var cy = rowTop + rowH / 2;

    var zhFont = F.badge;          // 三行共用同一套字号
    var enFont = F.badgeEn;

    var zh = svc.zh == null ? "" : String(svc.zh);
    var en = svc.en == null ? "" : String(svc.en);

    var wZh = zh === "" ? 0 : textWidth(g, zh, zhFont, zhFont) / T.k;
    var textGap = (zh !== "" && en !== "") ? L.badgeTextGap : 0;

    /* 徽章宽度 */
    var autoW = wZh + textGap + (en === "" ? 0 : textWidth(g, en, enFont, enFont) / T.k)
                + L.badgePadX * 2;
    var bw = BADGE_UNIFORM_WIDTH ? L.badgeW : Math.max(L.badgeWMin, autoW);

    /* 英文可用宽度不够就折行（第二行要留出缩进的位置） */
    var enAvail = bw - L.badgePadX * 2 - wZh - textGap;
    var indent = 0;
    if (enAvail > 1 && BADGE_LINE2_INDENT > 0) {
        indent = textWidth(g, spaces(BADGE_LINE2_INDENT), enFont, enFont) / T.k;
        if (indent > enAvail * 0.35) indent = enAvail * 0.35;   // 别把第二行挤没了
    }
    var lines = wrapWords(g, en, enFont, enAvail, enAvail - indent, BADGE_MAX_LINES);

    /* 行距不能超过徽章高度，否则两行会溢出到别的行去 */
    var ls = Math.min(L.badgeLineGap, rowH * 0.52);

    var italic = BADGE_ITALIC_ALL || (BADGE_ITALIC_WHEN_WRAPPED && lines.length > 1);
    var shear = italic ? BADGE_ITALIC_SHEAR : 0;

    /* 折完还放不下 -> 等比缩小英文 */
    var maxLineW = 0;
    for (var i = 0; i < lines.length; i++) {
        var lw = textWidth(g, lines[i], enFont, enFont) / T.k + (i > 0 ? indent : 0);
        if (lw > maxLineW) maxLineW = lw;
    }
    if (maxLineW > enAvail && maxLineW > 0) {
        enFont = scaleFont(enFont, enAvail / maxLineW);
    }

    /* 高度也检查一遍：两行英文 + 行距放不进徽章才整体缩小。
       实际视觉高度 ≈ 行距 + 0.90×英文字号（帽高 0.72 + 降部 0.21），
       这里不能用 1.0，否则矮行会被误判成放不下、白白缩小字号。 */
    var enUnits = enFont.getSize() / T.k;
    var zhUnits = zhFont.getSize() / T.k;
    var blockH = lines.length > 1 ? (ls + enUnits * 0.90) : enUnits;
    var needH = Math.max(blockH, zhUnits * 0.92);
    var availH = rowH - 0.4;
    if (needH > availH && needH > 0) {
        var k = availH / needH;
        enFont = scaleFont(enFont, k);
        zhFont = scaleFont(zhFont, k);
        enUnits = enFont.getSize() / T.k;
        ls = ls * k;
    }

    /* 底色（调用方已把最终颜色解析进 svc.fill） */
    g.setColor(svc.fill != null ? svc.fill
        : (svc.color != null ? new Color(svc.color) : intColor(arrival.routeColor(), C_BADGE)));
    fRound(g, L.padL, rowTop, L.padL + bw, rowTop + rowH, L.badgeRadius);

    /* 水平位置：统一宽度下内容短的一行会靠左留白，所以默认整体居中。
       内容实际宽度 = 中文 + 间距 + 最长那行英文（已含第二行缩进）。 */
    var contentW = wZh + textGap + maxLineW;
    var startX = BADGE_CENTER_CONTENT
        ? (L.padL + (bw - contentW) / 2)
        : (L.padL + L.badgePadX);
    if (startX < L.padL + L.badgePadX * 0.5) startX = L.padL + L.badgePadX * 0.5;

    /* 垂直对齐：中英文不共用基线，而是「视觉中心对齐」。
       中文字号大、英文小，共用基线会让英文重心明显偏低。
       系数是按实际字形实测的（单位 em）：
         中文（CJK 方块字）视觉中心 ≈ 基线上方 0.40 em
         英文（拉丁字母帽高约 0.76 em）视觉中心 ≈ 基线上方 0.38 em
       换字体后如果觉得偏了，微调这两个数即可。 */
    var base = cy + zhUnits * 0.37;
    var cjkCenter = (zh === "") ? cy : (base - zhUnits * 0.40);

    var bx = startX;
    if (zh !== "") {
        bx = drawMixed(g, zh, bx, base, enFont, zhFont, C_WHITE, C_WHITE, 0);
    }

    /* 英文块（1 行或 2 行）整体对准中文的视觉中心 */
    if (lines.length > 0) {
        var ex = bx + textGap;
        var first = cjkCenter + enUnits * 0.38 - (lines.length - 1) * ls / 2;
        for (var j = 0; j < lines.length; j++) {
            drawTextSheared(g, lines[j], ex + (j > 0 ? indent : 0),
                            first + ls * j, enFont, C_WHITE, shear);
        }
    }

    return bw;
}

/* 生成 n 个空格（用来量缩进宽度） */
function spaces(n) {
    var s = "";
    for (var i = 0; i < n; i++) s += " ";
    return s;
}

/* 带倾斜地画一行文字。
   不用 Font.deriveFont(ITALIC)：JCM 的字体是 Font.createFont 载入的，
   没有斜体面，deriveFont 可能被替换成别的字体甚至不斜。
   这里用 Graphics2D.shear 做剪切变换，任何字体都保证能斜。
   剪切后 (px,py) -> (px - s*py, py)，所以先补偿 x 再画。 */
function drawTextSheared(g, text, x, baseY, font, color, shear) {
    if (text == null || text === "") return;
    g.setFont(font);
    g.setColor(col(color));

    if (shear <= 0) {
        g.drawString(text, px(x), py(baseY));
        return;
    }

    var saved = g.getTransform();
    g.shear(-shear, 0);
    var dx = px(x), dy = py(baseY);
    g.drawString(text, Math.round(dx + shear * dy), Math.round(dy));
    g.setTransform(saved);
}

/* 这段备注是不是单纯的「方向词」？是的话就不当种别用 */
function isDirectionExtra(extra) {
    if (extra == null) return false;
    var t = String(extra).toLowerCase().replace(/\s/g, "");
    if (t === "") return false;
    for (var i = 0; i < SERVICE_IGNORE_EXTRA.length; i++) {
        var k = String(SERVICE_IGNORE_EXTRA[i]).toLowerCase();
        if (k !== "" && t.indexOf(k) >= 0) return true;
    }
    return false;
}

/* 按上面的设定挑出种别文字的来源字符串 */
function serviceLabelSource(arrival) {
    var num = safeStr(arrival.routeNumber()).trim();
    if (num !== "") return num;
    return safeStr(arrival.routeName()).trim();   // 线路号没填才退回名称
}

/* SERVICE_OVERRIDE 的 name 关键字匹配。
   name 可以写字符串（如 "特快"），也可以写数组（如 ["通快", "Com.Rapid"]），
   数组里任意一个在完整路线名里出现就算命中 —— 中英任意一种命名都能认。 */
function matchAnyKeyword(name, text) {
    if (name == null) return false;
    if (typeof name === "string") {
        return name !== "" && text.indexOf(name) >= 0;
    }
    var n = name.length;
    if (n == null) return false;
    for (var i = 0; i < n; i++) {
        var k = String(name[i]);
        if (k !== "" && text.indexOf(k) >= 0) return true;
    }
    return false;
}

/* 按空格把文字折成最多 maxLines 行，优先选最平均的切点。
   availHead / availTail 可以不同（第二行要留缩进的位置）。 */
function wrapWords(g, text, font, availHead, availTail, maxLines) {
    if (text == null || text === "") return [];
    if (availHead <= 0) return [text];
    if (textWidth(g, text, font, font) / T.k <= availHead) return [text];
    if (maxLines < 2) return [text];

    var pts = splitPoints(text);
    if (pts.length === 0) return [text];

    var bestPos = -1, bestScore = -1;
    for (var i = 0; i < pts.length; i++) {
        var head = trimEnd(text.substring(0, pts[i]));
        var tail = trimStart(text.substring(pts[i]));
        if (head === "" || tail === "") continue;
        var wh = textWidth(g, head, font, font) / T.k;
        var wt = textWidth(g, tail, font, font) / T.k;
        if (wh > availHead || wt > availTail) continue;
        var score = Math.min(wh, wt) / Math.max(wh, wt);   // 越接近 1 越平均
        if (score > bestScore) { bestScore = score; bestPos = pts[i]; }
    }
    /* 没有能两边都塞下的切点，就取最靠近中间的，交给后面的自动缩字兜底 */
    if (bestPos < 0) bestPos = pts[Math.floor((pts.length - 1) / 2)];

    return [trimEnd(text.substring(0, bestPos)), trimStart(text.substring(bestPos))];
}

/* 可折行的位置：空格之后，以及英文缩写点之后。
   后者是为了处理 Com.Rapid / Ex.press / Spec.press 这种没有空格的名字，
   折成「Com. / Rapid」「Ex. / press」，和参考图的「Spec. / Rapid」一个样子。 */
function splitPoints(text) {
    var pts = [];
    var s = String(text);
    for (var i = 0; i < s.length - 1; i++) {
        var ch = s.charAt(i);
        if (ch === " ") {
            pts.push(i + 1);
        } else if (ch === "." && s.charAt(i + 1) !== " ") {
            pts.push(i + 1);
        }
    }
    return pts;
}

function trimStart(s) {
    return String(s).replace(/^\s+/, "");
}

function trimEnd(s) {
    return String(s).replace(/\s+$/, "");
}

/* 等比缩放字体（deriveFont(int, float) 无歧义） */
function scaleFont(font, k) {
    var s = font.getSize() * k;
    if (s < 4) s = 4;
    return font.deriveFont(font.getStyle(), s);
}

/* ============================ 停车站线路图 ============================ */

function drawRouteMap(g, state, line, barColor) {
    var F = state.fonts;
    var n = line.stations.length;
    if (n === 0) return;

    var x0 = L.barX0, x1 = L.barX1;
    var step = n === 1 ? 0 : (x1 - x0) / (n - 1);
    var showEn = step > 12.0;
    var minX = L.padL, maxX = DW - L.padR;

    /* 站距太密时隔几站标一次名，避免糊成一片（起讫站始终标注）。
       站名上下交错，所以只有当「每隔奇数站」时同一排才会拉开两倍间距。 */
    var maxNameW = 0;
    for (var i = 0; i < n; i++) {
        var w = textWidth(g, cjkPart(line.stations[i].name), F.stnCjk, F.stnCjk) / T.k;
        if (w > maxNameW) maxNameW = w;
    }
    var need = maxNameW / 1.15;                  // 允许约 15% 的轻微重叠（与参考图一致）
    var labelEvery = 1;
    while (labelEvery < 21) {
        var sameRow = (labelEvery % 2 === 1 ? 2 : 1) * labelEvery * step;
        if (sameRow >= need) break;
        labelEvery += 1;
        if (labelEvery === 2) labelEvery = 3;      // 偶数会落在同一排，直接跳到奇数
    }

    /* 线路条 */
    g.setColor(barColor);
    fRound(g, x0, L.barY - L.barH / 2, x1, L.barY + L.barH / 2, L.barH / 2);

    for (var i = 0; i < n; i++) {
        var st = line.stations[i];
        var cx = x0 + step * i;
        var isMajor = line.majors[st.id] === true;
        var isStop = line.stopsOf[st.id] !== false;

        if (isMajor) {
            /* 大圆点。只有【终点站】闪白灯，起点站不闪。
               注意：Rhino 不允许 if/else 两个分支里出现同名的 const，
               所以这里的分支局部变量必须取不同的名字。 */
            drawTerminalDot(g, cx, L.barY, 1.75, 0.42, barColor, st.id === line.terminusId);
        } else if (isStop) {
            /* 本班车停靠：白点闪烁，一眼看出快车停哪几站 */
            drawStopDot(g, cx, L.barY, 1.0, barColor);
        } else {
            /* 本班车通过：静止灰点 */
            g.setColor(col(C_DOT_OFF));
            fOval(g, cx, L.barY, 1.0, 1.0);
        }

        /* 站名：奇偶上下交错，并夹在屏幕内 */
        var up = (i % 2) === 0;
        if (labelEvery > 1 && (i % labelEvery) !== 0 && !isMajor) continue;

        var zh = cjkPart(st.name);
        var en = nonCjkPart(st.name);
        var wZh = zh === "" ? 0 : textWidth(g, zh, F.stnCjk, F.stnCjk) / T.k;
        var wEn = en === "" ? 0 : textWidth(g, en, F.stnLat, F.stnLat) / T.k;

        drawMixed(g, zh, clamp(cx - wZh / 2, minX, maxX - wZh),
                  up ? L.topCjkBase : L.botCjkBase, F.stnLat, F.stnCjk, C_WHITE, C_WHITE, 0);

        if (showEn && en !== "") {
            drawMixed(g, en, clamp(cx - wEn / 2, minX, maxX - wEn),
                      up ? L.topLatBase : L.botLatBase, F.stnLat, F.stnCjk, C_DIM, C_DIM, 0);
        }

        /* 站名格子的翻牌接缝（停靠站是固定面板，默认 SEAM_ON_ROUTE_MAP = false 不画） */
        var nameW = SEAM_ON_ROUTE_MAP ? Math.max(wZh, wEn) : 0;
        if (nameW > 0) {
            var nx = clamp(cx - nameW / 2, minX, maxX - nameW);
            addSeam(state, nx, nx + nameW,
                    textCellCenter(up ? L.topCjkBase : L.botCjkBase,
                                   L.stnCjkSize, L.stnCjkSize));
            if (showEn && en !== "") {
                addSeam(state, nx, nx + nameW,
                        textCellCenter(up ? L.topLatBase : L.botLatBase,
                                       L.stnLatSize, L.stnLatSize));
            }
        }
    }
}

/* ============================ 线路数据 ============================ */

/* 在所有到站列车里挑一条停车站最多的路线当作「全线」。
   返回 { stations:[{id,name}], stopsOf:{id:bool}, majors:{id:bool} } */
/* 这条路线的站台列表是否包含 stopSet 里的【全部】站台？
   用来判断「这条路线能不能当第一班车的底图」——
   不能的话说明它是另一条线路，拿它当底图会把第一班车的站全标成灰点。 */
function routeCovers(plats, stopSet) {
    var have = {};
    for (var i = 0; i < plats.size(); i++) {
        have["" + plats.get(i).getPlatformId()] = true;
    }
    for (var k in stopSet) {
        if (stopSet[k] === true && have[k] !== true) return false;
    }
    return true;
}

function pickLine(arrivals, state, pids) {
    if (state == null) state = {};
    var all = [];
    for (var i = 0; i < 16; i++) {
        var a = arrivals.get(i);
        if (a == null) break;
        all.push(a);
    }
    if (all.length === 0) return null;

    /* 注意：Rhino 把块内 let/const 当函数级查重，
       所以同一函数内所有局部变量都必须取唯一名字，不能靠块作用域隔离。 */
    /* 第一班车的停靠站台集合。线路图上要标「停靠 / 不停靠」的就是这班车，
       所以底图必须包含这些站台，否则就是【另一条线路】的路线。 */
    var firstRoute = safeRoute(all[0]);
    var stopSet = {};
    var stopCount = 0;
    if (firstRoute != null) {
        var firstPlats0 = firstRoute.getPlatforms();
        if (firstPlats0 != null) {
            for (var i = 0; i < firstPlats0.size(); i++) {
                var pk0 = "" + firstPlats0.get(i).getPlatformId();
                if (stopSet[pk0] !== true) { stopSet[pk0] = true; stopCount++; }
            }
        }
    }

    /* 挑底图：在【包含第一班车全部停靠站台】的路线里，取站数最多的那条。
       ★ 这一条是修多线路串味的关键：
         以前只按「站数最多」挑，两条线路共用一个 PIDS 时会把另一条线路选成底图，
         于是第一班车的站一个都对不上，整张线路图全变成灰点。 */
    var best = null, bestCount = -1;
    for (var i = 0; i < all.length; i++) {
        var candRoute = safeRoute(all[i]);
        if (candRoute == null) continue;
        var candPlats = candRoute.getPlatforms();
        if (candPlats == null) continue;
        var candSize = candPlats.size();
        if (candSize <= bestCount) continue;
        if (stopCount > 0 && !routeCovers(candPlats, stopSet)) continue;   // 另一条线路，跳过
        bestCount = candSize;
        best = candRoute;
    }
    /* 没有任何路线能盖住第一班车的停站（例如只有它自己在跑）-> 就用它自己的路线 */
    if (best == null) best = firstRoute;
    if (best == null) return null;

    var stations = [];
    var seen = {};
    var linePlats = best.getPlatforms();
    for (var i = 0; i < linePlats.size(); i++) {
        var linePlat = linePlats.get(i);
        var platKey = "" + linePlat.getPlatformId();
        if (seen[platKey] === true) continue;
        seen[platKey] = true;
        stations.push({ id: platKey, name: stripExtra(safeStr(linePlat.getStationName())) });
    }

    /* ---- 站点表跨帧累积（只增不减）----
       只按「当前到站列车」推的话，附近只有快车时线路图会缩成快车那条短线。
       所以记住见过的最大线路，之后不再缩水。
       代价：换线路时可能短暂显示旧线路 —— 用「站点 ID 完全不重叠」来兜底复位。 */
    var cached = state.lineStations;
    if (cached != null && cached.length > 0 && stations.length < cached.length) {
        var cacheIds = {};
        for (var i = 0; i < cached.length; i++) cacheIds[cached[i].id] = true;
        /* 只有缓存【仍然包含第一班车全部停靠站台】时才沿用。
           否则说明换到别的线路了，必须复位，不能拿旧线路的站点表硬套。 */
        var cacheOk = true;
        for (var k in stopSet) {
            if (stopSet[k] === true && cacheIds[k] !== true) { cacheOk = false; break; }
        }
        if (cacheOk) stations = cached;
    }
    state.lineStations = stations;

    /* ---- 第一班车在哪些站停车 ----
       stopSet 上面已经按当前数据算好了，这里直接用；
       因为底图保证包含了这些站台，所以不会出现「全是灰点」的情况。 */
    var stopsOf = {};
    for (var i = 0; i < stations.length; i++) {
        stopsOf[stations[i].id] = stopSet[stations[i].id] === true;
    }

    /* 大圆点：只认【整条线路】的首末两站。
       注意不能拿「任一列车的起讫站」——快车路线短，那样会把一堆中间站也点亮。 */
    var majors = {};
    if (stations.length > 0) {
        majors[stations[0].id] = true;
        majors[stations[stations.length - 1].id] = true;
    }

    /* 当前所在车站也用大圆点标出来（不闪灯） */
    var hereId = CURRENT_STATION_MARK ? currentStationId(pids, stations) : null;
    if (hereId != null) majors[hereId] = true;

    /* 「终点站」是哪一个：优先拿第一班车的【目的地】在站点表里找，
       找不到才退回末站。这样区间车（中途折返）也能正确标出它实际的终点。 */
    var terminusId = null;
    if (stations.length > 0) {
        var destCjk = cjkPart(stripExtra(safeStr(all[0].destination())));
        if (destCjk !== "") {
            for (var i = 0; i < stations.length; i++) {
                if (cjkPart(stations[i].name) === destCjk) { terminusId = stations[i].id; break; }
            }
        }
        if (terminusId == null) terminusId = stations[stations.length - 1].id;
    }

    return { stations: stations, stopsOf: stopsOf, majors: majors,
             terminusId: terminusId, hereId: hereId, route: best };
}

function safeRoute(arrival) {
    try {
        return arrival.route();
    } catch (e) {
        return null;
    }
}

/* ============================ 文本绘制 ============================ */
/* 约定：drawMixed(g, 文本, x, 基线y, 拉丁字体, CJK字体, CJK颜色, 拉丁颜色, 尾部间距)
   —— 字体一律「先拉丁后 CJK」，避免写反导致中文变豆腐块。 */

function drawMixed(g, text, x, baseY, latinFont, cjkFont, colorCjk, colorLatin, gap) {
    if (text == null || text === "") return x;
    var c1 = col(colorCjk);
    var c2 = colorLatin == null ? c1 : col(colorLatin);
    var rs = splitRuns(text, latinFont, cjkFont);
    var cx = x;
    for (var i = 0; i < rs.length; i++) {
        var w = runWidth(g, rs[i]) / T.k;
        g.setFont(rs[i].font);
        g.setColor(rs[i].cjk ? c1 : c2);
        g.drawString(rs[i].text, px(cx), py(baseY));
        cx += w;
    }
    return cx + (gap || 0);
}

function drawMixedCentered(g, zh, en, centerX, baseY, latinFont, cjkFont, colorCjk, colorLatin, gap) {
    var w = mixedWidth(g, zh, en, latinFont, cjkFont, gap);
    var startX = centerX - w / 2;
    var wZh = zh === "" ? 0 : textWidth(g, zh, cjkFont, cjkFont) / T.k;
    drawMixed(g, zh, startX, baseY, latinFont, cjkFont, colorCjk, colorCjk, 0);
    if (en !== "") {
        drawMixed(g, en, startX + wZh + (gap || 0), baseY, latinFont, cjkFont, colorLatin, colorLatin, 0);
    }
}

function drawMixedRight(g, zh, en, rightX, baseY, latinFont, cjkFont, colorCjk, colorLatin, gap) {
    var w = mixedWidth(g, zh, en, latinFont, cjkFont, gap);
    var startX = rightX - w;
    var wZh = zh === "" ? 0 : textWidth(g, zh, cjkFont, cjkFont) / T.k;
    drawMixed(g, zh, startX, baseY, latinFont, cjkFont, colorCjk, colorCjk, 0);
    if (en !== "") {
        drawMixed(g, en, startX + wZh + (gap || 0), baseY, latinFont, cjkFont, colorLatin, colorLatin, 0);
    }
}

function mixedWidth(g, zh, en, latinFont, cjkFont, gap) {
    var w = 0;
    if (zh != null && zh !== "") w += textWidth(g, zh, cjkFont, cjkFont) / T.k;
    if (en != null && en !== "") {
        if (zh != null && zh !== "") w += (gap || 0);
        w += textWidth(g, en, latinFont, latinFont) / T.k;
    }
    return w;
}

function drawCentered(g, text, centerX, baseY, font, color) {
    var w = textWidth(g, text, font, font) / T.k;
    drawMixed(g, text, centerX - w / 2, baseY, font, font, color, color, 0);
}

function textWidth(g, text, latinFont, cjkFont) {
    if (text == null || text === "") return 0;
    var rs = splitRuns(text, latinFont, cjkFont);
    var w = 0;
    for (var i = 0; i < rs.length; i++) w += runWidth(g, rs[i]);
    return w;
}

function runWidth(g, run) {
    g.setFont(run.font);
    return g.getFontMetrics(run.font).stringWidth(run.text);
}

/* 按 CJK / 非 CJK 切段 */
function splitRuns(text, latinFont, cjkFont) {
    var out = [];
    if (text == null || text === "") return out;
    var cur = null, curCjk = false, buf = "";
    for (var i = 0; i < text.length; i++) {
        var ch = text.charAt(i);
        var cjk = isCjk(ch) && cjkFont != null;
        var f = cjk ? cjkFont : latinFont;
        if (cur == null || f !== cur) {
            if (buf !== "") out.push({ text: buf, font: cur, cjk: curCjk });
            cur = f; curCjk = cjk; buf = "";
        }
        buf += ch;
    }
    if (buf !== "") out.push({ text: buf, font: cur, cjk: curCjk });
    return out;
}

function isCjk(ch) {
    var c = ch.charCodeAt(0);
    return (c >= 0x2E80 && c <= 0x9FFF) ||
           (c >= 0x3400 && c <= 0x4DBF) ||
           (c >= 0xF900 && c <= 0xFAFF) ||
           (c >= 0xFE30 && c <= 0xFE4F) ||
           (c >= 0xFF00 && c <= 0xFF60) ||
           (c >= 0x3000 && c <= 0x303F);
}

/* ============================ 图形绘制（设备像素） ============================ */

function px(x) { return Math.round(x * T.k + T.ox); }
function py(y) { return Math.round(y * T.k + T.oy); }

function fRect(g, x0, y0, x1, y1) {
    var a = px(x0), b = py(y0), c = px(x1), d = py(y1);
    g.fillRect(a, b, Math.max(1, c - a), Math.max(1, d - b));
}

function fRound(g, x0, y0, x1, y1, rad) {
    if (rad <= 0) {                       // 直角就画普通矩形，省一次圆角光栅化
        fRect(g, x0, y0, x1, y1);
        return;
    }
    var a = px(x0), b = py(y0), c = px(x1), d = py(y1);
    var arc = Math.max(1, Math.round(rad * 2 * T.k));
    g.fillRoundRect(a, b, Math.max(1, c - a), Math.max(1, d - b), arc, arc);
}

function fOval(g, cx, cy, rx, ry) {
    var a = px(cx - rx), b = py(cy - ry), c = px(cx + rx), d = py(cy + ry);
    g.fillOval(a, b, Math.max(1, c - a), Math.max(1, d - b));
}

function dashedFrame(g, x0, y0, x1, y1) {
    var t = L.frameThick, dash = 2.2, gap = 1.6;
    g.setColor(col(C_FRAME));
    /* 同理：四段边线的局部变量必须各自取名 */
    var p = x0;
    while (p < x1) { var dTop = Math.min(dash, x1 - p); fRect(g, p, y0, p + dTop, y0 + t); p += dash + gap; }
    p = x0;
    while (p < x1) { var dBot = Math.min(dash, x1 - p); fRect(g, p, y1 - t, p + dBot, y1); p += dash + gap; }
    p = y0;
    while (p < y1) { var dLeft = Math.min(dash, y1 - p); fRect(g, x0, p, x0 + t, p + dLeft); p += dash + gap; }
    p = y0;
    while (p < y1) { var dRight = Math.min(dash, y1 - p); fRect(g, x1 - t, p, x1, p + dRight); p += dash + gap; }
}

/* ============================ 字体 ============================ */

function mk(base, style, size) {
    return base.deriveFont(style, size * T.k);
}

function makeFonts() {
    var cjk  = sysFont(F_CJK);
    var lat  = sysFont(F_LATIN);
    var mono = sysFont(F_MONO);
    var B = Font.BOLD, P = Font.PLAIN;
    return {
        titleCjk:    mk(cjk,  B, L.titleCjkSize),
        titleLat:    mk(lat,  B, L.titleLatSize),
        col:         mk(lat,  P, L.colLatSize),   // 表头拉丁字比中文小一号（与参考图一致）
        colCjk:      mk(cjk,  P, L.colSize),
        badge:       mk(cjk,  B, BADGE_CJK_SIZE),   // 三行徽章共用这套字号
        badgeEn:     mk(lat,  B, BADGE_EN_SIZE),
        destCjkBig:  mk(cjk,  B, 5.40),
        destLatBig:  mk(lat,  P, 3.10),
        destCjk:     mk(cjk,  B, 4.00),
        destLat:     mk(lat,  P, 2.40),
        platBig:     mk(lat,  B, 3.40),
        plat:        mk(lat,  B, 2.70),
        timeNumBig:  mk(lat,  B, 5.60),
        timeUnitBig: mk(lat,  B, 3.20),
        unitCjkBig:  mk(cjk,  B, 3.20),
        timeNum:     mk(lat,  B, 4.30),
        timeUnit:    mk(lat,  B, 2.60),
        unitCjk:     mk(cjk,  B, 2.60),
        clockBig:    mk(mono, B, 5.00),
        clock:       mk(mono, B, 4.00),
        stnCjk:      mk(cjk,  B, L.stnCjkSize),
        stnLat:      mk(lat,  P, L.stnLatSize)
    };
}

function sysFont(name) {
    var f = null;
    try { f = Resources.getSystemFont(name); } catch (e) { f = null; }
    if (f == null) {
        try { f = Resources.getSystemFont("Noto Sans CJK TC Medium"); } catch (e2) { f = null; }
    }
    if (f == null) f = new Font("SansSerif", Font.PLAIN, 12);
    return f;
}

/* ============================ 杂项 ============================ */

/* 注意：不要用 new Color(r, g, b)！
   java.awt.Color 同时存在 Color(int,int,int) 与 Color(float,float,float)，
   Rhino 会解析到 float 那个重载，传 0-255 的整数就会抛
   “Color parameter outside of expected range”。
   单参数的 Color(int rgb) 是唯一的一参 int 构造，没有歧义，所以统一走它。 */
function col(rgb) {
    return new Color((rgb[0] << 16) | (rgb[1] << 8) | rgb[2]);
}

/* MTR 路线颜色本身就是 0xRRGGBB 整数 */
function intColor(v, fallback) {
    var n = Number(v);
    if (!isFinite(n) || n < 0) return col(fallback);
    var rgb = Math.floor(n) & 0xFFFFFF;
    if (rgb === 0) return col(fallback);
    return new Color(rgb);
}

/* 按 BAR_COLOR_FROM / PLATFORM_COLOR_FROM 的设定取色。
   arrival 是要取色的那班车，line 是「全线」路线，svc 是 resolveService 的结果。 */
function pickColor(from, arrival, line, svc, fallback) {
    if (from === "service" && svc != null && svc.color != null) {
        return new Color(svc.color);
    }
    if (from === "line" || from === "service") {
        if (line != null && line.route != null) {
            return intColor(line.route.getColor(), fallback);
        }
    }
    if (from !== "fixed" && arrival != null) {
        return intColor(arrival.routeColor(), fallback);
    }
    if (from === "line" && line != null && line.route != null) {
        return intColor(line.route.getColor(), fallback);
    }
    return col(fallback);
}

/* 把 "453EA5" 这类十六进制字符串转成 Color 能吃的整数 */
function parseHex(s) {
    var t = String(s).replace("#", "").replace(/\s/g, "");
    var n = parseInt(t, 16);
    if (!isFinite(n)) return 0;
    return n & 0xFFFFFF;
}

/* 决定这一班车的种别（快慢车）：
     1. 先在 SERVICE_OVERRIDE 表里按顺序找，命中就用表里的文字/颜色
     2. 路线名里 || 后面的备注（MTR 官方推荐的快慢车写法）→ 用它当种别
     3. 都没有就用路线名称（按 | 拆中英）
     4. 名称也没有就退回路线号码，再没有就写「各停 Local」
   注意：徽章底色一律取 MTR 路线颜色（MTR 就是按颜色把路线归成一条线路的），
        只有 SERVICE_OVERRIDE 里显式写了 color 才会覆盖。 */
function resolveService(arrival) {
    var name = safeStr(arrival.routeName());
    var full = serviceLabelSource(arrival);
    var base = stripExtra(full);
    var extra = extraPart(full).trim();
    /* 上下行方向词不是车种：先剥掉，映射表和后面都当它不存在 */
    if (isDirectionExtra(extra)) extra = "";
    var num = safeStr(arrival.routeNumber()).replace(/\s/g, "");

    /* 关键字在「名称」和「线路号」两个框里都找一遍，填哪个都能命中 */
    var haystack = name + "|" + safeStr(arrival.routeNumber());

    for (var i = 0; i < SERVICE_OVERRIDE.length; i++) {
        var rule = SERVICE_OVERRIDE[i];
        var hit = false;

        if (rule.number != null && String(rule.number) !== "" && String(rule.number) === num) {
            hit = true;
        }
        if (!hit && matchAnyKeyword(rule.name, haystack)) {
            hit = true;
        }
        if (!hit) continue;

        var rz = rule.zh != null ? String(rule.zh) : cjkPart(extra);
        var re = rule.en != null ? String(rule.en) : nonCjkPart(extra);
        if (rz === "" && re === "") { rz = cjkPart(base); re = nonCjkPart(base); }
        var rc = rule.color != null ? parseHex(rule.color) : null;
        return { zh: rz, en: re, color: rc };
    }

    /* || 后面的备注优先当种别（例：花越线|Hana Line||快速|Rapid） */
    if (extra !== "") {
        var ez = cjkPart(extra);
        var ee = nonCjkPart(extra);
        if (ez !== "" || ee !== "") return { zh: ez, en: ee, color: null };
    }

    var zh = cjkPart(base);
    var en = nonCjkPart(base);
    if (zh === "" && en === "") {
        zh = cjkPart(num);
        en = nonCjkPart(num);
    }
    if (zh === "" && en === "") {
        zh = "各停";
        en = "Local";
    }
    return { zh: zh, en: en, color: null };
}

function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

function splitName(name) {
    var base = stripExtra(name);
    return { cjk: cjkPart(base), latin: nonCjkPart(base) };
}

/* MTR 的名字格式：中文|English||备注
   · 单个 | 分隔语言
   · 双竖线 || 后面是「备注」，MTR 的牌子不显示它，只在仪表板里看得到
     （官方 wiki: "Grouping Routes"）
   所以车站名/目的地要先剥掉备注，而种别徽章反而正好可以用备注来当快慢车。 */
function stripExtra(s) {
    if (s == null) return "";
    var t = String(s);
    var i = t.indexOf("||");
    return i < 0 ? t : t.substring(0, i);
}

function extraPart(s) {
    if (s == null) return "";
    var t = String(s);
    var i = t.indexOf("||");
    return i < 0 ? "" : t.substring(i + 2);
}

function cjkPart(s) {
    if (s == null) return "";
    var parts = String(s).split("|");
    for (var i = 0; i < parts.length; i++) {
        if (containsCjk(parts[i])) return parts[i].trim();
    }
    return "";
}

function nonCjkPart(s) {
    if (s == null) return "";
    var parts = String(s).split("|");
    for (var i = 0; i < parts.length; i++) {
        if (!containsCjk(parts[i]) && parts[i].trim() !== "") return parts[i].trim();
    }
    return "";
}

function containsCjk(s) {
    for (var i = 0; i < s.length; i++) if (isCjk(s.charAt(i))) return true;
    return false;
}

function extractPlatformNo(name) {
    var m = String(name).match(/[0-9]+/);
    if (m != null) return m[0];
    var p = String(name).split("|");
    return p[0] === "" ? "-" : p[0];
}

function pad2(n) {
    return (n < 10 ? "0" : "") + n;
}

function nowMs() {
    try { return Timing.currentTimeMillis(); } catch (e) { return new Date().getTime(); }
}

function safeStr(s) {
    return s == null ? "" : String(s);
}

/* Java 的 long 在脚本里可能仍是包装对象，统一转成 JS number */
function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
}
