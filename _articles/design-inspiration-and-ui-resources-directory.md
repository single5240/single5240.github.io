---
layout: article
title: "UI/UX 与视觉设计资源整理：网页画廊、组件系统、动效与品牌规范"
description: "整理 88 个常用 UI/UX 与视觉设计参考站点，按网页画廊、页面区块与组件系统、App 交互录屏、品牌规范与演示文稿、日常灵感订阅以及渐变字体素材六类归档。"
date: 2026-11-15
category: UI 与设计资源
tags:
  - UI/UX
  - 设计灵感
  - 设计系统
  - 品牌规范
  - 动效设计
  - 前端素材
---

做页面或改版时，在综合大图库里漫无目的地翻瀑布流往往很耗时间：概念稿很多，真到需要查导航栏折叠方式、首屏信息比例、设计系统里下拉组件怎么命名，或者品牌手册怎么搭目录时，反而不好找可直接对照的真实样本。

更省事的做法是用垂直站点按环节查：只收导航栏的画廊、录真实 App 60fps 动效的视频库、收企业官方品牌规范的目录，各管一摊。下面整理了 88 个设计参考与前端素材站点，分成六大类；每类第一小节是平时最常打开的 15 个基础书签，后面接着按场景补充的同类资源。

## 快速分类索引表

按手头正在处理的环节，可以从下表直接定位：

| 当前需求 | 常用基础站 | 同类补充 |
| :--- | :--- | :--- |
| 定网页整体基调与版式 | Minimal Gallery、A1 Gallery、One Page Love | Curated.design、Land-book、Saaspo、Dark.design |
| 拆解首屏、导航、页脚等区块 | Supahero、Navbar Gallery | Footer.design、BentoGrids、CTA.gallery、Landingfolio |
| 查组件规范与前端实现 | Component Gallery | Design Systems Surf、shadcn/ui、Radix UI、21st.dev |
| 看移动端/Web 交互流与动效 | 60fps.design | Mobbin、Page Flows、Refero、Design Spells、Codrops |
| 做品牌升级、Logo 与汇报 Deck | Rebrand Gallery、Brand Guidelines、Logobook、Deck Gallery | Branding Style Guides、Brand Archive、Brand New、LogoArchive |
| 看日常设计动态与社媒图文 | Recent Design、Posts Design | Layers.to、Savee、Cosmos、Are.na、Sidebar |
| 找动态渐变、字体、图标与买断素材 | Grainient、YouWorkForThem | ShaderGradient、Fontshare、UNCUT.wtf、SVGL、Lucide |

## 网页灵感画廊与落地页

做产品官网、个人主页或活动落地页前，先要确定信息密度、网格比例和整体色调。这一类网站专门收集已经上线的真实网页，适合前期找版式基准。

### 极简、单页与综合网页画廊

- **[Minimal Gallery](https://minimal.gallery/)**：专门收集极简风格网页的老牌画廊。站内收录的大多靠留白、字体层级和网格秩序撑起页面，很少堆砌特效，同时也整理了一批 Framer 和 Webflow 模板，做轻量产品页或个人作品集时很好参考。
- **[A1 Gallery](https://a1.gallery/)**：更新频率很高的综合网页画廊，分类非常细，按 Landing、Portfolio、AI、Studio、SaaS、E-commerce 等标签就能直接筛，适合按业务方向快速翻一遍同行做法。
- **[One Page Love](https://onepagelove.com/)**：长期专注单页网站（One-Page）与落地页的目录。除了按行业看简历、活动页和小型 SaaS 发布页案例，还有 Bento 布局等专题合集和单页模板索引。

### 其他网页画廊补充

- **[Curated.design](https://curated.design/)**：支持风格标签和页面区块双维度筛选，可以用 `⌘K` 快捷键检索，除了 Minimal、Dark、Brutalist、Gradients 等风格，也能直接按 Hero、Pricing、Footer 局部查找。
- **[Land-book](https://land-book.com/)**：偏重商业落地页和营销官网，收录站点普遍把产品卖点、用户背书和转化入口排得很清楚，适合做实用型 SaaS 或独立产品官网时对照。
- **[Saaspo](https://www.saaspo.com/)**：专攻 SaaS 与科技产品官网，最大特点是按子页面类型归类，除了首页，还能单独翻定价页（Pricing）、功能页（Product）、集成页（Integrations）和关于页（About）。
- **[Dead Simple Sites](https://deadsimplesites.com/)**：比 Minimal Gallery 更克制，专收彻底去掉滚动劫持和装饰动画、只用排版和留白表达信息的网页，页面做得太满时适合翻一翻减减负。
- **[Dark.design](https://www.dark.design/)**：只收暗色模式网页的垂直画廊。做开发者工具、AI 基础设施或硬件产品页面时，用它参考深灰层级与边框高光处理比综合站快得多。
- **[Lapa Ninja](https://www.lapa.ninja/)**：长期维护的落地页长截图库，每条案例直接展示整页纵向结构，方便顺着看页面从头到尾的节奏，站内也附带免费图标和配色整理。
- **[SiteInspire](https://www.siteinspire.com/)** 与 **[Seesaw](https://seesaw.website/)**：SiteInspire 运营多年，偏出版物和设计工作室调性，交叉筛选维度多；Seesaw 每日更新数字体验案例，支持按网页使用的字体反查站点。
- **[Awwwards](https://www.awwwards.com/)** 与 **[The FWA](https://thefwa.com/)**：偏向创意与交互上限的评审榜单，用来了解 WebGL、3D 渲染和品牌互动站的做法很合适，做常规工具官网时注意控制工程复杂度。

## 页面区块与 UI 组件系统

整站方向定下来之后，具体画页面常卡在局部：导航栏链接太多怎么收、首屏 Hero 图文怎么摆、同一个下拉选择器在不同设计系统里到底叫 `Combobox` 还是 `Select`。下面这组站用来查局部结构和代码参考。

### 首屏、导航与跨系统组件档案

- **[Supahero](https://supahero.io/)**：只收集网站首屏（Above-the-fold Hero 区）的灵感库，与移动端界面库 Screens Design 同源。把大标题字号比例、副标题长度、按钮数量和右侧配图放在一起横向比较时很直观。
- **[Navbar Gallery](https://navbar.gallery/)**：专门拆解网页导航的垂直站，覆盖顶部导航栏、Mega Menu 大型下拉菜单、侧边栏和顶部公告条，支持按结构形式、风格和 Framer / Webflow 技术栈筛选。
- **[The Component Gallery](https://component.gallery/)**：跨设计系统的 UI 组件目录，把 Shopify Polaris、Ant Design、Atlassian Design System、Elastic UI 等几十套设计系统的 Modal、Dropdown、Tabs、Combobox、Badge 等组件按类别聚在一起。能直接对比各家命名差异（比如叫 Tag、Chip 还是 Lozenge），每套系统还标出了 React/Vue/Web Components 技术栈、开源协议、无障碍支持以及官方文档、GitHub 和 Storybook 入口。

### 其余页面区块与前端组件生态

- **[Footer.design](https://footer.design/)**：与 Navbar Gallery 刚好配对，专收网页页脚设计，里面按暗色页脚、极简页脚和 Bento 网格页脚分好了类。
- **[BentoGrids](https://bentogrids.com/)**：收集“便当盒（Bento Box）”不对称网格布局的画廊，做产品特性九宫格、硬件参数概览或数据卡片墙时，可直接借鉴网格的尺寸比例。
- **[CTA.gallery](https://cta.gallery/)**：专收行动号召（Call-to-Action）区块的小站，适合推敲页尾转化栏的文案、按钮对比度和配图安排。
- **[Landingfolio](https://www.landingfolio.com/)**：把官网拆成 Hero、Features、Pricing、FAQ、Testimonials 等独立区块来展示，部分区块自带现成的 Tailwind CSS 或 Webflow 代码片段。
- **[Design Systems Surf](https://designsystems.surf/)** 与 **[Design Systems Repo](https://designsystemsrepo.com/)**：想从整体了解各家设计系统的 Design Token 分层、色阶命名和文档组织方式，可以和 Component Gallery 搭着用。
- **可直接落地的代码组件库**：
  - **[Radix UI](https://www.radix-ui.com/)**：无样式的底层 React 交互原语（Dialog、Popover、Dropdown 等），键盘导航和 WAI-ARIA 无障碍处理做得很完整。
  - **[shadcn/ui](https://ui.shadcn.com/)**：基于 Radix UI 和 Tailwind CSS 的源码复制式组件集合，不用受制于黑盒 npm 依赖，目前很多 React 项目直接拿它当起点。
  - **[21st.dev](https://21st.dev/)**：面向 React / Next.js / Tailwind 的开源区块与交互组件注册表，支持按 Hero、Bento、Carousel 等直接复制或用 CLI 接入。
  - **[Aceternity UI](https://ui.aceternity.com/)**、**[Magic UI](https://magicui.design/)**、**[React Bits](https://reactbits.dev/)** 与 **[Uiverse](https://uiverse.io/)**：前三个偏动效区块和背景效果（粒子、光束、文字动画、Shader 等），Uiverse 则是社区整理的纯 CSS / Tailwind 按钮、加载态和开关零件库。

## App 交互流与微动效

静态截图只能看清版式，点下去之后的弹性阻尼、转场方式，以及从新手引导到付费订阅的完整页面流转，还是得看录屏和动效库。

### 真实 App 动效录屏

- **[60fps.design](https://60fps.design/)**：专门录制主流上线 App（如 ChatGPT、Duolingo、X 等）真实高帧率界面动效的库，按应用名称和交互类型（转场、手势、卡片展开、加载反馈）分类。调动画曲线拿不准时，直接扒一帧成熟产品的弹出和回弹节奏比空想省事。

### 用户旅程录屏与动效实现工具

- **[Mobbin](https://mobbin.com/)**：覆盖 iOS、Android 与 Web 端大量真实产品的 UI/UX 截图和流程数据库。画原型前想对照几十款产品怎么处理注册引导（Onboarding）、权限弹窗、空状态、付费墙或深色模式，按 Flows 或 Patterns 搜一遍基本都有样本。
- **[Page Flows](https://pageflows.com/)**：老牌完整用户旅程录屏站（原专注于移动端的 Screenlane 已并入这里），按“完成某项具体任务”来归档操作录像，能看清每一步点击前后的跳转和提示。
- **[Refero](https://refero.design/)**：偏重 Web 应用与 SaaS 界面的参考库，筛选粒度细，能直接搜 404 页面、定价表、侧边栏、空状态和表格过滤条。
- **[ScreensDesign](https://screensdesign.com/)**：主打高营收 iOS 应用的界面与订阅流拆解，每款应用旁会附带大致营收量级，研究付费墙（Paywall）和订阅转化流程时很有参考价值。
- **[Design Spells](https://designspells.com/)**：专门收集产品里的微交互反馈、物理回弹、有意思的加载动画和 404 彩蛋，全用短 GIF 或视频展示，缺交互点子时适合翻一翻。
- **[Codrops](https://tympanus.net/codrops/)**：老牌前端实验动效阵地，大部分页面滚动、Shader 扭曲和 WebGL 转场文章都附带可运行的开源代码仓库。
- **[Eyecandy](https://eyecannndy.com/)**：做产品宣传视频或动态视觉时用得上，把大量成片按运镜手法（Match Cut、Snorricam、Datamosh 等）和动画风格切成了短片段。
- **常用动效落地工具**：Web 代码侧可以用 **[Motion（motion.dev）](https://motion.dev/)** 写声明式弹簧交互；需要跨端状态机驱动的矢量交互（如开关动画、交互插画）可以用 **[Rive](https://rive.app/)**；把 Figma 稿快速做成演示短片或轻量 Lottie，可以用 **[Jitter](https://jitter.video/)** 和 **[Lottielab](https://www.lottielab.com/)**。

## 品牌重塑、规范手册与演示文稿

做品牌改版、开源项目视觉包装或对外汇报 PPT 时，只盯着单个 Logo 不够，图形规律、规范手册目录、品牌发布动效和幻灯片版式往往要成套考虑。

### 品牌规范、重塑案例、Logo 与 Deck

- **[Logobook](https://logobook.com/)**：经典的单色标志与几何符号档案馆，界面很干净，支持按首字母、基础几何形（圆、方、三角、线条等）和行业分类浏览，找图形抽象思路或负空间构图时很好用。
- **[Brand Guidelines](https://brandguidelines.net/)**：收录各国企业官方品牌规范文档的目录（包含 Twitch、Instacart、Asana 等），涵盖网页版规范、PDF 手册和 Figma 指南文件。需要自己写一份 Brand Book 时，照着上面的章节结构、网格安全区和禁用示例搭骨架不容易漏项。
- **[Rebrand Gallery](https://rebrand.gallery/)**：专门收集品牌焕新与视觉重塑（Rebrand）案例，除了看新旧标志变化，站内收了很多品牌升级 Reveal 视频与动态识别（Motion Branding），能直接看整套字体、3D 质感和配乐怎么配合。
- **[Deck Gallery](https://deck.gallery/)**：高质量演示文稿和品牌指南滑片库，里面能翻到 Opera、Linear、OpenAI 等团队的品牌指南与产品汇报页面，做重要演示或融资 Deck 前对照排版节奏很有帮助。

### 品牌史料、改版评论与路演模板

- **[Branding Style Guides](https://brandingstyleguides.com/)**：和 Brand Guidelines 互补的老牌免费目录，存了大量跨国企业、高校、机构和公共部门的原始 PDF 品牌规范手册。
- **[Standards Manual](https://standardsmanual.com/)**：专门复刻出版历史经典视觉规范手册（如 NASA 图形标准手册、纽约地铁导向标识系统）的独立出版方，想看工业级标识规范如何细化到网格和用色标准时可以看它。
- **[Brand New（UnderConsideration）](https://www.underconsideration.com/brandnew/)**：长期关注商业机构和品牌改版的评论站点，每篇都会放新旧标志对比和延展物料点评，能顺便学习从哪些维度评估一次改版。
- **[Brand Archive](https://www.brandarchive.xyz/)**：偏深度归档的品牌案例库，每条案例会尽量收齐艺术指导、用字、色板和大量应用物料，比只放几张效果图更完整。
- **[LogoArchive](https://www.logo-archive.org/)** 与 **[Logggos](https://www.logggos.club/)**：LogoArchive 偏二十世纪中叶现代主义符号史料，支持以图搜相似造型（Discover Similar）和建灵感板；Logggos 偏现代数字和科技初创标志，可以按衬线、无衬线、等宽、手写等字标类型筛选。
- **[BP&O](https://bpando.org/)** 与 **[The Brand Identity](https://the-brandidentity.com/)**：两家独立品牌与包装设计媒体，补实体包装、印刷工艺、纸张和设计工作室访谈很合适。
- **[Pitch Deck Hunt](https://www.pitchdeckhunt.com/)** 与 **[Pitch Templates](https://pitch.com/templates)**：前者归档了不同融资轮次的创业公司真实路演文档，后者提供现成的协作式演示模板，可和 Deck Gallery 搭配使用。

## 日常设计订阅与灵感收集

除了带着明确问题去垂直站检索，平时也需要一些噪音少、不用被算法推着走的订阅源和收藏工具。

### 每日精选与真实社媒设计墙

- **[Recent Design](https://recent.design/)**：每日人工筛选更新的设计聚合站（原人气网页画廊 Godly 迁移演进后的新站点），主要从 X/Twitter 收录一线设计师、Design Engineer 和独立开发者发出的真实网页、交互动画和视觉实验，人工筛掉水帖并保留原作者链接。
- **[Posts Design](https://posts.design/)**：每日更新的社交媒体产品配图库。它不收整站截图，专收科技团队在 X/Twitter 和 LinkedIn 上实际发过的发布卡片、数据里程碑海报、版本更新截图和 OG 分享图（比如 Vercel、Linear、Perplexity 等），做开源项目发版配图时很实用。

### 新生代社区、情绪板与晨读源

- **[Layers.to](https://layers.to/)**：面向数字产品和界面设计师的作品社区，以真实移动端组件和网页微创新为主，少见早年平台那种脱离落地的“飞机稿”。
- **[Savee](https://savee.it/)** 与 **[Cosmos](https://www.cosmos.so/)**：很多视觉和产品设计师用来替代传统图站的个人收藏工具，界面克制、广告少，平时刷到合适的参考可以直接按项目收进灵感板（Moodboard）。
- **[Are.na](https://www.are.na/)**：没有点赞排行和流量推荐的跨媒介收集工具，适合做长期专题调研，比如集中整理某个年代的排版、工业仪表界面或装置参考。
- **[Sidebar](https://sidebar.io/)** 与 **[Muzli](https://muz.li/)**：Sidebar 每个工作日精选 5 篇 UI/UX 与前端文章或工具，适合顺手扫一眼；Muzli 是浏览器新标签页插件，能把多家设计源聚合在一个页面里。
- **[Dribbble](https://dribbble.com/)** 与 **[Behance](https://www.behance.net/)**：老牌综合平台现在更适合当补充：看局部视觉、插画和配色去 Dribbble，看带调研、线框和推导过程的长案例去 Behance。

## 渐变背景、字体与图形素材

结构定好之后，实际出图或写页面常缺三样东西：耐看的背景渐变或噪点纹理、气质合适且授权明确的字体，以及干净的矢量图标和样机素材。

### 渐变 Shader 与买断制综合素材店

- **[Grainient](https://grainient.supply/)**：专做颗粒感（Grainy）和渐变背景的素材站，除了上千张高分辨率噪点渐变与动态渐变背景，还自带在线 Shader 渐变调参工具，给深色或浅色 SaaS 首屏、卡片背景加一层克制的胶片噪点时用着顺手。
- **[YouWorkForThem](https://www.youworkforthem.com/)**：运营多年的独立字体与视觉素材商店，主打透明单次买断，不绑月度订阅，对小团队和独立开发者比较友好。站内既有辨识度很高的商业字体（比如设计视频里常见的几何科技风字体 Axicode），也有不少 Y2K 矢量形状包、抽象 3D、胶片纹理和样机模板。

### Shader 工具、配色、字体与图标补充

- **渐变、Shader 与 SVG 背景生成器**：
  - **[ShaderGradient](https://shadergradient.co/)**：在线实时调节 3D 流动网格渐变的光照、噪点和动画速度，可以直接导出 React 或 Framer 组件嵌入网页。
  - **[Mesh Gradient](https://meshgradient.com/)**：基于 WebGL 的网格渐变编辑器，支持增删和拖拽色彩控制点生成流体背景。
  - **[Haikei](https://haikei.app/)**：浏览器端 SVG 背景生成器，能生成分层波浪、有机流体 Blob、模糊渐变、低多边形网格等矢量图，直接复制 SVG 代码放进页面。
  - **[CSS Gradient](https://cssgradient.io/)** 与 **[uiGradients](https://uigradients.com/)**：只需要轻量、零 JS 开销的线性或径向 CSS 渐变代码时，直接从这里取色值最快。
- **配色与原型预览**：
  - **[Coolors](https://coolors.co/)**：常用的极速色板生成器，带 WCAG 对比度检测和从图片提取配色功能。
  - **[Realtime Colors](https://www.realtimecolors.com/)**：独立开发者 Juxtopposed 做的在线预览工具，可以把选好的主色、辅色和字体直接套进一套完整网页原型里实时看效果，对比度或层次违和一眼就能发现。
- **免费商用与独立商业字体**：
  - **[Fontshare](https://www.fontshare.com/)**：印度字体厂 ITF 推出的免费商用字体服务，收录了一批成熟的无衬线和展示字体（如 Satoshi、Cabinet Grotesk、Clash Display 等），日常网页和品牌测试很够用。
  - **[UNCUT.wtf](https://uncut.wtf/)** 与 **[Free Faces](https://www.freefaces.gallery/)**：前者偏当代实验和设计感较强的免费字体，后者按标题、无衬线、衬线、等宽整理全网可免费授权的字体。
  - **[Velvetyne](https://velvetyne.fr/)**：法国开源实验字体厂，标题字体张力很强，适合活动海报或视觉实验主标题。
  - **[Pangram Pangram](https://pangrampangram.com/)**：很受欢迎的当代独立商业字体厂，绝大多数字体都提供免费个人试用版，方便先在设计稿里上屏确认，项目商用再按授权购买。
  - **[Fonts In Use](https://fontsinuse.com/)** 与 **[Typewolf](https://www.typewolf.com/)**：拿不准两款字体搭在一起什么效果，可以去 Fonts In Use 查它们在海报、书籍和品牌里的真实印刷案例，或看 Typewolf 的网站用字拆解与搭配清单。
- **前端 SVG 图标与 CSS 变量预设**：
  - **[Lucide](https://lucide.dev/)** 与 **[Phosphor Icons](https://phosphoricons.com/)**：现代 Web 应用里很常见的两套开源图标库；Lucide 线条统一、Tree-shaking 友好，Phosphor 提供 6 种字重（含双色 Duotone）。
  - **[SVGL](https://svgl.app/)** 与 **[Simple Icons](https://simpleicons.org/)**：做技术主页或产品集成列表时，直接在这里拿主流软件、编程语言、框架和品牌的标准 SVG 徽标。
  - **[Open Props](https://open-props.style/)**：一组原子级 CSS 变量（Custom Properties）预设，封装好了渐变、阴影、缓动曲线、圆角和排版阶梯，不引入重型框架也能保持一致的样式尺度。
- **样机与独立设计套件补充**：
  - **[Craftwork](https://craftwork.design/)** 与 **[LS Graphics](https://www.ls.graphics/)**：除了 YouWorkForThem 之外，如果需要高质量设备样机（Mockup）、3D 抽象元素或 UI 套件，这两家的出品也很稳定。

## 不同场景下的组合用法

书签攒多了容易闲置，按任务阶段挑 4 到 5 个站串成固定路径会顺手很多：

1. **从零做一个独立产品或开源项目官网**：
   先在 `A1 Gallery` / `Minimal Gallery` / `Saaspo` 找 2 个对标版式；用 `Supahero`、`Navbar Gallery` 和 `Footer.design` 分别定好首屏、导航与页脚结构；到 `Realtime Colors` + `Fontshare` 敲定配色与字体，有需要再用 `Grainient` 或 `ShaderGradient` 补一层背景氛围；开发用 `shadcn/ui` + `21st.dev` + `Lucide` + `SVGL`；发版时对照 `Posts Design` 做一张发布配图发社交媒体。
2. **做移动端 App 改版或复杂 Web 交互优化**：
   先在 `Mobbin` / `Page Flows` 摸清同类产品的完整状态流（包括空状态和报错提示）；再上 `60fps.design` 和 `Design Spells` 看具体转场节奏与微反馈细节；然后去 `Component Gallery` 核对成熟设计系统的组件命名和键盘/无障碍处理；最后用 `Motion` 或 `Rive` 落地动效。
3. **做品牌视觉升级、技术分享或路演演示文稿**：
   用 `Rebrand Gallery` 和 `Brand New` 看改版思路，对照 `Brand Guidelines` 和 `Branding Style Guides` 搭规范大纲；图形抽象期翻一翻 `Logobook`、`LogoArchive` 和 `Logggos`；做 PPT 前看 `Deck Gallery` 借鉴信息密度和版式；需要独特字体或 Y2K 矢量图形时，去 `YouWorkForThem` 按单次买断采购。
4. **日常几分钟保持输入**：
   早上扫一眼 `Recent Design`（设计师实时发出的新作）和 `Sidebar`（5 篇筛选阅读），碰到适合以后参考的画面顺手存进 `Savee` 或 `Cosmos` 的对应看板，真要动工时直接回翻。
