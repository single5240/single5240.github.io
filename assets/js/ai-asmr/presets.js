(function () {
  "use strict";
  const RAIN_PRESETS = {
    drizzle: {
      name: "微雨 (Drizzle)",
      enName: "gentle micro drizzle",
      desc: "Delicate & Cushioned Dull Patter",
      noiseType: "pink",
      baseVolume: 0.35,
      filterFreq: 1200,
      dropRate: 14,
      dropVelMin: 0.08,
      dropVelMax: 0.22,
      thunder: false,
      windSpeed: 0.4
    },
    light: {
      name: "小雨 (Light Rain)",
      enName: "soft rhythmic light rain",
      desc: "Repetitive, Mellow & Soothing Patter",
      noiseType: "pink",
      baseVolume: 0.55,
      filterFreq: 1900,
      dropRate: 35,
      dropVelMin: 0.15,
      dropVelMax: 0.4,
      thunder: false,
      windSpeed: 0.7
    },
    heavy: {
      name: "大雨 (Heavy Rain)",
      enName: "steady heavy rain wash",
      desc: "Deep, Full & Warm Low-Mid Masking",
      noiseType: "brown",
      baseVolume: 0.85,
      filterFreq: 2900,
      dropRate: 85,
      dropVelMin: 0.3,
      dropVelMax: 0.75,
      thunder: false,
      windSpeed: 1.2
    },
    downpour: {
      name: "倾盆大雨 (Downpour)",
      enName: "enveloping dense downpour",
      desc: "Wide Soundstage White Noise Cocoon",
      noiseType: "brown",
      baseVolume: 1.0,
      filterFreq: 3600,
      dropRate: 150,
      dropVelMin: 0.45,
      dropVelMax: 0.95,
      thunder: false,
      windSpeed: 1.8
    },
    storm: {
      name: "暴风雨 & 远雷 (Storm)",
      enName: "dramatic rainstorm with distant muffled thunder",
      desc: "Sub-Bass Atmospheric Rumble · Zero Sudden Cracks",
      noiseType: "brown",
      baseVolume: 0.95,
      filterFreq: 3200,
      dropRate: 130,
      dropVelMin: 0.4,
      dropVelMax: 0.9,
      thunder: true,
      windSpeed: 2.2
    }
  };

  const RAIN_SURFACES = {
    tent: {
      name: "帆布帐篷 (Canvas Tent)",
      enName: "taut waterproof heavy canvas tent shelter with occasional seam drips",
      zhPrompt: "厚帆布帐篷顶（含帐内低频包裹与偶发汇流水滴）",
      freq: 360,
      q: 1.4,
      decay: 0.032,
      lpScale: 0.72,
      bedGainScale: 0.88,
      peakingFreq: 250,
      peakingQ: 1.3,
      peakingGain: 4.2,
      dropRateScale: 1.0,
      clusterProb: 0.28,
      heavyDripProb: 0.14
    },
    leaves: {
      name: "稠密阔叶 (Broad Leaves)",
      enName: "dense rainforest broad leaves canopy with varied leaf snaps and tip drips",
      zhPrompt: "雨林大小阔叶树冠（含叶面水滴声与叶尖滑落滴水）",
      freq: 580,
      q: 1.6,
      decay: 0.026,
      lpScale: 1.08,
      bedGainScale: 0.95,
      peakingFreq: 740,
      peakingQ: 1.0,
      peakingGain: 2.2,
      dropRateScale: 1.06,
      clusterProb: 0.34,
      heavyDripProb: 0.20
    },
    window: {
      name: "双层隔音窗 (Window)",
      enName: "double-glazed soundproof window heard from warm indoor sanctuary with oblique glass ticks",
      zhPrompt: "室内双层隔音窗前（隔绝窗外高频雨声，室内静听雨点轻叩窗面）",
      freq: 640,
      q: 2.8,
      decay: 0.016,
      lpScale: 0.46,
      bedGainScale: 0.68,
      peakingFreq: 210,
      peakingQ: 1.5,
      peakingGain: 3.8,
      dropRateScale: 0.62,
      clusterProb: 0.24,
      heavyDripProb: 0.16
    },
    cedar: {
      name: "桧木屋檐 (Cedar Roof)",
      enName: "aged cedar wood eaves and shingles with warm timber resonance and eave drips",
      zhPrompt: "桧木屋檐与廊下（木质钝响与屋檐汇流滴水）",
      freq: 340,
      q: 1.9,
      decay: 0.034,
      lpScale: 0.78,
      bedGainScale: 0.86,
      peakingFreq: 330,
      peakingQ: 1.6,
      peakingGain: 4.0,
      dropRateScale: 0.92,
      clusterProb: 0.26,
      heavyDripProb: 0.22
    },
    metal_awning: {
      name: "复古锌铁皮雨棚 (Zinc Awning)",
      enName: "damped vintage corrugated zinc awning with muffled hollow patter",
      zhPrompt: "阻尼锌铁皮雨棚下（薄板空腔嗒嗒雨点与棚下共鸣）",
      freq: 520,
      q: 2.4,
      decay: 0.025,
      lpScale: 0.76,
      bedGainScale: 0.90,
      peakingFreq: 430,
      peakingQ: 2.0,
      peakingGain: 4.5,
      dropRateScale: 1.12,
      clusterProb: 0.32,
      heavyDripProb: 0.15
    },
    car_roof: {
      name: "静谧车顶车厢 (Car Roof Enclosure)",
      enName: "quiet insulated car cabin interior with padded roof thuds and windshield patter",
      zhPrompt: "密闭车厢内（车顶内饰沉闷敲击与前挡风玻璃细雨）",
      freq: 240,
      q: 1.5,
      decay: 0.030,
      lpScale: 0.42,
      bedGainScale: 0.74,
      peakingFreq: 165,
      peakingQ: 1.8,
      peakingGain: 5.2,
      dropRateScale: 0.86,
      clusterProb: 0.26,
      heavyDripProb: 0.12
    },
    glass_sunroom: {
      name: "玻璃阳光房顶 (Glass Sunroom)",
      enName: "laminated glass conservatory skylight dome with delicate raindrop ripples",
      zhPrompt: "玻璃阳光房穹顶下（细密阵雨轻叩玻璃与室内漫反射）",
      freq: 760,
      q: 2.2,
      decay: 0.014,
      lpScale: 0.84,
      bedGainScale: 0.88,
      peakingFreq: 610,
      peakingQ: 1.4,
      peakingGain: 3.2,
      dropRateScale: 1.24,
      clusterProb: 0.36,
      heavyDripProb: 0.14
    }
  };

  // 敲击材质物理参数 (Tapping Materials - 8种异构物理拓扑与腔体/阻尼建模)
  const TAPPING_MATERIALS = {
    woodbox: {
      name: "天然空心木盒 (Hollow Wood Box)",
      enName: "hollow resonant wooden box surface with center and edge hit variations",
      zhPrompt: "天然空心木盒表面（包含盒心空气腔共鸣与盒沿轻叩）",
      baseFreq: 340,       // 木盒顶板主模态 (Hz)
      cavityFreq: 215,     // 赫姆霍兹箱体空气腔基频 (Hz)
      harmonicMult: 1.62,  // 非整数木纹横截面模态比
      decay: 0.048,
      q: 2.4,
      warmthBoost: 0.38,
      desc: "Helmholtz Box Air Cavity + Warm Woody Plate Thump"
    },
    book: {
      name: "精装书皮 (Hardcover Book)",
      enName: "clothbound vintage hardcover book with over-damped paper block thuds",
      zhPrompt: "精装书皮（厚实书芯纸叠阻尼轻叩）",
      baseFreq: 240,       // 纸叠低中频阻尼中心
      cavityFreq: 145,     // 厚书脊沉音
      harmonicMult: 1.38,
      decay: 0.032,
      q: 1.4,
      warmthBoost: 0.42,
      desc: "Over-Damped Linen & Paper Stack Thud · Zero Tonal Ring"
    },
    silicone: {
      name: "软硅胶块 (Soft Silicone)",
      enName: "viscoelastic squishy silicone block with soft finger-pad detachment",
      zhPrompt: "软硅胶块（肉感按压与抬起时的微弱回弹）",
      baseFreq: 165,
      cavityFreq: 98,
      harmonicMult: 1.32,
      decay: 0.036,
      q: 1.2,
      warmthBoost: 0.55,
      desc: "Deep Viscoelastic Cushion Thump + Micro-Tacky Release"
    },
    ceramic: {
      name: "厚陶杯 (Ceramic Mug)",
      enName: "thick artisanal stoneware ceramic mug with subtle cup cavity air",
      zhPrompt: "厚陶杯壁（圆润陶壁叩击与杯口空气共鸣）",
      baseFreq: 680,
      cavityFreq: 325,     // 杯内空气柱微共鸣
      harmonicMult: 1.88,
      decay: 0.028,
      q: 3.1,
      warmthBoost: 0.24,
      desc: "Rounded Stoneware Wall Tok + Subtle Mug Air Pocket"
    },
    bamboo: {
      name: "竹节 (Natural Bamboo)",
      enName: "hollow aged bamboo culm internode with fibrous cortex snap",
      zhPrompt: "天然中空竹节（竹青纤维敲击瞬态与竹筒柱腔共鸣）",
      baseFreq: 510,
      cavityFreq: 275,     // 竹隔膜腔体空气弹跳
      harmonicMult: 1.74,
      decay: 0.038,
      q: 2.8,
      warmthBoost: 0.30,
      desc: "Fibrous Bamboo Cortex Snap + Cylindrical Tube Resonance"
    },
    slate_stone: {
      name: "青石板 (Slate Stone)",
      enName: "dense solid river slate stone slab with grounded mineral knock",
      zhPrompt: "天然青石板（厚重石基沉音与短促石板敲击声）",
      baseFreq: 430,
      cavityFreq: 142,     // 实心石板低频质量惯性沉音
      harmonicMult: 1.52,
      decay: 0.018,        // 实心矿物极快阻尼衰减，绝不拖尾
      q: 2.0,
      warmthBoost: 0.36,
      desc: "Solid Mineral Slab Inertia + Ultra-Short Cool Stone Tick"
    },
    amber_resin: {
      name: "琥珀树脂 (Amber Resin)",
      enName: "solid polished natural amber tree resin block with warm polymer rebound",
      zhPrompt: "天然琥珀树脂块（温润触感与短促回弹）",
      baseFreq: 385,
      cavityFreq: 190,
      harmonicMult: 1.64,
      decay: 0.026,
      q: 2.1,
      warmthBoost: 0.42,
      desc: "Warm Tacky Resin Touch + Mellow Solid Polymer Rebound"
    },
    walnut_shell: {
      name: "胡桃坚果壳 (Walnut Shells)",
      enName: "hollow dry walnut half-shells with occasional shell-on-shell micro-clacks",
      zhPrompt: "天然胡桃坚果壳（薄壁微型空腔轻叩与偶发果壳轻碰）",
      baseFreq: 640,
      cavityFreq: 390,
      harmonicMult: 1.92,
      decay: 0.022,
      q: 2.6,
      warmthBoost: 0.25,
      desc: "Crisp Curved Nutshell Pocket + Organic Double Shell Kiss"
    }
  };

  // 敲击手法与节奏 (Tapping Styles - 融入真人五指力度/音色微差与有机律动)
  const TAPPING_STYLES = {
    slow: {
      name: "舒缓单指点敲 (Slow & Steady)",
      enName: "unhurried single-finger taps with natural double-tap grace notes and breathing pauses",
      zhPrompt: "悠闲慢节拍点敲（含轻重连点与节奏留白）",
      baseInterval: 1080,
      flutter: false,
      orbit: false
    },
    flutter: {
      name: "指尖微颤轮敲 (Flutter Tapping)",
      enName: "organic 3-to-5 finger cascading flutter rolls with human rubato and distinct finger timbres",
      zhPrompt: "多指变速轮敲（带自然加速与减速律动）",
      baseInterval: 1380,
      flutter: true,
      orbit: false
    },
    orbit: {
      name: "3Dio 双耳穿梭 (Ear-to-Ear Orbit)",
      enName: "smooth 3Dio binaural ear-to-ear orbit tapping with ear-side lingering and paired touches",
      zhPrompt: "双耳连续轨迹平滑游走（贴耳处稍作停留）",
      baseInterval: 820,
      flutter: false,
      orbit: true
    },
    metronome: {
      name: "催眠规律节拍 (Hypnotic Metronome)",
      enName: "hypnotic ~60 BPM pulse with subtle human wrist micro-timing and accented/soft breathing dynamics",
      zhPrompt: "约 60 BPM 稳定节拍轻敲（双手交替与强弱起伏）",
      baseInterval: 980,
      flutter: false,
      orbit: false
    }
  };

  // 摩擦声物理材质与介质参数 (Friction Materials - 8 种异构接触剪切拓扑)
  const FRICTION_MATERIALS = {
    brush: {
      name: "蓬松软毛刷 (Fluffy Makeup Brush)",
      enName: "ultra-fluffy soft-bristle kabuki makeup brush with airy bristle-tip splay",
      zhPrompt: "蓬松软毛刷扫过仿真耳廓（含气流声与刷尖轻柔拂拭）",
      baseFreq: 1220,       // 刷毛细腻微风与毛絮中心频率 (Hz)
      shearFreq: 1480,      // 刷尖微散射高频气感带
      q: 0.88,
      bodyWarmth: 295,      // 刷头掠过耳廓时的温润空气团共鸣
      napAsymmetry: 0.10,   // 正反刷动毛簇微差
      velScale: 0.88,
      desc: "Multi-Bristle Air Cushion + Delicate Tip Splay Shimmer"
    },
    velvet: {
      name: "细腻天鹅绒 (Velvet Fabric)",
      enName: "plush heavyweight velvet cloth with directional nap resistance and deep warmth",
      zhPrompt: "厚实天鹅绒布料往复推抚（绒面阻尼与柔和包裹）",
      baseFreq: 780,
      shearFreq: 560,
      q: 1.35,
      bodyWarmth: 225,
      napAsymmetry: 0.22,   // 天鹅绒顺毛/逆毛明显阻尼与明暗差
      velScale: 0.96,
      desc: "Directional Velvet Nap Shear + Overdamped Low-Mid Warmth"
    },
    microsand: {
      name: "细腻微砂台 (Fine Micro-Sand)",
      enName: "ultra-fine quartz micro-sand tray with organic cascading grain avalanches",
      zhPrompt: "石英微砂画台推拂与微砂滑落",
      baseFreq: 1380,
      shearFreq: 1620,
      q: 1.25,
      bodyWarmth: 430,
      napAsymmetry: 0.12,
      velScale: 0.82,
      desc: "Stochastic Quartz Grain Cascade + Non-Periodic Micro-Slip"
    },
    finger: {
      name: "温暖指腹轻摩 (Warm Finger Swiping)",
      enName: "warm dry human finger pads gliding across soft 3Dio silicone pinna contours",
      zhPrompt: "干燥指腹沿耳轮轻缓滑过（含接触与抬手细节）",
      baseFreq: 650,
      shearFreq: 520,
      q: 1.65,
      bodyWarmth: 180,
      napAsymmetry: 0.16,
      velScale: 1.0,
      desc: "Epidermal Ridge Glide + 3Dio Silicone Pinna Micro-Tacky Release"
    },
    bookpage: {
      name: "复古厚书页 (Linen Book Page)",
      enName: "heavyweight cotton-linen book pages with dry cellulose fiber glide and soft page settle",
      zhPrompt: "厚质棉麻书页慢滑与翻页声",
      baseFreq: 1020,
      shearFreq: 1240,
      q: 1.12,
      bodyWarmth: 345,
      napAsymmetry: 0.15,
      velScale: 0.88,
      desc: "Cotton-Linen Cellulose Rustle + Cushioned Page Settle Flump"
    },
    silk_ribbon: {
      name: "冰丝真丝缎带 (Silk Ribbon & Satin)",
      enName: "high-thread-count mulberry silk satin ribbon gliding with laminar air sheen",
      zhPrompt: "真丝缎面低阻尼顺滑掠过",
      baseFreq: 1120,
      shearFreq: 1420,
      q: 0.78,
      bodyWarmth: 270,
      napAsymmetry: 0.08,
      velScale: 0.80,
      desc: "Mulberry Silk Laminar Glide + Featherweight Satin Sheen"
    },
    bamboo_mat: {
      name: "细密竹编席面 (Fine Bamboo Weave)",
      enName: "finely woven aged bamboo mat with velocity-coupled warp-and-weft striations",
      zhPrompt: "手掌掠过竹席经纬纹理",
      baseFreq: 1280,
      shearFreq: 960,
      q: 1.32,
      bodyWarmth: 395,
      napAsymmetry: 0.18,
      velScale: 0.90,
      desc: "Velocity-Coupled Bamboo Weave Striations + Woody Undertone"
    },
    leather_pad: {
      name: "植鞣油皮护垫 (Vegetable Leather Pad)",
      enName: "supple full-grain vegetable-tanned leather pad with viscoelastic stiction-to-glide drag",
      zhPrompt: "植鞣皮革微滞阻尼摩擦",
      baseFreq: 590,
      shearFreq: 460,
      q: 1.55,
      bodyWarmth: 205,
      napAsymmetry: 0.20,
      velScale: 1.04,
      desc: "Full-Grain Leather Viscoelastic Drag + Warm Matte Damping"
    }
  };

  // 摩擦手法与运动轨迹 (Friction Styles - 融入方向、强弱与持续时间随机性)
  const FRICTION_STYLES = {
    swiping: {
      name: "慢速往复推抚 (Back & Forth Swipes)",
      enName: "unhurried back-and-forth swipes mixing single-ear lingering with cross-stage arcs, natural push-pull pressure dynamics, and varied stroke durations",
      zhPrompt: "往复推抚（推拉强弱起伏与折返停顿）",
      cycleTime: 2200, // 基准毫秒（实际随行程与随机律动浮动）
      motion: "linear",
      desc: "Ear-Lingering & Cross Swipes · Push-Pull Dynamics · Organic Rubato"
    },
    circle: {
      name: "3Dio 耳廓打圈 (Circular Ear Massage)",
      enName: "organic circular ear contour massage with spontaneous clockwise/counter-clockwise reversals and proximity pressure swells",
      zhPrompt: "圆周打圈抚摩（贴近耳道时微弱增强）",
      cycleTime: 3200,
      motion: "circular",
      desc: "Reversible Pinna Orbit · Proximity Swells · Varied Arc Timing"
    },
    feather: {
      name: "羽化轻柔短拂 (Feathery Light Strokes)",
      enName: "2-to-5 stroke feathery clusters with varied flick directions, crescendo/decrescendo velocity contours, and human rubato timing",
      zhPrompt: "羽化轻柔短拂（多段短促轻扫）",
      cycleTime: 1420,
      motion: "feather",
      desc: "2–5 Stroke Variable Clusters · Dynamic Contours · Airy Flicks"
    },
    continuous: {
      name: "绵延催眠慢抚 (Continuous Slow Caress)",
      enName: "seamless 3.5-to-6 second wandering binaural caresses with dual-crest breathing pressure waves and overlapping crossfades",
      zhPrompt: "绵延慢抚（平缓起伏如海浪）",
      cycleTime: 4600,
      motion: "continuous",
      desc: "Seamless Wandering Arcs · Dual-Crest Breathing · Ocean-Wave Overlap"
    }
  };

  // 水流声水相与场景参数 (Water Scenarios - 8种异构水相物理拓扑与差异化气泡概率/频带)
  const WATER_SCENARIOS = {
    spring: {
      name: "山涧清泉 (Mountain Spring)",
      enName: "crystal-clear mountain spring trickling through mossy stone crevices with delicate droplet plinks and occasional varied-radius water bubbles",
      zhPrompt: "山涧清泉（石缝细流滑落与清脆水滴声）",
      baseVolume: 0.62,
      bedGainScale: 0.72,
      filterFreq: 1380,
      filterQ: 1.45,
      peakingFreq: 690,
      peakingQ: 1.6,
      peakingGain: 3.4,
      bubbleRate: 5.2,           // 总体微水相事件率 (次/秒，告别原 32/s 高密度纯音水泡)
      bubbleProb: 0.24,          // 仅约 24% 事件伴随水下气腔脱离水泡，其余为石缝水舌微澜与水珠轻滴
      bubbleBaseFreq: 620,
      bubbleFreqRange: [360, 1120], // 大中小多粒径气泡宽频分布 (杜绝同频重复)
      bubbleChirp: 1.30,
      bubbleChirpRange: [1.14, 1.44],
      bubbleDecay: 0.032,
      clusterProb: 0.22,
      undulationSpeed: 0.75,
      shishi: false,
      desc: "Stone-Crevice Trickle · Crisp Mineral Droplets · Sparse Multi-Scale Bubbles"
    },
    pebble: {
      name: "鹅卵石浅溪 (Pebble Stream)",
      enName: "shallow brook gliding over smooth rounded river pebbles with soft hydraulic riffles and sparse micro-splashes",
      zhPrompt: "鹅卵石浅溪（溪水漫过卵石的连续流水声）",
      baseVolume: 0.74,
      bedGainScale: 0.84,
      filterFreq: 1180,
      filterQ: 1.55,
      peakingFreq: 550,
      peakingQ: 1.5,
      peakingGain: 3.8,
      bubbleRate: 6.4,           // 浅滩漫石微澜速率 (告别原 46/s 密集机枪泡)
      bubbleProb: 0.16,          // 以卵石分流水舌滑移与微水花为主，气泡仅占 16%
      bubbleBaseFreq: 560,
      bubbleFreqRange: [320, 980],
      bubbleChirp: 1.26,
      bubbleChirpRange: [1.12, 1.38],
      bubbleDecay: 0.028,
      clusterProb: 0.25,
      undulationSpeed: 0.95,
      shishi: false,
      desc: "Pebble Riffle Glides · Laminar Brook Wash · Minimal Air Bubbles"
    },
    deepbasin: {
      name: "幽潭微涌 (Deep Basin Swirls)",
      enName: "deep serene forest water basin with slow underwater eddy currents and rare deep-rising macro bubbles",
      zhPrompt: "幽潭微涌（深水暗流与低频水体涌动）",
      baseVolume: 0.82,
      bedGainScale: 0.88,
      filterFreq: 720,
      filterQ: 1.95,
      peakingFreq: 290,
      peakingQ: 1.8,
      peakingGain: 4.8,
      bubbleRate: 2.5,           // 深潭静谧缓流，事件低密从容
      bubbleProb: 0.34,          // 潭底偶发大体积低频水泡与尾随子泡
      bubbleBaseFreq: 280,
      bubbleFreqRange: [165, 540],
      bubbleChirp: 1.20,
      bubbleChirpRange: [1.12, 1.30],
      bubbleDecay: 0.056,
      clusterProb: 0.20,
      undulationSpeed: 0.45,
      shishi: false,
      desc: "Deep Subterranean Swirls · Low-Mid Eddy Surge · Rare Deep Bubbles"
    },
    viscous: {
      name: "粘稠微气泡 (Viscous Bubbles)",
      enName: "slow warm viscous fluid gently stretching with multi-sized cushioned bubbles across a wide frequency spectrum",
      zhPrompt: "粘稠液体微流动与多尺寸气泡缓慢破裂",
      baseVolume: 0.52,
      bedGainScale: 0.62,
      filterFreq: 880,
      filterQ: 2.15,
      peakingFreq: 365,
      peakingQ: 1.95,
      peakingGain: 4.4,
      bubbleRate: 3.3,           // 慢速浓稠升腾 (告别原 18/s 密集连发)
      bubbleProb: 0.68,          // 专属气泡场景：68% 为大中小三阶异频软泡，32% 为浓稠胶体翻折慢涌
      bubbleBaseFreq: 360,
      bubbleFreqRange: [160, 880], // 超过 2.4 个八度的宽广粒径频谱，彻底消除单一频率机械感
      bubbleChirp: 1.24,
      bubbleChirpRange: [1.14, 1.38],
      bubbleDecay: 0.062,
      clusterProb: 0.34,          // 大泡破裂后常伴随 1~2 颗高频细微子泡变速尾随
      undulationSpeed: 0.38,
      shishi: false,
      desc: "Multi-Radius Viscous Bubbles (160–880Hz) · Slow Film Stretch & Satellite Pops"
    },
    shishi: {
      name: "添水竹韵 (Zen Shishi-odoshi)",
      enName: "zen garden bamboo spout trickling into a hollow bamboo cylinder with intermittent stone clack and water pour",
      zhPrompt: "添水竹韵（竹筒细流注水、满水倾泻与石台敲击）",
      baseVolume: 0.58,
      bedGainScale: 0.68,
      filterFreq: 1120,
      filterQ: 1.55,
      peakingFreq: 490,
      peakingQ: 1.65,
      peakingGain: 3.5,
      bubbleRate: 3.6,           // 竹笕细流与竹筒承接水滴
      bubbleProb: 0.18,          // 平素以竹筒注水微澜与水滴为主，倾水时触发多相水花
      bubbleBaseFreq: 480,
      bubbleFreqRange: [290, 860],
      bubbleChirp: 1.24,
      bubbleChirpRange: [1.12, 1.34],
      bubbleDecay: 0.036,
      clusterProb: 0.18,
      undulationSpeed: 0.62,
      shishi: true,
      desc: "Hollow Bamboo Inflow Trickle · Spaced Zen Pour & Wet Stone Clack"
    },
    whiskey_ice: {
      name: "厚底杯方冰慢融 (Ice Cube Tumbler Swirl)",
      enName: "large hand-carved ice block swirling slowly in a heavy crystal tumbler with cold liquid slosh, damped crystal clinks, and subtle thermal ice fissures",
      zhPrompt: "厚底玻璃杯中方冰碰撞与冰芯微裂",
      baseVolume: 0.48,
      bedGainScale: 0.52,
      filterFreq: 1320,
      filterQ: 1.75,
      peakingFreq: 720,
      peakingQ: 1.7,
      peakingGain: 3.6,
      bubbleRate: 2.2,           // 从容晃杯与偶发碰冰 (告别原 22/s 密集敲玻璃)
      bubbleProb: 0.10,          // 仅 10% 融水微泡，主体为冷液旋流、方冰碰壁与冰裂微声
      bubbleBaseFreq: 760,
      bubbleFreqRange: [480, 1120],
      bubbleChirp: 1.22,
      bubbleChirpRange: [1.10, 1.28],
      bubbleDecay: 0.025,
      clusterProb: 0.24,
      undulationSpeed: 0.58,
      shishi: false,
      desc: "Heavy Tumbler Liquid Swirl · Spaced Crystal-Ice Clinks · Thermal Micro-Cracks"
    },
    gentle_tide: {
      name: "鹅卵石海岸潮汐 (Gentle Shoreline Tide)",
      enName: "nocturnal ocean tide gently washing over shoreline pebbles with rolling wet stone clicks and receding foam percolation",
      zhPrompt: "卵石滩潮水涌退与石隙渗流",
      baseVolume: 0.78,
      bedGainScale: 0.86,
      filterFreq: 1040,
      filterQ: 1.40,
      peakingFreq: 410,
      peakingQ: 1.45,
      peakingGain: 4.2,
      bubbleRate: 4.4,           // 潮浪漫滩、卵石微滚与退潮渗流 (告别原 38/s 大水泡)
      bubbleProb: 0.12,          // 仅在退潮渗流时偶发极细微泡沫破裂，无大音量合成器水泡
      bubbleBaseFreq: 680,
      bubbleFreqRange: [460, 1180],
      bubbleChirp: 1.18,
      bubbleChirpRange: [1.10, 1.26],
      bubbleDecay: 0.024,
      clusterProb: 0.26,
      undulationSpeed: 0.42,
      shishi: false,
      desc: "Shoreline Surf Swash · Rolling Wet Pebbles · Receding Foam Percolation"
    },
    tea_drip: {
      name: "紫砂茶台细流 (Zen Clay Tea Drip)",
      enName: "warm tea stream poured from a Yixing Zisha clay teapot with varied droplets pattering onto a hollow bamboo drainage tray",
      zhPrompt: "茶水注入茶海与茶盘错落流水",
      baseVolume: 0.54,
      bedGainScale: 0.62,
      filterFreq: 1220,
      filterQ: 1.75,
      peakingFreq: 610,
      peakingQ: 1.7,
      peakingGain: 3.8,
      bubbleRate: 4.1,           // 茶汤注水与茶盘错落滴水 (告别原 26/s 密集气泡)
      bubbleProb: 0.22,          // 78% 为紫砂/竹盘水滴与注汤细流，22% 为茶汤表面轻柔微泡
      bubbleBaseFreq: 590,
      bubbleFreqRange: [340, 960],
      bubbleChirp: 1.26,
      bubbleChirpRange: [1.14, 1.38],
      bubbleDecay: 0.032,
      clusterProb: 0.24,
      undulationSpeed: 0.78,
      shishi: false,
      desc: "Yixing Clay Teapot Pour · Bamboo Tray Droplets · Warm Tea Micro-Pearls"
    }
  };

  // 水流动态与手法 (Water Styles - 引入非周期潮汐、疏密游走与特征概率权重)
  const WATER_STYLES = {
    meander: {
      name: "缓流微漪 (Gentle Meandering)",
      enName: "unhurried meandering stream with organic breathing pauses and non-periodic ripple clusters",
      zhPrompt: "缓流微漪（平缓漫流与水面微澜）",
      cycleTime: 2600,
      binauralMode: "meander",
      rateScale: 1.0,
      bubbleProbScale: 1.0,
      bedScale: 1.0,
      desc: "Gentle Meandering Stream · Organic Breathing Pauses · Stochastic Ripples"
    },
    eddy: {
      name: "3Dio 双耳洄游 (Ear-to-Ear Eddy)",
      enName: "non-periodic 3Dio binaural swirling eddy current with spontaneous single-ear lingering whirlpools",
      zhPrompt: "双耳洄游（左右耳间慢速游弋）",
      cycleTime: 3800,
      binauralMode: "eddy",
      rateScale: 0.95,
      bubbleProbScale: 0.92,
      bedScale: 1.04,
      desc: "Reversible Ear-to-Ear Orbit · Single-Ear Lingering Eddies · Spatial Fluidity"
    },
    lapping: {
      name: "细浪轻拍 (Lapping Ripples)",
      enName: "multi-wave non-periodic shoreline lapping with surging water washes followed by quiet draining trickles",
      zhPrompt: "细浪轻拍（轻浪微涌与退水留白）",
      cycleTime: 3400,
      binauralMode: "lapping",
      rateScale: 0.88,
      bubbleProbScale: 0.78,
      bedScale: 1.06,
      desc: "Multi-Wave Surge & Retreat · Draining Trickles · Calm Trough Silences"
    },
    immersion: {
      name: "连续浸润湍涌 (Continuous Immersion)",
      enName: "deep continuous laminar-turbulent water curtain with smooth riffle swells and minimal discrete bubble pops",
      zhPrompt: "连续浸润湍涌（连绵水幕与水流底噪）",
      cycleTime: 2200,
      binauralMode: "immersion",
      rateScale: 0.76,
      bubbleProbScale: 0.52, // 浸润模式下进一步减半离散气泡，专注平顺流体包裹
      bedScale: 1.18,
      desc: "Smooth Continuous Fluid Curtain · Minimal Discrete Pops · Deep Masking"
    }
  };

  // 能量泛音与音疗器皿参数 (Bowls Instruments)
  const BOWLS_INSTRUMENTS = {
    tibetan: {
      name: "西藏手工颂钵 (Tibetan Singing Bowl)",
      enName: "handmade Tibetan singing bowl with deep 216Hz fundamental and ethereal overtones",
      zhPrompt: "西藏手工颂钵（216Hz 基频与多阶金属泛音）",
      baseFreq: 216,           // 经典 216Hz 谐频基音 (Sub-mid)
      harmonics: [
        { ratio: 1.0, gain: 0.85, decayMul: 1.0 },
        { ratio: 2.76, gain: 0.42, decayMul: 0.72 },
        { ratio: 5.40, gain: 0.22, decayMul: 0.55 },
        { ratio: 8.90, gain: 0.09, decayMul: 0.38 }
      ],
      baseDecay: 13.5,         // 自然延音秒数
      beatFreq: 1.15,          // 双频微拍差 (Hz) 带来经典嗡鸣脉冲
      warmthCutoff: 1600,
      desc: "Deep Resonant Singing Bowl · 14s Hypnotic Natural Decay"
    },
    koshi: {
      name: "柯西和弦风铃 (Koshi Bamboo Chimes)",
      enName: "Koshi bamboo wind chimes gently swaying in the breeze with crystalline overtones",
      zhPrompt: "柯西和弦风铃（音律竹管和弦）",
      baseFreq: 440,
      chimeScale: [440, 523.25, 659.25, 880, 987.77, 1046.5, 1318.5],
      harmonics: [
        { ratio: 1.0, gain: 0.85, decayMul: 1.0 },
        { ratio: 3.1, gain: 0.28, decayMul: 0.48 }
      ],
      baseDecay: 5.8,
      warmthCutoff: 2800,
      desc: "Airy Koshi Bamboo Chimes · Pentatonic Crystalline Harmonics"
    },
    tuningfork: {
      name: "调音音叉 (432Hz Tuning Fork)",
      enName: "432Hz healing tuning forks with 6Hz theta binaural beats synchronization",
      zhPrompt: "432Hz 调音音叉（正弦纯音与双耳拍频）",
      baseFreq: 432,           // 432Hz 自然疗愈基频
      binauralDiff: 6.0,       // 左右耳频差 6Hz (Theta 慢波诱导深睡)
      harmonics: [
        { ratio: 1.0, gain: 1.0, decayMul: 1.0 }
      ],
      baseDecay: 15.0,
      warmthCutoff: 2200,
      desc: "Pure 432Hz Sine Tone · 6Hz Theta Binaural Beat Sleep Induction"
    },
    crystal: {
      name: "水晶石英钵 (Crystal Quartz Bowl)",
      enName: "pure white quartz crystal singing bowl tuned to 528Hz transformation frequency",
      zhPrompt: "水晶石英钵（纯净平滑谐振）",
      baseFreq: 528,           // 528Hz Solfeggio 转换频
      harmonics: [
        { ratio: 1.0, gain: 0.9, decayMul: 1.0 },
        { ratio: 2.0, gain: 0.28, decayMul: 0.65 },
        { ratio: 6.0, gain: 0.06, decayMul: 0.35 }
      ],
      baseDecay: 14.0,
      beatFreq: 0.75,
      warmthCutoff: 2600,
      desc: "High-Purity 528Hz Quartz Bowl · Celestial Luminous Hum"
    },
    tingsha: {
      name: "禅意双面碰铃 (Zen Tingsha Cymbals)",
      enName: "Tibetan tingsha cymbals gently striking with long sustained bright resonance",
      zhPrompt: "纯铜双面碰铃（清脆悠扬高阶泛音）",
      baseFreq: 1820,
      harmonics: [
        { ratio: 1.0, gain: 0.8, decayMul: 1.0 },
        { ratio: 1.34, gain: 0.55, decayMul: 0.85 },
        { ratio: 2.45, gain: 0.18, decayMul: 0.5 }
      ],
      baseDecay: 10.5,
      beatFreq: 2.8,
      warmthCutoff: 3200,
      desc: "Zen Brass Tingsha · Lingering Intimate Metallic Ring"
    },
    temple_bell: {
      name: "青铜钟 (Bronze Temple Bell)",
      enName: "massive ancient bronze temple bell struck softly with long sub-bass wash",
      zhPrompt: "青铜古钟（深沉低频长鸣）",
      baseFreq: 86.4,
      harmonics: [
        { ratio: 1.0, gain: 0.95, decayMul: 1.0 },
        { ratio: 1.48, gain: 0.45, decayMul: 0.8 },
        { ratio: 2.08, gain: 0.32, decayMul: 0.65 },
        { ratio: 2.72, gain: 0.18, decayMul: 0.5 },
        { ratio: 3.82, gain: 0.08, decayMul: 0.35 }
      ],
      baseDecay: 16.0,
      beatFreq: 0.45,
      warmthCutoff: 1100,
      desc: "Ancient Bronze Temple Bell · 86Hz Sub-Bass Meditation"
    },
    steel_tongue: {
      name: "钢舌鼓 (Steel Tongue Drum)",
      enName: "528Hz frequency acoustic steel tongue drum mellow chime petal",
      zhPrompt: "空灵钢舌鼓（饱满和弦泛音）",
      baseFreq: 528,
      chimeScale: [396, 440, 528, 660, 792, 880, 1056],
      harmonics: [
        { ratio: 1.0, gain: 0.88, decayMul: 1.0 },
        { ratio: 2.0, gain: 0.35, decayMul: 0.6 },
        { ratio: 3.01, gain: 0.12, decayMul: 0.42 }
      ],
      baseDecay: 7.5,
      warmthCutoff: 2100,
      desc: "Steel Tongue Drum 528Hz · Harmonious Solfeggio Tone"
    },
    wood_kalimba: {
      name: "相思木拇指琴 (Acacia Wood Kalimba)",
      enName: "acacia resonant kalimba metal tine plucked softly with warm box echo",
      zhPrompt: "木质相思木拇指琴（金属弹片与木盒共鸣）",
      baseFreq: 392,
      chimeScale: [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 659.25],
      harmonics: [
        { ratio: 1.0, gain: 0.85, decayMul: 1.0 },
        { ratio: 2.76, gain: 0.28, decayMul: 0.5 },
        { ratio: 5.4, gain: 0.08, decayMul: 0.3 }
      ],
      baseDecay: 4.5,
      warmthCutoff: 1800,
      desc: "Acacia Kalimba Tines · Warm Box Resonance"
    }
  };

  // 敲奏手法与仪式 (Bowls Styles)
  const BOWLS_STYLES = {
    single: {
      name: "悠缓单叩 (Spaced Strike)",
      enName: "slow meditative single strikes with complete 12-second natural decay tails",
      zhPrompt: "悠缓单叩（留出充分衰减与余韵）",
      baseInterval: 10500, // 毫秒
      mode: "strike",
      desc: "Spaced Meditative Strikes · Complete Natural Decay Envelope"
    },
    rim: {
      name: "双耳环磨颂唱 (Singing Rim Rub)",
      enName: "continuous circular rim rubbing around singing bowls creating swirling standing waves",
      zhPrompt: "双耳环磨颂唱（沿钵口边缘摩擦激发共鸣）",
      baseInterval: 3800,
      mode: "rim",
      desc: "Continuous Circular Rim Swirl · 360° Binaural Standing Wave"
    },
    chimebreeze: {
      name: "微风偶发随拂 (Breeze Drift)",
      enName: "gentle intermittent wind drift softly triggering random wind chime tubes",
      zhPrompt: "微风偶发随拂（风铃错落轻碰）",
      baseInterval: 3200,
      mode: "breeze",
      desc: "Organic Wind Drift · Stochastic Multi-Tube Harmony"
    },
    binauralbeat: {
      name: "双耳微差节拍 (Binaural Beats)",
      enName: "continuous binaural harmonic oscillation for deep theta state relaxation",
      zhPrompt: "双耳慢拍共振（左右微差引导放松）",
      baseInterval: 4800,
      mode: "binauralbeat",
      desc: "Continuous Binaural Oscillation · Theta Wave Entrainment"
    }
  };

  // 伴读工具与微机械 (Tools & Grooming Instruments)
  const TOOLS_INSTRUMENTS = {
    scissors: {
      name: "锋利理发轻剪 (Salon Haircut Scissors)",
      enName: "ultra-sharp professional barber scissors making delicate close-up snips near the ears",
      zhPrompt: "锋利理发轻剪（双耳近距离开合轻剪）",
      type: "scissors",
      baseRate: 750, // 基础周期间隔 (ms)
      warmthCutoff: 2600,
      desc: "Delicate Scissor Snips · Crisp & Soft Blade Approach"
    },
    comb: {
      name: "密齿木梳理发 (Fine Wood Hair Comb)",
      enName: "fine wooden comb gently raking through strands of soft hair with repetitive micro-rustles",
      zhPrompt: "密齿木梳（梳理发丝连绵沙沙声）",
      type: "comb",
      baseRate: 1100,
      warmthCutoff: 2100,
      desc: "Fine Tooth Comb · Gentle Hair Raking & Scalp Soothing"
    },
    pencil: {
      name: "棉纸素描铅笔 (Cotton Paper Pencil)",
      enName: "heavy 4B graphite pencil writing and sketching on textured cotton watercolor paper",
      zhPrompt: "素描铅笔在粗纹纸上划写",
      type: "pencil",
      baseRate: 850,
      warmthCutoff: 1800,
      desc: "Pencil on Cotton Paper · Textured Graphite Strokes & Cadence"
    },
    typewriter: {
      name: "复古机械打字机 (Vintage Typewriter)",
      enName: "vintage mechanical typewriter key clacks on ink ribbon with occasional carriage return bell",
      zhPrompt: "机械打字机键入与行末铃声",
      type: "typewriter",
      baseRate: 480,
      warmthCutoff: 2200,
      desc: "Mechanical Typewriter · Solid Key Thud & Brass Return Chime"
    },
    spray: {
      name: "细密雾化水喷 (Barber Mist Spray)",
      enName: "fine barber water mist spray bottle dispersing delicate micro-aerosol clouds near ear",
      zhPrompt: "细密雾化水喷气流声",
      type: "spray",
      baseRate: 2400,
      warmthCutoff: 2400,
      desc: "Barber Fine Mist Atomizer · Soft Hydraulic Air Diffuse"
    },
    music_box: {
      name: "发条黄铜八音盒 (Vintage Brass Music Box)",
      enName: "vintage wind-up brass clockwork music box delicate steel comb tines",
      zhPrompt: "发条八音盒运转与金属音梳旋律",
      type: "music_box",
      baseRate: 380,
      warmthCutoff: 2400,
      desc: "Wind-up Brass Music Box · Delicate Clockwork Steel Comb"
    },
    sandalwood_fan: {
      name: "檀香木折扇开合 (Sandalwood Folding Fan)",
      enName: "aromatic sandalwood folding fan opening and waving gentle binaural breeze",
      zhPrompt: "檀香木折扇开合轻弹与微风",
      type: "fan",
      baseRate: 1400,
      warmthCutoff: 1500,
      desc: "Sandalwood Folding Fan · Soft Wood Slat Snaps & Airflow"
    },
    fountain_pen: {
      name: "金尖钢笔棉纸划写 (Gold Nib Fountain Pen)",
      enName: "smooth gold nib fountain pen gliding on heavy textured cotton paper",
      zhPrompt: "钢笔走字沙沙声与墨水浸润",
      type: "fountain_pen",
      baseRate: 650,
      warmthCutoff: 1750,
      desc: "Gold Nib Fountain Pen · Wet Ink Cotton Paper Tactility"
    }
  };

  // 动作节拍与运动轨迹 (Tools Styles)
  const TOOLS_STYLES = {
    binaural_trim: {
      name: "双耳交替修剪 (Alternating Ear Attention)",
      enName: "alternating between extreme close-up left and right ears for personal grooming attention",
      zhPrompt: "左右双耳交替打理",
      mode: "alternate",
      desc: "Alternating Left/Right Ear Close-up Grooming"
    },
    rhythmic_flow: {
      name: "伴读专注心流 (Hypnotic Study Cadence)",
      enName: "steady and hypnotic rhythm at comfortable 75 BPM cadence for deep study focus",
      zhPrompt: "平稳伴读节奏",
      mode: "flow",
      desc: "Steady Repetitive Study Flow · Hypnotic 75 BPM"
    },
    head_contour: {
      name: "耳廓环绕漫游 (Head Contour Orbit)",
      enName: "smooth circular orbit tracing around the earlobes and back of the head",
      zhPrompt: "头部环绕漫游",
      mode: "orbit",
      desc: "360° Orbital Path Around Ears and Head Contour"
    },
    random_flutter: {
      name: "随性偶发微拂 (Casual Micro-Interactions)",
      enName: "organic casual micro-interactions with natural pauses and gentle spontaneous touches",
      zhPrompt: "随性轻微互动",
      mode: "random",
      desc: "Organic Spontaneous Flutters · Natural Hesitations"
    }
  };

  // 暖冬壁炉炭火与有机碎裂 (Fireplace & Natural Fracture Instruments - 8种异构热流/有机拓扑与差异化微爆概率/宽频跨度)
  const FIRE_INSTRUMENTS = {
    pine_fireplace: {
      name: "松木壁炉炭火 (Pine Fireplace Hearth)",
      enName: "warm masonry pine fireplace hearth with soothing low-mid flame drafts, shifting ash sighs, and unhurried multi-scale resin pops",
      zhPrompt: "松木壁炉炭火（温热热流与偶发松脂微爆）",
      type: "fireplace",
      baseRate: 1850,             // 平均基础间隔 1.85s（告别原 450ms 高密度机枪爆裂）
      popProb: 0.42,              // 58% 为火舌轻摇与木炭热流微叹，仅 42% 触发高/中/低异频松脂微爆
      popFreqs: [210, 560, 1220],
      popFreqRange: [145, 1480],  // 超过 3 个八度的三阶微爆频谱，杜绝同频重复
      bedGainScale: 0.95,
      bedFilterFreq: 310,
      bedFilterQ: 1.35,
      peakingFreq: 155,
      peakingQ: 1.55,
      peakingGain: 4.5,
      convectionSpeed: 0.55,
      clusterProb: 0.22,
      warmthCutoff: 1750,
      desc: "Masonry Hearth Drafts · Shifting Ash Sighs · Spaced Multi-Band Resin Pops"
    },
    autumn_leaves: {
      name: "深秋干燥落叶 (Autumn Leaves Stroll)",
      enName: "serene autumn forest floor with gentle leaf-canopy rustles, soft humus foot-weight shifts, and spaced multi-scale maple petiole crunches",
      zhPrompt: "深秋落叶踩踏与干燥叶脉微折",
      type: "leaves",
      baseRate: 1950,             // 从容林间漫步节拍（原 950ms）
      popProb: 0.32,              // 68% 为微风拂叶与鞋底软泥轻移沙沙声，32% 为多层叶柄/叶片松脆压折
      popFreqs: [420, 820, 1340],
      popFreqRange: [340, 1420],
      bedGainScale: 0.42,
      bedFilterFreq: 520,
      bedFilterQ: 1.15,
      peakingFreq: 340,
      peakingQ: 1.30,
      peakingGain: 2.8,
      convectionSpeed: 0.48,
      clusterProb: 0.20,
      warmthCutoff: 2050,
      desc: "Soft Humus Foot-Shift · Breeze Leaf Rustle · Spaced Cellulose Crunches"
    },
    campfire_embers: {
      name: "营火微风余烬 (Campfire Glowing Embers)",
      enName: "nocturnal open-air campfire glowing embers breathing in the night breeze with soft ash settling and rare distant charcoal sparks",
      zhPrompt: "营火微风余烬与零星炭星细响",
      type: "embers",
      baseRate: 2100,             // 舒缓营火余烬呼吸（告别原 380ms 密集高频火星）
      popProb: 0.24,              // 76% 为夜风吹拂红炭的温暖气浪涌动与炭灰沉降，仅 24% 伴随零星微弱炭星
      popFreqs: [380, 860, 1520],
      popFreqRange: [320, 1680],
      bedGainScale: 0.78,
      bedFilterFreq: 410,
      bedFilterQ: 1.25,
      peakingFreq: 225,
      peakingQ: 1.45,
      peakingGain: 3.8,
      convectionSpeed: 0.65,
      clusterProb: 0.18,
      warmthCutoff: 1950,
      desc: "Night-Breeze Ember Swells · Soft Ash Settle · Rare Delicate Sparks"
    },
    pinecone_fracture: {
      name: "干燥松果微压 (Dry Pinecone Flex & Snap)",
      enName: "hand-held dry pinecone with warm finger pads gently flexing woody scales and unhurried resinous scale releases",
      zhPrompt: "干燥松果鳞片慢揉与轻脆微折",
      type: "pinecone",
      baseRate: 2400,             // 慢速手部把玩微压（原 1100ms）
      popProb: 0.35,              // 65% 为指腹摩挲松果木鳞与弹性微弯，35% 为大小鳞片木质脆性释放
      popFreqs: [310, 580, 920],
      popFreqRange: [250, 1080],
      bedGainScale: 0.26,
      bedFilterFreq: 280,
      bedFilterQ: 1.10,
      peakingFreq: 190,
      peakingQ: 1.35,
      peakingGain: 2.4,
      convectionSpeed: 0.35,
      clusterProb: 0.22,
      warmthCutoff: 1850,
      desc: "Warm Finger Scale Flex · Resinous Wood Rub · Spaced Scale Snaps"
    },
    charcoal_drift: {
      name: "竹炭微炙慢烘 (Binchotan White Charcoal)",
      enName: "high-density Binchotan white charcoal radiating serene infrared warmth in a clay brazier with soft micro-pore sighs and rare mineral tinks",
      zhPrompt: "备长炭微热暖流与微小气孔收缩",
      type: "charcoal",
      baseRate: 2500,             // 极静谧陶炉慢烘（告别原 550ms 密集正弦波叮当声）
      popProb: 0.18,              // 备长炭以无烟少爆著称：82% 为陶炉暖流与炭体微气孔呼气，仅 18% 为清润炭体微鸣
      popFreqs: [520, 880, 1360],
      popFreqRange: [440, 1480],
      bedGainScale: 0.58,
      bedFilterFreq: 350,
      bedFilterQ: 1.40,
      peakingFreq: 255,
      peakingQ: 1.60,
      peakingGain: 3.4,
      convectionSpeed: 0.38,
      clusterProb: 0.14,
      warmthCutoff: 1680,
      desc: "Clay Brazier Radiant Warmth · Micro-Pore Breath · Rare Binchotan Tink"
    },
    dry_twigs: {
      name: "干燥细松枝折断 (Dry Pine Twigs)",
      enName: "gathering and gently flexing dry forest pine twigs with soft bark friction and spaced snaps across thick and thin branches",
      zhPrompt: "干燥松枝轻拢摩擦与缓压折断",
      type: "twigs",
      baseRate: 2300,             // 从容枯枝轻拢与缓折（原 850ms）
      popProb: 0.38,              // 62% 为枯枝轻拢摩挲与木纤维预弯应力，38% 为粗/中/细枝异频折断
      popFreqs: [280, 620, 1080],
      popFreqRange: [220, 1260],
      bedGainScale: 0.32,
      bedFilterFreq: 380,
      bedFilterQ: 1.20,
      peakingFreq: 240,
      peakingQ: 1.35,
      peakingGain: 2.6,
      convectionSpeed: 0.42,
      clusterProb: 0.20,
      warmthCutoff: 1980,
      desc: "Dry Bark Bundling Rub · Fiber Stress Creak · Multi-Gauge Twig Snaps"
    },
    sauna_steam: {
      name: "桑拿火山石浇水蒸腾 (Sauna Lava Steam)",
      enName: "cedar-lined sauna stove with warm water ladled onto scorching volcanic stones, blooming into lush cushioned vapor sighs",
      zhPrompt: "桑拿热石温水蒸腾声",
      type: "steam",
      baseRate: 3400,             // 悠长冥想式桑拿泼水周期（原 1200ms）
      popProb: 0.08,              // 92% 为木瓢注水与多频段温润水汽漫涌舒展，仅 8% 含火山石受热微沉钝音（零爆裂声）
      popFreqs: [220, 380, 640],
      popFreqRange: [180, 720],
      bedGainScale: 0.74,
      bedFilterFreq: 450,
      bedFilterQ: 1.35,
      peakingFreq: 215,
      peakingQ: 1.50,
      peakingGain: 4.0,
      convectionSpeed: 0.44,
      clusterProb: 0.12,
      warmthCutoff: 1720,
      desc: "Wooden Ladle Pour · Blooming Lava Stone Vapor · Zero Harsh Popping"
    },
    roast_chestnut: {
      name: "糖炒栗子壳微爆 (Roasting Chestnuts in Sand)",
      enName: "heavy iron wok slowly turning warm black quartz sand and sweet chestnuts with buttery sand glides and occasional muffled shell puffs",
      zhPrompt: "热黑石英砂翻炒与栗壳受热轻微裂开",
      type: "chestnut",
      baseRate: 2200,             // 从容翻砂慢炒周期（告别原 680ms 连续爆壳）
      popProb: 0.28,              // 72% 为铁铲慢翻热石英砂与板栗的温润沙流声，仅 28% 伴随焦糖栗壳闷噗微裂
      popFreqs: [260, 480, 820],
      popFreqRange: [210, 960],
      bedGainScale: 0.66,
      bedFilterFreq: 480,
      bedFilterQ: 1.30,
      peakingFreq: 310,
      peakingQ: 1.45,
      peakingGain: 3.6,
      convectionSpeed: 0.52,
      clusterProb: 0.18,
      warmthCutoff: 1820,
      desc: "Warm Iron-Sand Tumbling Glide · Caramel Steam · Spaced Muffled Shell Puffs"
    }
  };

  // 壁炉环境氛围与非周期律动 (Fireplace Styles - 引入疏密游走、静谧留白与特征概率权重)
  const FIRE_STYLES = {
    hearth_calm: {
      name: "壁炉炉边守候 (By the Hearth Coziness)",
      enName: "peaceful resting by the hearth with deep low-end thermal convection, long contemplative silences, and unhurried natural micro-events",
      zhPrompt: "壁炉炉边守候（稳定热流与偶发微爆）",
      mode: "hearth",
      rateScale: 0.85,
      popProbScale: 0.85,
      bedScale: 1.08,
      desc: "Unhurried Hearth Resting · Contemplative Pauses · Deep Thermal Cocoon"
    },
    autumn_walk: {
      name: "林间落叶漫步 (Forest Stroll Rubato)",
      enName: "unhurried left-right footsteps strolling across forest leaves with human gait rubato, subtle weight shifts, and occasional scenic pauses",
      zhPrompt: "林间落叶漫步（左右交替踏叶）",
      mode: "walk",
      rateScale: 0.92,
      popProbScale: 0.90,
      bedScale: 0.95,
      desc: "Human Gait Rubato · Soft Weight Shifts · Scenic Forest Pauses"
    },
    night_wind_gust: {
      name: "微风拂火忽明 (Non-Periodic Wind Swell)",
      enName: "multi-wave non-periodic night breeze gently fanning the hearth with warm convective swells followed by calm quiet troughs",
      zhPrompt: "微风吹拂火堆（起伏对流呼吸）",
      mode: "gust",
      rateScale: 0.94,
      popProbScale: 0.88,
      bedScale: 1.15,
      desc: "Incommensurate Wind Swells · Warm Ember Flares · Peaceful Troughs"
    },
    close_crackle: {
      name: "近耳温存细语 (Intimate Ear Lingering)",
      enName: "single-ear lingering thermal whispers and delicate micro-textures that dwell softly for 2-to-4 phrases before drifting across the head",
      zhPrompt: "近耳温存细语（单侧耳畔稍作停留）",
      mode: "close",
      rateScale: 1.06,
      popProbScale: 1.02,
      bedScale: 0.92,
      desc: "Single-Ear Lingering Phrases · Soft Proximity Warmth · Delicate Micro-Textures"
    }
  };

  // 触觉揉捏与软体材质 (Squish Materials - 8 种异构粘弹性与微塑性拓扑)
  const SQUISH_MATERIALS = {
    memory_foam: {
      name: "慢回弹记忆海绵 (Memory Foam Slow Rebound)",
      enName: "open-cell viscoelastic memory foam compressed deeply with slow air-inhaling rebound and micro-pore unsticking",
      zhPrompt: "慢回弹记忆海绵（深压排气与慢速吸气回弹）",
      baseRate: 3200,
      reboundDuration: 2.2,
      warmthCutoff: 1350,
      bedFilterFreq: 260,
      bedFilterQ: 1.15,
      peakingFreq: 195,
      peakingQ: 1.4,
      peakingGain: 2.8,
      bedGainScale: 0.72,
      breathSpeed: 0.42,
      popFreqRange: [185, 720],
      desc: "Open-Cell Memory Foam · Two-Stage Exhale & Slow Rebound Inhale"
    },
    warm_beeswax: {
      name: "温热天然蜂蜡 (Warm Beeswax Kneading)",
      enName: "warm high-damping natural beeswax paste folded slowly with soft tacky finger-pad detachment",
      zhPrompt: "温热天然蜂蜡（膏体推压与微粘滞分离）",
      baseRate: 2850,
      reboundDuration: 1.5,
      warmthCutoff: 980,
      bedFilterFreq: 210,
      bedFilterQ: 1.25,
      peakingFreq: 155,
      peakingQ: 1.55,
      peakingGain: 3.4,
      bedGainScale: 0.82,
      breathSpeed: 0.36,
      popFreqRange: [150, 560],
      desc: "Warm Beeswax Paste · Overdamped Fold & Micro-Tacky Detachment"
    },
    soft_slime: {
      name: "柔韧水晶泥软胶 (Soft Slime Micro-Pops)",
      enName: "viscous hydrogel crystal slime stretched and folded with multi-size damped capillary film micro-bubbles",
      zhPrompt: "柔韧水晶泥软胶（拉伸揉捏与钝感微泡）",
      baseRate: 2350,
      reboundDuration: 1.1,
      warmthCutoff: 1680,
      bedFilterFreq: 310,
      bedFilterQ: 1.35,
      peakingFreq: 245,
      peakingQ: 1.65,
      peakingGain: 3.1,
      bedGainScale: 0.68,
      breathSpeed: 0.56,
      popFreqRange: [195, 1120],
      desc: "Hydrogel Crystal Slime · Wet Formant Glide & Multi-Scale Film Pops"
    },
    linen_parchment: {
      name: "柔和亚麻纸褶 (Soft Linen & Parchment)",
      enName: "unbleached soft linen cloth and vegetable baking parchment gathered gently with staggered organic fiber creases",
      zhPrompt: "羊皮纸与厚纸褶皱慢揉",
      baseRate: 2550,
      reboundDuration: 1.25,
      warmthCutoff: 1520,
      bedFilterFreq: 340,
      bedFilterQ: 1.1,
      peakingFreq: 275,
      peakingQ: 1.3,
      peakingGain: 2.4,
      bedGainScale: 0.58,
      breathSpeed: 0.50,
      popFreqRange: [340, 1280],
      desc: "Soft Linen & Vegetable Parchment · Rubato Organic Fiber Creases"
    },
    kinetic_sand: {
      name: "流沙解压魔方 (Kinetic Sand Compression)",
      enName: "cohesive polymer-coated quartz sand compressed and slowly crumbling apart in buttery cascading waves",
      zhPrompt: "流沙解压魔方（细砂挤压与缓慢崩落滑移）",
      baseRate: 2950,
      reboundDuration: 1.65,
      warmthCutoff: 1280,
      bedFilterFreq: 290,
      bedFilterQ: 1.2,
      peakingFreq: 230,
      peakingQ: 1.45,
      peakingGain: 2.9,
      bedGainScale: 0.74,
      breathSpeed: 0.45,
      popFreqRange: [260, 890],
      desc: "Kinetic Polymer Sand · Cohesive Slice & Buttery Crumble Cascade"
    },
    bubble_wrap: {
      name: "双耳防震气泡膜 (Cushioned Bubble Wrap)",
      enName: "soft LDPE air-cushion film pressed gently with pre-tension crease and multi-radius muffled air pocket pops",
      zhPrompt: "防震气泡膜（气囊沉闷微破）",
      baseRate: 2450,
      reboundDuration: 0.95,
      warmthCutoff: 1480,
      bedFilterFreq: 275,
      bedFilterQ: 1.18,
      peakingFreq: 215,
      peakingQ: 1.4,
      peakingGain: 2.6,
      bedGainScale: 0.54,
      breathSpeed: 0.52,
      popFreqRange: [175, 920],
      desc: "Cushioned Air-Pocket Film · Pre-Tension Crease & Wide-Band Muffled Pops"
    },
    sourdough_knead: {
      name: "面团揉折 (Artisan Dough Fold)",
      enName: "high-hydration artisan sourdough stretched and folded with wet gluten peel and soft fermentation gas sighs",
      zhPrompt: "湿润面团按压、延展与折叠",
      baseRate: 3100,
      reboundDuration: 1.85,
      warmthCutoff: 1120,
      bedFilterFreq: 225,
      bedFilterQ: 1.3,
      peakingFreq: 168,
      peakingQ: 1.6,
      peakingGain: 3.5,
      bedGainScale: 0.80,
      breathSpeed: 0.38,
      popFreqRange: [155, 620],
      desc: "Hydrated Sourdough Stretch & Fold · Wet Gluten Peel & Gas Pocket Sigh"
    },
    silicone_pop: {
      name: "硅胶解压按按乐 (Silicone Fidget Pop)",
      enName: "thick food-grade silicone dimple fidget pressed with rubbery pre-flex and bistable dome buckling thocks",
      zhPrompt: "硅胶按按乐翻转与连按",
      baseRate: 2250,
      reboundDuration: 0.9,
      warmthCutoff: 1560,
      bedFilterFreq: 265,
      bedFilterQ: 1.2,
      peakingFreq: 205,
      peakingQ: 1.45,
      peakingGain: 2.7,
      bedGainScale: 0.52,
      breathSpeed: 0.54,
      popFreqRange: [195, 740],
      desc: "Bistable Silicone Dimples · Pre-Buckling Rub & Inward/Outward Thock"
    }
  };

  // 揉捏手法与人手微律动 (Squish Styles)
  const SQUISH_STYLES = {
    deep_slow_press: {
      name: "深沉慢速按压 (Deep Slow Compression)",
      enName: "deep slow palm compression with brief bottom-out hold and long viscoelastic rebound inhalation",
      zhPrompt: "深沉慢速按压（深呼吸周期）",
      mode: "deep",
      rateScale: 0.76,
      durationScale: 1.38,
      poreClusterScale: 0.78,
      bedScale: 1.12,
      desc: "Deep Slow Palm Compression · Bottom-Out Hold & Long Rebound"
    },
    alternating_knead: {
      name: "双耳驻留揉抚 (Binaural Lingering Knead)",
      enName: "intimate ear-to-ear kneading lingering 1 to 3 presses per ear with natural left-right hand dynamics",
      zhPrompt: "双耳驻留揉抚（单侧连续揉捏后换手）",
      mode: "alternate",
      rateScale: 1.0,
      durationScale: 1.02,
      poreClusterScale: 0.95,
      bedScale: 0.96,
      desc: "Single-Ear Lingering Phrases · Natural Hand Asymmetry & Breath"
    },
    micro_bubble_bursts: {
      name: "指尖簇状捏泡 (Rubato Micro-Pore Clusters)",
      enName: "deep fingertip squeezing triggering rubato cascades of multi-size cushioned micro-pops followed by regrip pauses",
      zhPrompt: "指尖连捏微泡簇",
      mode: "bursts",
      rateScale: 1.12,
      durationScale: 0.92,
      poreClusterScale: 1.65,
      bedScale: 0.88,
      desc: "Rubato Fingertip Squeeze · Multi-Scale Pore Cascades & Regrip Pause"
    },
    gentle_fold_roll: {
      name: "绵延折叠翻卷 (Continuous Fold & Roll)",
      enName: "non-periodic binaural rolling and double-crest folding with velvety viscoelastic shear and minimal discrete pops",
      zhPrompt: "绵延折叠翻卷（平稳推拢翻卷）",
      mode: "fold",
      rateScale: 0.88,
      durationScale: 1.28,
      poreClusterScale: 0.52,
      bedScale: 1.18,
      desc: "Non-Periodic Binaural Roll · Double-Crest Velvet Shear"
    }
  };

  // 机械键盘轴体与外设 (Keyboard Switches)
  const KEYBOARD_SWITCHES = {
    lubed_red: {
      name: "厚润线性红轴 (Lubed Linear Red - Thock)",
      enName: "lubed linear mechanical switches bottoming out on thick felt desk mat creamy thock",
      zhPrompt: "厚润线性红轴（醇厚 Thock 触底音）",
      baseFreq: 260,
      clackFreq: 580,
      springFreq: 1100,
      thockDamp: 0.045,
      warmthCutoff: 1400,
      desc: "Creamy Lubed Red · Deep Sound Dampened Thock"
    },
    topre_capacitive: {
      name: "静电容轴雨滴音 (Topre Capacitive Thock)",
      enName: "electrostatic capacitive rubber dome switches with deep raindrops thock",
      zhPrompt: "静电容轴雨滴音（胶碗低沉触底）",
      baseFreq: 180,
      clackFreq: 420,
      springFreq: 850,
      thockDamp: 0.065,
      warmthCutoff: 1150,
      desc: "Topre Rubber Dome · Raindrop Acoustic Resonance"
    },
    holy_panda: {
      name: "圣熊猫提前段落轴 (Holy Panda Tactile Pop)",
      enName: "tactile mechanical switches with rounded pronounced bump and crisp bottom-out",
      zhPrompt: "提前段落轴（轻快回弹微弹）",
      baseFreq: 320,
      clackFreq: 780,
      springFreq: 1350,
      thockDamp: 0.038,
      warmthCutoff: 1650,
      desc: "Holy Panda Tactile · Crisp Snappy Bump & Bottom-Out"
    },
    walnut_rest: {
      name: "实木掌托轻叩 (Solid Walnut Wrist Rest)",
      enName: "heavy solid walnut ergonomic keyboard wrist rest finger tapping",
      zhPrompt: "实木胡桃木掌托轻叩",
      baseFreq: 390,
      clackFreq: 820,
      springFreq: 0,
      thockDamp: 0.055,
      warmthCutoff: 1350,
      desc: "Solid Walnut Wrist Rest · Earthy Wood Acoustic Inertia"
    },
    coiled_cable: {
      name: "航插螺旋线轻弹 (Coiled Aviator Cable)",
      enName: "custom coiled aviator keyboard cable metal collar and flexible springy coil flicked",
      zhPrompt: "金属航插螺旋线轻弹",
      baseFreq: 480,
      clackFreq: 960,
      springFreq: 1550,
      thockDamp: 0.04,
      warmthCutoff: 1750,
      desc: "Coiled Aviator Cable · Flexible Spring Coil Flick"
    }
  };

  // 机械键盘打字节奏 (Keyboard Styles)
  const KEYBOARD_STYLES = {
    flow_typing: {
      name: "专注心流打字 (Flow Typing ~65 WPM)",
      enName: "rhythmic flow typing at steady 65 words per minute cadence",
      zhPrompt: "平稳心流打字（约 65 WPM）",
      baseInterval: 175,
      jitter: 0.45,
      desc: "Steady Flow Typing · 65 WPM Focused Cadence"
    },
    slow_code: {
      name: "深夜写代码沉思 (Late Night Coding ~35 WPM)",
      enName: "calm reflective programming late at night with thoughtful pauses",
      zhPrompt: "深夜慢速敲击（约 35 WPM）",
      baseInterval: 340,
      jitter: 0.75,
      desc: "Thoughtful Coding · Relaxed Night Rhythm"
    },
    single_tap_test: {
      name: "单键双耳点测 (Single Switch Binaural Audition)",
      enName: "slow deliberate single key presses alternating between left and right ear",
      zhPrompt: "单键双耳试轴逐键点按",
      baseInterval: 780,
      jitter: 0.2,
      desc: "Binaural Switch Audition · Deliberate Single Press"
    },
    rapid_burst: {
      name: "灵感代码连击 (Rapid Inspiration Burst)",
      enName: "energetic rapid code burst typing rhythm with satisfying smooth clicks",
      zhPrompt: "轻快连续击键",
      baseInterval: 115,
      jitter: 0.35,
      desc: "Rapid Inspiration Burst · Smooth Flow Cadence"
    }
  };

  // 复古模拟与深空介质 (Ambient Media)
  const AMBIENT_MEDIA = {
    vinyl_record: {
      name: "复古黑胶唱机 (Vintage Vinyl Turntable)",
      enName: "vintage analog turntable needle riding vinyl groove with warm dust crackle",
      zhPrompt: "复古黑胶唱机（温润底噪与偶发微尘爆音）",
      baseFreq: 95,
      filterFreq: 1200,
      driftRate: 0.55,
      subDrone: 0.25,
      warmthCutoff: 1350,
      desc: "Warm Vinyl Turntable · Micro-Dust Crackles & Groove Hiss"
    },
    starship_drone: {
      name: "星际飞船低频舱鸣 (Starship Cabin Ambient)",
      enName: "deep low-frequency starship cabin environmental ventilation drone sub-bass hum",
      zhPrompt: "飞船静息循环系统低频嗡鸣",
      baseFreq: 55,
      filterFreq: 380,
      driftRate: 0.15,
      subDrone: 0.85,
      warmthCutoff: 520,
      desc: "Starship Cabin Deep Drone · 55Hz Sub-Bass Environmental Cocoon"
    },
    shortwave_radio: {
      name: "模拟短波收音机 (Shortwave Radio)",
      enName: "analog shortwave radio dial searching quiet nighttime frequency drift warm whistle",
      zhPrompt: "模拟短波收音机调谐频漂白噪",
      baseFreq: 110,
      filterFreq: 950,
      driftRate: 0.85,
      subDrone: 0.15,
      warmthCutoff: 1100,
      desc: "Shortwave Radio Search · Analog Drift & Soft Heterodyne Whistle"
    },
    walkman_tape: {
      name: "磁带随身听底噪 (Walkman Cassette)",
      enName: "classic portable cassette walkman playback head tape hiss and delicate gear spin",
      zhPrompt: "磁带随身听播放头磁饱和底噪",
      baseFreq: 120,
      filterFreq: 1600,
      driftRate: 0.4,
      subDrone: 0.18,
      warmthCutoff: 1700,
      desc: "Walkman Cassette Tape · Warm Tape Saturation & Mechanism"
    },
    glacier_resonance: {
      name: "极地冰川深层共鸣 (Glacier Deep Resonance)",
      enName: "ancient polar glacier ice pack deep sub-bass resonance and micro thermal creaks",
      zhPrompt: "极地冰原深处低频共鸣与微裂",
      baseFreq: 42,
      filterFreq: 280,
      driftRate: 0.1,
      subDrone: 0.92,
      warmthCutoff: 460,
      desc: "Glacier Deep Resonance · 42Hz Cryosphere Sub-Bass & Stress Creaks"
    }
  };

  // 复古模拟与深空空间漂移 (Ambient Styles)
  const AMBIENT_STYLES = {
    deep_cocoon: {
      name: "沉浸静止空间茧 (Deep Stationary Cocoon)",
      enName: "steady motionless immersive acoustic space cocoon for deep sleep",
      zhPrompt: "稳定居中的低频背景声",
      driftSpeed: 0.2,
      orbitDepth: 0.1,
      desc: "Deep Stationary Cocoon · Absolute Calmness"
    },
    binaural_orbit: {
      name: "3Dio 双耳缓慢洄游 (Slow Binaural Orbital Drift)",
      enName: "slow continuous 3Dio binaural circular spatial orbiting around the listener",
      zhPrompt: "左右耳慢周期平滑环绕",
      driftSpeed: 0.6,
      orbitDepth: 0.85,
      desc: "Slow Binaural Orbital Drift · Gentle Spatial Floating"
    },
    pulsing_tide: {
      name: "呼吸式脉动起伏 (Breathing Sub-bass Tide)",
      enName: "rhythmic breathing tidal swell expanding and contracting gently every 6 seconds",
      zhPrompt: "舒缓低频起伏如自然呼吸",
      driftSpeed: 0.8,
      orbitDepth: 0.4,
      desc: "Breathing Sub-bass Tide · 6-Second Relaxation Rhythm"
    },
    distant_aurora: {
      name: "极光微光频散 (Distant Aurora Glow)",
      enName: "ethereal delicate spatial dispersion shimmering across the wide stereo field",
      zhPrompt: "微弱频散流动声场景",
      driftSpeed: 0.45,
      orbitDepth: 0.65,
      desc: "Distant Aurora Dispersion · Ethereal Stereo Shimmer"
    }
  };

  const DEFAULT_STATE = {
    activeCategory: "rain", // "rain" | "tapping" | "friction" | "water" | "bowls" | "tools" | "fire" | "squish" | "keyboard" | "ambient"
    isPlaying: false,

    // 雨声参数
    currentRain: "drizzle",
    currentSurface: "tent",
    dropRateMultiplier: 1.0,
    thunderVol: 0.5,
    rainGustEnv: 0.0,
    rainGustTarget: 0.0,
    rainGustPanBias: 0.0,
    rainDensityWalk: 1.0,

    // 敲击声参数
    currentTapMat: "woodbox",
    currentTapStyle: "slow",
    tapCadenceMultiplier: 1.0,
    tapSoftness: 0.7, // 0 (较轻快甲触) ~ 1 (极软肉感指腹)
    orbitStep: 0,
    orbitPhase: 0.0,
    tapHandSide: -0.68,
    tapHandPhraseRemaining: 3,
    tapBeatCounter: 0,

    // 摩擦声参数
    currentFricMat: "brush",
    currentFricStyle: "swiping",
    fricSpeedMultiplier: 1.0,
    fricCushion: 0.75, // 0 (较轻柔纤细微刷毛) ~ 1 (深厚天鹅绒钝感)
    fricHandSide: -0.72,          // 当前主导抚摩耳侧 (-1 左耳 / +1 右耳)
    fricPhraseRemaining: 3,       // 当前单耳或跨耳短语剩余抚摩次数
    fricStrokeParity: 0,          // 推(push=0) / 拉(pull=1) 往复相位，模拟顺逆毛向与推拉力度差
    fricOrbitAngle: -Math.PI / 2, // 3Dio 耳廓打圈连续相位角
    fricOrbitDir: 1,              // 打圈顺/逆时针方向 (+1 / -1)
    fricOrbitLoopsLeft: 4,        // 当前打圈方向或单耳局部绕圈剩余步数
    fricLastEndPan: -0.58,        // 上一次慢抚结束方位，保障连续轨迹衔接与自然游走
    fricPressureWalk: 1.0,        // 抚摩压力均值回归随机游走 (0.72 ~ 1.24)

    // 水流声参数
    currentWaterScene: "spring",
    currentWaterStyle: "meander",
    waterSpeedMultiplier: 1.0,
    waterSoftness: 0.7, // 0 (清润水滴与微泡) ~ 1 (深沉温润水幕与软钝微澜)
    waterFlowEnv: 0.0,            // 水流非周期湍流呼吸随机包络 (-0.45 ~ +0.45)
    waterFlowTarget: 0.0,         // Ornstein-Uhlenbeck 均值回归目标值
    waterPanBias: 0.0,            // 水流空间微漂移偏置
    waterDensityWalk: 1.0,        // 水相微事件疏密均值回归随机游走 (0.55 ~ 1.45)
    waterLastPitchNorm: 0.5,      // 上一颗水泡/水滴归一化频段位置，防止相邻同频重复
    waterEddyDir: 1,              // 双耳洄游顺/逆旋方向 (+1 / -1)
    waterEddyStepsLeft: 5,        // 当前洄游方向或单耳漩涡驻留剩余步数

    // 能量钵铃参数
    currentBowlInst: "tibetan",
    currentBowlStyle: "single",
    bowlDecayMultiplier: 1.0,
    bowlWarmth: 0.75, // 0 (清透高位微泛音) ~ 1 (极致温润厚重低次谐波)
    bowlDensityWalk: 1.0,        // 颂钵敲击均值回归密度游走 (0.75 ~ 1.35)
    bowlRimPressureWalk: 1.0,    // 钵口环磨压力均值回归游走 (0.80 ~ 1.25)
    bowlRimSpeedWalk: 1.0,       // 钵口环磨转速微律动 (0.85 ~ 1.15)
    bowlLastPitchNorm: 0.5,      // 上一次风铃/音阶归一化音高，避开相邻同音
    bowlEarSide: -0.65,          // 敲击或驻留主导耳侧 (-1 左 / +1 右)
    bowlPhraseRemaining: 3,      // 单侧耳畔敲击驻留次数

    // 伴读工具与微机械参数
    currentToolInst: "scissors",
    currentToolStyle: "binaural_trim",
    toolPaceMultiplier: 1.0,
    toolWarmth: 0.70, // 0 (清透微脆) ~ 1 (温厚阻尼柔和吸音)
    toolDensityWalk: 1.0,        // 工具动作速率均值回归游走 (0.78 ~ 1.28)
    toolHandSide: -0.75,         // 当前主导耳侧 (-1 左 / +1 右)
    toolPhraseRemaining: 3,      // 当前单侧耳畔微动作剩余次数
    toolTypewriterCol: 0,        // 当前打字机行内光标列 (0 ~ 65)
    toolMusicBoxTempoWalk: 1.0,  // 八音盒发条节拍微律动 (0.97 ~ 1.03)

    // 暖冬壁炉与自然碎裂参数
    currentFireInst: "pine_fireplace",
    currentFireStyle: "hearth_calm",
    fireRateMultiplier: 1.0,
    fireWarmth: 0.75,             // 0 (松脆清亮) ~ 1 (温厚深沉低频对流)
    fireConvectionEnv: 0.0,       // 壁炉非周期热对流随机呼吸包络 (-0.42 ~ +0.45)
    fireConvectionTarget: 0.0,    // Ornstein-Uhlenbeck 热流均值回归目标
    firePanBias: 0.0,             // 热流声像微漂移偏置
    fireDensityWalk: 1.0,         // 微事件疏密均值回归随机游走 (0.52 ~ 1.38)
    fireLastPitchNorm: 0.5,       // 上一次微爆/微裂归一化频段位置，强制相邻事件异频
    fireEarSide: -0.72,           // 近耳驻留当前主导耳侧 (-1 左耳 / +1 右耳)
    firePhraseLeft: 3,            // 单侧耳畔或漫步乐句剩余步数

    // 触觉揉捏与软胶参数
    currentSquishMat: "memory_foam",
    currentSquishStyle: "deep_slow_press",
    squishCadenceMultiplier: 1.0,
    squishViscosity: 0.75,        // 0 (较清透微气孔) ~ 1 (极深沉软糯阻尼)
    squishDeformEnv: 0.0,         // 非周期粘弹性形变呼吸包络 (-0.42 ~ +0.45)
    squishDeformTarget: 0.0,      // Ornstein-Uhlenbeck 形变均值回归目标
    squishPanBias: 0.0,           // 双耳揉捏声像微漂移偏置
    squishDensityWalk: 1.0,       // 揉捏节拍疏密均值回归游走 (0.64 ~ 1.44)
    squishLastPitchNorm: 0.5,     // 上一次微泡/微褶归一化频段，强制相邻事件异频
    squishPhraseLeft: 2,          // 单侧耳畔驻留揉捏剩余次数
    squishDimplePolarity: 1,      // 硅胶按按乐双稳态正反翻转极性 (+1 下压 / -1 回弹顶出)
    squishFocusAz: 0.0,           // 当前揉捏视觉重心声像 (-1 ~ +1)

    // 机械键盘参数
    currentKeySwitch: "lubed_red",
    currentKeyStyle: "flow_typing",
    keyCadenceMultiplier: 1.0,
    keyThockDamping: 0.75, // 0 (清脆段落触感) ~ 1 (深沉厚润 Thock)
    keyHandAlternation: 0, // 左右手交替索引
    keyWordKeysLeft: 4,          // 当前单词剩余字符数 (3 ~ 8)
    keyInTypoCorrection: false,  // 是否正在进行错字回退修正
    keyTypoBackspacesLeft: 0,    // 剩余退格键次数
    keyCadenceWalk: 1.0,         // 打字心流均值回归游走 (0.82 ~ 1.22)
    keyConsecutiveHandCount: 0,  // 同手连续击键计数，模拟手腕微时差

    // 复古模拟与深空参数
    currentAmbMedia: "vinyl_record",
    currentAmbStyle: "deep_cocoon",
    ambDepth: 0.75, // 0 (轻浅背景) ~ 1 (深邃次低频包裹)
    ambGrain: 0.65, // 0 (极净无杂质) ~ 1 (醇厚模拟微尘颗粒)
    ambOrbitPhase: 0,
    ambDriftWalk: 0.0,            // 空间与声相均值回归游走 (-0.4 ~ +0.4)
    ambFilterWalk: 1.0,           // 模拟低通均值回归微漂移 (0.85 ~ 1.15)
    ambTurntableAngle: 0.0,       // 33⅓ RPM 黑胶转盘角度相位 (0.55 Hz)
    ambRadioWhistleFreq: 460.0,   // 短波电台外差啸叫连续漫游频率
    ambRadioWhistleTarget: 460.0, // 短波目标频率
    ambVinylSpeckRemaining: 0,    // 黑胶划痕连环微爆计数 (模拟周期性微尘)

    // 通用声学
    visualMode: "scenic", // scenic | radar | minimal
    stereoWidth: 1.0,
    userLowpass: 1800,
    masterVol: 0.75,
    sleepTimerMinutes: 0,
    sleepTimerEnd: 0
  };

  window.AsmrPresets = { RAIN_PRESETS, RAIN_SURFACES, TAPPING_MATERIALS, TAPPING_STYLES, FRICTION_MATERIALS, FRICTION_STYLES, WATER_SCENARIOS, WATER_STYLES, BOWLS_INSTRUMENTS, BOWLS_STYLES, TOOLS_INSTRUMENTS, TOOLS_STYLES, FIRE_INSTRUMENTS, FIRE_STYLES, SQUISH_MATERIALS, SQUISH_STYLES, KEYBOARD_SWITCHES, KEYBOARD_STYLES, AMBIENT_MEDIA, AMBIENT_STYLES, DEFAULT_STATE };
})();
