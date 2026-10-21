# 浏览器导出性能记录

日期：2026-10-19～20。本轮集中于静态网站中的浏览器视频导出。

## 改动

性能采样发现，既有捕获会读取并序列化当前帧中完全不可见的图层内容。两套模板 18 帧分别发生约 315 万和 281 万次样式属性读取，SVG 图片解码也占明显时间。这些带仪器的采样用于定位瓶颈，不用于计算最终提速。

`captureInto()` 现在启用不可见图层裁减：保留绝对定位、固定尺寸图层的计算布局框，跳过完全透明的内容；对 `visibility:hidden` 额外检查后代和伪元素是否恢复可见。普通文档流的内容继续捕获，避免改变文字占位和兄弟布局。

含 SVG 定义的图层按需建立资源引用索引，核对样式表、行内声明、SVG 属性、href 和 Web Animations。资源在图层内部自用时可以一起跳过；被外部引用或无法可靠确定引用时保留。索引仅在当前帧需要时生成，每帧重新判断，支持倒退与循环采样，不使用跨帧布局或样式缓存。

背景视频直接接入已安装的 Mediabunny 1.61.4：使用 `Input`／`BlobSource`、`CanvasSink({ poolSize: 1, alpha: true })` 和 `canvasesAtTimestamps()`。采样时间按输出帧生成，循环时回到源视频开头；包复用、解码预取及选帧均由库实现。本项目只适配 SVG 捕获的图片输入和任务生命周期。输出帧率较高而连续命中同一源帧时，根据库返回的时间戳复用当前 PNG；只保留当前图片，不建立另一套帧池。视频节点保留原来的布局和 CSS，释放原生视频源并跳过原生 seek；PNG 只注入捕获副本，避免在舞台上再加载解码一次。完成、失败、取消与重新初始化会 `Input.dispose()` 并关闭迭代器。

源码核对：[Mediabunny v1.61.4 media-sink.ts](https://github.com/Vanilagy/mediabunny/blob/v1.61.4/src/media-sink.ts)（MPL-2.0），[WebAV Combinator](https://github.com/WebAV-Tech/WebAV/blob/42dd6fd65ccbda39c729265c14aab56ac4d28235/packages/av-cliper/src/combinator.ts)、[ImgClip](https://github.com/WebAV-Tech/WebAV/blob/42dd6fd65ccbda39c729265c14aab56ac4d28235/packages/av-cliper/src/clips/img-clip.ts)（MIT）。WebAV 面向已经栅格化的素材，直接替换不能消除现有 HTML/CSS 捕获成本，因此这一轮复用 Mediabunny 的现成接口，没有引入第二套合成器或复制上游解码源码。

缺少完整色彩元数据时，原生视频和 WebCodecs 可能采用不同的色彩推断；这类视频及 HDR、不支持的编解码器和准备失败的素材保留原生捕获。确切帧边界的浮点舍入差，通过在原生对照中采样到同一源帧区间内部消除。带完整 BT.709 标记的 24／60 fps H.264 源，在两套模板的 30 fps 输出、循环和缩放平移测试中，与原生完整捕获对照。classic 的最大通道差为 1；season2627 的少量模糊／抗锯齿边缘存在额外舍入差，完整捕获的重复栅格化也会出现。测试同时约束全帧平均通道差小于 0.001、最大差不超过 8，避免颜色变化或错帧仅因平均值很小而通过。

现有完整捕获作为对照路径保留，卡片 PNG 继续使用完整捕获。本轮未新增运行依赖、调整分辨率／帧率或改变编码质量参数。分层栅格缓存和 Worker 管线仍是后续评估项，背景视频的 PNG／SVG 中转仍存在。单个池化 Canvas 只描述适配层的复用，不代表解码器及整个导出流程只有一个缓冲。

## 可复现测量

1. 启动开发服务后运行 `npm run test:export-resources`，生成固定素材的 `test-results/export-resources/state.json`；也可通过 `BENCH_PROJECT` 指定其他完整项目 JSON。该脚本的开发环境采样与生产基准分开报告。
2. 执行 `npm run build`，再运行以下基准。基准自行启动静态文件服务，不需要本地渲染 API。

```powershell
$env:BENCH_LABEL = 'reference'
$env:BENCH_REFERENCE = '1'
npm run bench:browser-export

$env:BENCH_LABEL = 'optimized'
$env:BENCH_REFERENCE = '0'
npm run bench:browser-export
```

`BENCH_REFERENCE=1` 仅在基准浏览器中注入完整捕获实现，复用当前构建中的同一编码、封装和文件输出路径；产品不提供测试模式开关。这样可在同一构建中比较裁减的收益，避免其他未提交改动混入对照。

默认以 720p／30 fps 测量，每套模板先预热一轮，再测 5 轮、每轮 18 个动画时间点，报告批次耗时中位数、吞吐和逐帧 P95。随后从真实编辑界面完整导出 3 次短片，报告完整导出耗时中位数；短片关闭开场、教练及逐排出场，结果须与动画采样区分。

- `BENCH_HEIGHT`：720、1080、1440 或 2160；`BENCH_FPS`：30 或 60。
- `BENCH_RUNS`：帧采样轮数；`BENCH_VIDEO_RUNS`：完整视频导出次数。
- `BENCH_FULL_STYLE=lines`：完整导出包含逐排出场动画，仍关闭开场与教练；默认 `off`。
- `BENCH_SKIP_VIDEO=1`：仅测画面生成。
- `BENCH_BACKGROUND`：给完整 UI 导出附加本地视频文件；18 个动画时间点的采样仍使用原项目背景，与完整视频场景分别解读。
- `BENCH_NATIVE_VIDEO=1`：仅在基准中禁用 Mediabunny 视频取帧，保持相同捕获、编码与输出路径，以隔离解码接入的收益；报告中的 `decodedVideoRounds` 记录每轮实际使用的路径。
- `BENCH_COMPARE_VIDEO=1`：同一浏览器内交替运行原生与 Mediabunny 路径，每种各 `BENCH_VIDEO_RUNS` 次，并交替先后顺序；分别记录原始耗时和中位数。配合 `BENCH_NATIVE_VIDEO=0` 使用。

视频背景对照示例，使用带完整 BT.709 元数据的两秒 720p／30 fps 测试视频：

```powershell
ffmpeg -hide_banner -loglevel error -y -f lavfi -i testsrc2=size=1280x720:rate=30:duration=2 -c:v libx264 -preset fast -crf 23 -bf 2 -g 60 -x264-params colorprim=bt709:transfer=bt709:colormatrix=bt709:fullrange=off -pix_fmt yuv420p test-results/browser-video-frames/720.mp4
$env:BENCH_LABEL = 'background-alternating'
$env:BENCH_BACKGROUND = 'test-results/browser-video-frames/720.mp4'
$env:BENCH_REFERENCE = '0'
$env:BENCH_NATIVE_VIDEO = '0'
$env:BENCH_COMPARE_VIDEO = '1'
$env:BENCH_VIDEO_RUNS = '3'
npm run bench:browser-export
```

结果、输入项目副本与最后一次 MP4 写入 `test-results/browser-performance/`。比较时固定素材、机器、浏览器、输出规格、构建及采样配置，串行运行两条路径；同时记录冷启动、运行顺序与波动。不要同时运行其他浏览器测试。

## 已测结果

测试机器为 Windows 10.0.26300、Intel Core Ultra 9 285H、Chrome 155.0.8059.84。输出 720p／30 fps，编码质量参数相同；没有确认实际采用的硬件编码器。以下均为特定夹具的同机数据，不能换算成所有项目的固定提速。

先单独比较完整捕获与不可见图层裁减，未附加背景视频。每套模板 5 轮帧采样、3 次完整短片导出；报告分别保存在 `reference.json` 和 `optimized.json`。

| 模板 | 18 帧画面生成中位数：完整 → 裁减 | 完整短片导出中位数：完整 → 裁减 |
| --- | --- | --- |
| classic | 3.246 → 1.250 秒 | 13.171 → 12.797 秒 |
| season2627 | 2.136 → 0.550 秒 | 9.597 → 8.456 秒 |

帧采样分别节省约 61.5%／74.2%；完整短片仅约 2.8%／11.9%，其中 classic 的变化在运行波动范围内。这说明减少动画捕获工作不等于整段导出获得相同倍数提升。较长逐排动画还留有单次探索结果 `reference-lines.json`／`optimized-lines.json`，不作为稳定收益结论。

再单独比较背景视频取帧：保持图层裁减、编码和输出相同，使用两秒、带完整 BT.709 标记的 720p／30 fps H.264 测试源。每套模板在同一个浏览器中交替导出，每条路径各 3 次，顺序为原生／库、库／原生、原生／库。结果保存在 `background-direct.json`；`nativeVideoMedianMs` 和 `decodedVideoMedianMs` 是两组中位数，比较模式下混合的 `fullExportMs` 不用于结论。

| 模板 | 原生完整导出中位数（范围） | Mediabunny 中位数（范围） | 默认接入决定 |
| --- | --- | --- | --- |
| classic | 23.144 秒（22.600～24.942） | 21.047 秒（20.336～21.376） | 节省约 9.1%，默认启用 |
| season2627 | 20.478 秒（20.433～21.430） | 20.992 秒（20.644～21.057） | 中位数增加约 2.5%，未显示稳定收益，保留原生取帧 |

这组场景分别输出 183 帧／6.1 秒和 180 帧／6.0 秒；两条路径的 H.264、1280 × 720、30 fps、帧数与时长一致。与原生完整输出对照，成品解码后的全片 SSIM 分别约 0.9989／0.9979，作为编码后画面的补充检查。选帧和色彩正确性主要由未编码画面对照测试约束。

因此产品只在 classic 默认调用新的取帧适配；season2627 的同一接口保留用于独立验证，基准会在浏览器注入层显式调用它。缺少色彩信息等素材限制仍适用。初期分组连续运行的 `native-background.json`／`decoded-background.json` 以及使用舞台图片的 `background-alternating.json` 仅作探索记录，不替代上述最终交替对照，也不作为默认接入依据。

## 验证范围

使用优化前固定时间点的像素哈希和保留的完整捕获对照两套模板，验证 Canvas 复用与背景视频循环。专用测试覆盖透明度动画、倒退采样、文档流占位、可见子元素／伪元素、私有 SVG 定义、外部样式及动画引用、href 和编码后的资源片段。

已通过类型检查、生产构建、`test:export-visibility`、`test:export-styles`、`test:export-resources`、`test:playback-pause`、`test:browser-video-frames`、`test:browser-export`（720p）和 `test:static-export`。真实 H.264 导出为 1280 × 720／30 fps，卡片覆盖 1024／2048／4096 及透明边界。静态构建通过 UI 完成 PNG／MP4 下载，零本地导出 API 请求。背景视频专用测试覆盖两套模板、原生画面对照、零逐帧 seek、循环、重复源帧的 PNG 复用、色彩／解码回退、重复初始化、提前释放和活动取消。

最终回归有一次静态导出等待停滞，该轮已中止；独立新浏览器诊断及原测试脚本再次运行均通过，未复现这一现象。此记录不作为已完成长时稳定性验证的依据。

跨系统／GPU、真实手机、4K 长视频内存曲线、HDR 提速及可变帧率素材尚未实测。本轮不承诺固定内存或所有素材都能使用快速路径。

## 第二轮：真实项目素材（2026-10-20）

第一轮的基准夹具只有 76 KB，几乎没有照片；真实项目（42 MB，24 张 0.9～2.3 MB 的 PNG 立绘）每帧 SVG 约 25 MB，SVG 解码约占四成。本轮针对素材体积与重复工作，改动均只作用于视频帧捕获；卡片 PNG 仍为原图嵌入的完整捕获。

### 改动

- **立绘按显示尺寸缩小**：`<img>` 按 `getBoundingClientRect()`（含祖先 transform）与原图尺寸计算所需倍率，乘以 3 倍余量，按四分之一倍频程分档；用 Canvas `imageSmoothingQuality='high'` 缩小后以 PNG 嵌入，按“原图＋档位”缓存一次导出。SVG 图片、`object-fit:none`、档位 ≥ 0.75 时保留原图；失败回退原图。缩放共用一个临时 Canvas，按顺序执行。
- **SVG 轻量编码**：data URL 只转义 `% # \t \n \r`，不再把嵌入 base64 的 `+ / =` 膨胀为三个字符。与完整编码逐像素一致。
- **重复帧复用**：序列化后的 SVG 与上一帧完全相同且写入同一目标时，跳过解码与绘制，目标 Canvas 已是同一像素。背景视频每帧不同，不受益。
- **样式属性名单增量收集**：样式表规则与动画关键帧各读取一次（新插入或替换的规则是新对象，会重新读取），行内样式每帧读取；名单只增不减，最多比当帧所需多读一些属性，像素不变。
- **缩放缓存改为按原图、再按档位两层查找**：避免每张图每帧拼接、哈希数 MB 的 data URL 字符串。
- **背景视频帧异步编码与预取**：Mediabunny 解码帧改用 `toBlob()`（浏览器在工作线程编码 PNG），并在捕获当前帧时预取下一源帧；输出仍是同一 PNG 像素。
- **上传字体子集化**：项目包含上传字体时，用 [harfbuzzjs](https://github.com/harfbuzz/harfbuzzjs) 1.6.3 的 HarfBuzz 子集器（MIT／HarfBuzz Old MIT）把字体缩到舞台显示的字符，保留全部 OpenType 特性；WOFF2 先经 [wawoff2](https://github.com/fontello/wawoff2) 2.0.1（Google WOFF2、Brotli，MIT）解包。首帧以舞台全文、大小写变体、ASCII 与常用标点为覆盖集，之后出现新字符时扩大并重新子集化；任何失败嵌入原字体。内置字体本身是 unicode-range 拆分的小 WOFF2，不做子集化。两者只在需要时懒加载（WASM 约 270 KB gzip，解码器约 131 KB gzip）。
- **HTML-in-Canvas 快速路径（实验）**：浏览器提供 [WICG HTML-in-Canvas](https://github.com/WICG/html-in-canvas) 的 `drawElementImage()`／`requestPaint()` 时，导出舞台挂到 `drawable` Canvas 下，由浏览器原生绘制，跳过序列化与 SVG 解码。初始化时在时间轴 15%／35%／55%／75%／95% 五点与 SVG 捕获对照，平均差 < 2、16×16 块最差均值 < 48、差值 > 64 的像素 < 1% 才启用，否则重建舞台回到 SVG；任一帧 2 秒内未收到绘制（例如标签页转入后台）即永久回到 SVG。快照不执行 `backface-visibility` 剔除，绘制前把背向的面临时设为透明，绘制后恢复。背景视频项目不启用（解码帧只注入 SVG 副本）。Chrome 155 需 `chrome://flags/#canvas-draw-element` 或 `--enable-blink-features=CanvasDrawElement`；默认用户走 SVG 路径。

### 背景视频：两套模板都改用 Mediabunny 解码

解码帧改为异步编码并预取后，重新交替对照（两秒 720p／30 fps BT.709 测试视频、固定夹具，每条路径 3 次，顺序为原生／库、库／原生、原生／库，结果 `video-both.json`）：

| 模板 | 原生中位数 | Mediabunny 中位数 |
| --- | --- | --- |
| classic | 37.3 秒（36.2～38.7） | 28.8 秒（27.4～39.8） |
| season2627 | 30.5 秒（29.8～30.6） | 27.8 秒（26.0～28.0） |

season2627 三次解码路径均快于三次原生路径，因此两套模板都默认调用 `prepareVideo()`；它在已准备好时直接返回，避免重复调用拆掉解码器。上一轮 season2627 未显示收益的结论由此更新。

### 已否决

- **Blob URL 加载 SVG**：含 foreignObject 的 SVG 经 Blob URL 加载会污染 Canvas，且不可撤销，“先试后回退”也不可行。
- **`createImageBitmap(resizeQuality:'high')` 缩小立绘**：比 Canvas 缩放更软、更慢。
- **wawoff2 包入口**：其 Emscripten 绑定只在 Node 环境导出 `Module`，浏览器中 `decompress()` 永远等待初始化，导出卡住（交接时记录的“页面崩溃”）。现以 `?raw` 读入绑定源码，交给自建的 `Module` 运行；WASM 以内联 data URI 提供，不额外请求。

### 画面差异

立绘缩小会改变高频边缘（发丝、线稿、球衣细条纹）的重采样。真实项目 720p，与原图嵌入对照（各 8 个时间点）：

| 模板 | 变化像素（最差帧） | 差值 > 64 的像素 | 16×16 块最差均值 | 最大通道差 |
| --- | --- | --- | --- | --- |
| classic | 8.9% | 200 | 13.5 | 128 |
| season2627 | 8.4% | 110 | 11.5 | 128 |

两条路径与原生截图的距离几乎相同（classic 最差帧平均差 1.821 对 1.834，season2627 1.704 对 1.709）；SVG 捕获本身与原生截图的块差约 35，缩小带来的差异远在其内。放大对照中原图路径的发丝、条纹有轻微锯齿，缩小路径更平滑。固定夹具 `test:export-resources` 中缩小后最多 725 个像素变化、最大通道差 32；该测试改为：全分辨率捕获与优化前哈希逐像素一致，视频帧按容差（平均差 < 0.01、块最差均值 < 3、最大通道差 ≤ 64）对照。

轻量编码、重复帧复用、样式名单、视频帧编码与上传字体子集化均逐像素一致（字体：上传 9.7 MB 黑体 TTF 与 Anton WOFF2，两套模板各 4 个时间点）。HTML-in-Canvas 五点校验（真实项目）：classic 平均差 ≤ 1.51、块最差均值 ≤ 30、差值 > 64 的像素 ≤ 0.87%；season2627 ≤ 1.34、≤ 26.7、≤ 0.69%。剔除背面之前，season2627 最终阵型的卡背盖住正面（平均差 12.4），被校验拦下。

### 测量

机器与上一轮相同（Windows 10.0.26300、Core Ultra 9 285H、Chrome 155.0.8059.85），真实项目 `matchday-lineup (1).json`，720p／30 fps，`bench:browser-export` 每套模板 3 轮帧采样、3 次完整界面导出（关闭开场、教练与逐排出场）。“上一轮默认”通过 `BENCH_REFERENCE=1 BENCH_CAPTURE='{"pruneInvisible":true}'` 在同一构建中注入。

| 模板 | 完整导出中位数：上一轮默认 → 本轮（立绘缩小＋轻量编码） |
| --- | --- |
| classic | 145.6 → 55.7 秒（142.4～152.0 → 53.4～60.1） |
| season2627 | 58.8 → 29.9 秒（55.6～65.4 → 28.6～35.1） |

其余改动（重复帧复用、样式名单、缩放缓存键、视频帧异步编码）合入后的完整导出未完成测量：最终基准被中止，classic 仅有一次 61.4 秒，与上表 55.7 秒处于同一波动范围，未显示额外收益。HTML-in-Canvas 也未在真实界面导出（屏幕外 iframe）中完成测量。

单独的帧捕获（8 个时间点，同页交替）：立绘缩小＋轻量编码 classic 805 → 410 ms／帧，season2627 337 → 308 ms／帧；HTML-in-Canvas classic 约 26 ms／帧、season2627 约 13 ms／帧。上传 9.7 MB 中文字体时，子集化后的帧捕获约 800 → 140 ms（首帧建立子集约 430～510 ms）。18 帧采样批次在 season2627 上波动很大（三轮 1.4～4.0 秒），不作为结论。

本轮按“合并实现、整体测量”进行，没有逐项拆分各改动的耗时。

### 复现

- `BENCH_CAPTURE`：配合 `BENCH_REFERENCE=1`，以指定的捕获选项注入参照路径，例如 `'{"pruneInvisible":true}'` 为上一轮默认。
- `BENCH_CHROME_ARGS`：附加浏览器参数，例如 `--enable-blink-features=CanvasDrawElement` 测 HTML-in-Canvas。
- `CHROME_ARGS=--enable-blink-features=CanvasDrawElement npm run test:export-backface`：在 HTML-in-Canvas 路径上核对 3D 翻转、侧立与倒退，并断言该路径通过了校验。
- `npm run test:export-reuse`、`npm run test:export-font-subset`：重复帧复用与上传字体子集化（需先运行 `test:export-resources` 生成夹具）。

### 尚未覆盖

HTML-in-Canvas 仍是开发者试用接口，属性名与行为可能变化；只在本机 Chrome 155 打开开关测过，未覆盖背景视频、其他 GPU 与系统。立绘缩小只用于视频帧；1080p 以上与 4K 的画面差异与收益未单独测量。字体子集化未覆盖字体集合（TTC）与 WOFF1，这两类直接嵌入原字体。

## 第三轮：渲染进程内存（2026-10-21）

### 发现

基准新增内存采样：每秒经 CDP `SystemInfo.getProcessInfo` 取浏览器各进程 PID，按进程类型汇总 Windows 私有字节；编辑器页面的 JS 堆经 `Performance.getMetrics` 读取（同源导出 iframe 在同一进程，包含在内）。GPU 显存不在其中。

真实项目 1080p／60 fps 完整导出时，渲染进程私有内存随帧数近似线性增长：classic 每秒约增 45 MB，3 分钟到约 9 GB；JS 堆峰值只有约 0.3～0.4 GB。导出完成、iframe 移除后内存不回落，下一次导出从约 9.5 GB 继续涨到 11 GB。

逐项排除（`scripts/probe-capture-memory.mjs`，classic 前 360 帧）：跳过绘制、改用软件 Canvas 都同样增长到约 8.6 GB；只序列化 SVG 不解码则基本持平（约 0.5～0.9 GB）。最小复现（`scripts/probe-svg-image-memory.mjs`）表明：Chromium 每解码一张含 foreignObject 的 SVG data URL，约保留 0.2 MB 加上与 URL 长度相当的内存，直到渲染进程结束；与栅格尺寸、内嵌图片解码后的像素量无关，换新的 `Image`、轮换同源 iframe、闲置并强制 GC 均不释放。不含 foreignObject 的 SVG 闲置后可回收。

已否决：把解码放到沙箱 `srcdoc` iframe（独立进程，移除后约 5 秒内全部释放）——不透明源中 foreignObject SVG 会污染位图，无法传回编码器（`crossOrigin` 无效；普通 PNG、普通 SVG 不受影响）。`createImageBitmap` 不能解码 SVG Blob。静态站点没有第二个真实源，进程隔离路线暂不可行。

因此可做的是缩小每帧 SVG：保留量和解码耗时都随它下降。classic 每帧 SVG 13.25 MB，其中 27 张图片占 12.36 MB；卡片立绘显示约 280 px 高，3 倍余量需要约 850／1200 源像素，落入“保留原图”档位，以约 2 MB 的无损 PNG 原图嵌入。

### 改动

- **浏览器导出的图片改为 WebP**：`compactImages` 下，栅格图片按所需尺寸（不超过原图）重新编码为质量 0.9 的 WebP，包括原先保留原图的档位；结果不比原图小时仍用原图。浏览器不支持 WebP 编码（返回 PNG）时沿用原 PNG 规则。classic 每帧 SVG 从 13.25 MB 降到 3.02 MB。
- **背景视频帧**：不透明视频改为 JPEG（0.92），可能透明（Mediabunny `canBeTransparent()`）的改为 WebP；原为每帧一张 PNG。
- 两项只在渲染页位于 iframe 中（浏览器导出）时启用；本地渲染页是顶层页面，仍为无损像素。
- **无 OPFS 时的内存输出**：顺序追加只添加分块，覆盖已写字节（如 MP4 预留头）时才合并，不再每块重建整个 Blob。

### 测量

机器同前（Windows 10.0.26300、Core Ultra 9 285H、Chrome 155.0.8059.85）。真实项目，1080p／60 fps，关闭开场、教练与逐排出场；同一浏览器内每套模板连续 3 次界面导出。基线为本轮改动前的生产构建（`BENCH_DIST=test-results/dist-browser-baseline`），结果 `mem-baseline-1080p60.json`／`mem-compact-1080p60.json`。

| 模板 | 完整导出（3 次） | 中位数 | 渲染进程峰值（3 次） |
| --- | --- | --- | --- |
| classic 基线 | 191.4／184.9／183.6 秒 | 184.9 秒 | 9.0／11.1／10.8 GB |
| classic 本轮 | 88.0／82.9／79.8 秒 | 82.9 秒 | 4.5／4.9／4.9 GB |
| season2627 基线 | 72.3／76.3／81.1 秒 | 76.3 秒 | 3.4／4.0／3.7 GB |
| season2627 本轮 | 46.5／43.0／43.4 秒 | 43.4 秒 | 2.2／2.6／2.8 GB |

完整导出约快 55%／43%。GPU 进程峰值两边相近（约 1.0～1.25 GB），JS 堆峰值约 0.25～0.45 GB。第二、三次导出开始时浏览器总私有内存仍停留在上一次的水平（classic 基线约 9.6～10.1 GB，本轮约 4.7～4.8 GB）：泄漏量缩小了，但没有消除，导出后仍不释放。

本轮按“合并实现、整体测量”进行，两项压缩未拆分各自收益；基准项目无背景视频，视频帧 JPEG 的收益未计入。

### 画面差异

`scripts/compare-compact-frames.mjs` 在同一构建中，对比 iframe 内（压缩）与顶层（无损）渲染页的同一输出帧，真实项目 1080p，每套模板 8 帧：

| 模板 | 平均差 | 变化像素 | 差值 > 16 | 16×16 块最差均值 | 最大通道差 |
| --- | --- | --- | --- | --- | --- |
| classic | ≤ 0.152 | ≤ 10.6% | ≤ 0.23% | 8.0 | 90 |
| season2627 | ≤ 0.142 | ≤ 10.5% | ≤ 0.18% | 7.5 | 91 |

与上一轮立绘缩小相对原图的差异（变化像素 8.9%、块最差均值 13.5、最大 128）处于同一量级。最差块所在区域的 2 倍放大对照（`test-results/compact-frames/`）中，线稿、发丝、球衣条纹与队徽目视无差别。差异集中在立绘高频边缘。

### 复现

```powershell
$env:BENCH_PROJECT = 'E:/Downloads/matchday-lineup (1).json'
$env:BENCH_HEIGHT = '1080'; $env:BENCH_FPS = '60'
$env:BENCH_SKIP_FRAMES = '1'; $env:BENCH_VIDEO_RUNS = '3'
$env:BENCH_LABEL = 'mem-current-1080p60'
node scripts/bench-lock.mjs browser-export -- node scripts/benchmark-browser-export.mjs
```

新增开关：`BENCH_DIST`（另一份生产构建目录）、`BENCH_SKIP_FRAMES`（跳过帧采样）、`BENCH_TEMPLATES`（如 `classic`）、`BENCH_MEMORY=0`（关闭内存采样）。每轮的 `memoryRounds[].series` 为每秒 `[秒, 渲染进程 MiB, GPU MiB, JS 堆 MiB]`。

### 尚未覆盖

泄漏仍与帧数成正比，长视频、4K 和低内存设备的峰值未测；Chrome 在内存压力下会回收一部分（基线第二次导出中途从约 10 GB 回落到约 6 GB），低内存机器上是回收还是崩溃未验证。背景视频项目、无 OPFS 的内存输出路径、Safari／Firefox 均未做完整对照。导出后释放内存需要独立进程，例如在单独的导出标签页中完成整个导出，尚待评估。

## 第四轮：跳过未变化帧的序列化（2026-10-21）

### 发现

`BENCH_PROFILE=1` 把导出循环拆成 `frame()`、`captureInto()`、SVG 解码和其余部分（编码提交与让出主线程）。真实项目 1080p60：classic 捕获 101.9 秒中解码 46.9 秒，其余约 55 秒为序列化（样式读取、克隆、拼接）；编码等待只有 2.4 秒（season2627 为 3.0 秒），捕获与编码重叠没有意义。season2627 只解码约四分之一的帧，其余帧序列化后与上一帧完全相同，但每帧仍要完整序列化约 120 ms 才能发现这一点。

CPU 采样（`scripts/profile-capture-cpu.mjs`，未压缩构建按行汇总）中，`getPropertyValue` 约 61 ms／帧，`image.src` 赋值约 20～26 ms／帧（`scripts/probe-svg-url-encoding.mjs`：轻量编码仍优于完整编码与 base64），其余主要是 SVG 解析、布局与异步解码等待。

### 改动

`reuseUnchanged` 在序列化之前判断帧是否不变：文档没有 MutationObserver 记录、字体与提供的视频帧相同，且每个动画的贡献与上次捕获时相同。贡献按动画计：

- 计算进度落入的关键帧区段；两端为全部动画属性设置相同值的区段（停留、舞台时钟）记为“停留 i”，否则记录进度与迭代次数；
- 只改变 opacity、transform、filter、clip-path 等绘制属性的效果，若目标元素或祖先 opacity 为 0、display 为 none（`checkVisibility({ opacityProperty: true })`），记为“隐藏”；
- 只对时间值变化的动画查询可见性，未变化的沿用上次的贡献。

原生 `<video>` 每帧都视为变化。classic 有持续循环的光束、全息闪光与滚动条，不会出现可跳过的帧。

### 正确性

`npm run test:export-skip`（`EXPORT_PROJECT` 可指定项目）逐帧对比产品捕获与不复用的完整捕获，要求全部像素一致：

| 项目 | 模板 | 帧数 | 跳过序列化 | 实际解码 | 不一致帧 |
| --- | --- | --- | --- | --- | --- |
| 夹具（开场、教练、逐排） | classic | 572 | 0 | 572 | 0 |
| 夹具（开场、教练、逐排） | season2627 | 592 | 268 | 260 | 0 |
| 真实项目 | classic | 558 | 0 | 558 | 0 |
| 真实项目 | season2627 | 548 | 296 | 187 | 0 |

### 测量

本轮机器状态与上一轮不同：上一轮构建的 classic 重测从约 83 秒变为 108～116 秒（交流供电、平衡模式，原因未查明），跨日数据不能直接比较。因此在同一时段交替运行上一轮构建（`dist-browser-compact`）与本轮构建，每套模板各 3 次，真实项目 1080p／60 fps：

| 模板 | 上一轮构建 | 本轮 | 渲染进程峰值：上一轮 → 本轮 |
| --- | --- | --- | --- |
| classic | 114.8／113.9／115.7 秒 | 112.4／108.5／111.6 秒 | 4.2～4.5 → 4.0～4.4 GB |
| season2627 | 62.5／65.7／60.4 秒 | 31.8／32.7／33.1 秒 | 1.9～2.1 → 1.7～1.9 GB |

season2627 中位数 62.5 → 32.7 秒（约 −48%）；classic 中位数 114.8 → 111.6 秒，在波动范围内，判断本身没有造成可见的额外开销。

## 第五轮：在独立标签页中导出并释放内存（2026-10-21）

### 原理

`scripts/probe-export-tab.mjs`：编辑器以 `noopener` 打开的同源标签页使用独立渲染进程；BroadcastChannel 可在两者间传递消息与 Blob；标签页可自行关闭，关闭后其中累积的 foreignObject SVG 内存（复现中 2.4 GB）在 1 秒内全部释放。沙箱 iframe 虽同样独立，但不透明源会污染位图（见第三轮），标签页没有这个限制。

### 实现

- 点击“导出视频”时在同一次点击中打开 `?export-video=<id>`（`src/lib/export-tab.ts`）。整个浏览器导出（渲染 iframe、编码、写 OPFS）在该标签页中运行，编辑器只显示进度，导出期间不再被占用主线程。
- 任务、进度、取消经 BroadcastChannel 传递；背景视频以 Blob 传入，不复制字节。
- 成品交接：标签页写完 OPFS 文件后保持文件锁并报告文件名；编辑器先排队请求该锁，再通知标签页放手，从而在任何时刻都有页面持锁，文件不会被当作孤儿回收。标签页随即关闭，编辑器取得锁后生成下载地址，`releaseDownload` 时删除文件。无 OPFS 时直接传 Blob。
- 标签页在发送“就绪”之前取得一把生命周期锁，直到关闭；编辑器在就绪后排队请求它，取得即说明标签页已关闭或崩溃（“完成”之后的关闭除外），不依赖计时器。
- 10 秒内没有就绪（例如弹窗被拦截）时，编辑器回到原来的页内导出。标签页 60 秒内未收到任务会自行关闭。
- 标签页里的取消按钮按取消处理，编辑器不显示错误。
- 导出循环让出主线程改用 MessageChannel，不受后台标签页计时器节流影响（节流在隐藏五分钟后可降到每分钟一次）。剩余计时器只在启动等待和超时中使用。
- 浏览器缺少 BroadcastChannel 或 Web Locks 时仍在页内导出。

### 测量

真实项目 1080p／60 fps，同一时段交替运行第四轮构建（全部在编辑器页内）与本轮构建，每次调用在同一浏览器中连续导出 3 次，共两轮。内存为整个浏览器的私有字节，导出结束 5 秒后再取一个样本：

| 模板 | 构建 | 导出用时（6 次） | 导出结束 5 秒后总内存 | 第 2、3 次开始时总内存 |
| --- | --- | --- | --- | --- |
| classic | 页内 | 51.0／48.4／49.2／52.7／52.1／49.4 秒 | 4.1～6.4 GB，逐次增加 | 4.5～6.1 GB |
| classic | 标签页 | 51.7／52.0／50.5／51.7／49.9／48.9 秒 | 0.93～1.04 GB | 1.0～1.2 GB |
| season2627 | 页内 | 15.2／14.5／14.2／14.4／13.7／13.9 秒 | 2.5～3.8 GB | 2.8～3.5 GB |
| season2627 | 标签页 | 14.6／14.4／14.9／14.0／14.4／14.3 秒 | 1.06～1.20 GB | 1.3～1.3 GB |

导出用时基本相同（标签页启动约增加 1 秒以内）。导出后内存回到空闲水平，连续导出不再累积；单次导出期间的渲染进程峰值不变（classic 约 4.3～4.6 GB），仍随帧数增长。本轮机器又比第四轮快（classic 约 50 秒，第四轮约 110 秒），与之前的表格不可直接比较。

### 验证

`npm run test:export-tab`：标签页使用独立渲染进程、背景视频 Blob、MP4 交接后标签页自行关闭、下载释放后删除 OPFS 文件、从编辑器取消后关闭且不留文件、导出中关闭标签页时编辑器报错、弹窗被拦截时报告回退。`test:static-export`（`TEST_DIST` 可指定构建目录）经界面在新标签页中导出并下载 MP4，零导出 API 请求。另通过 `test:export-storage`、`test:browser-export`、`test:browser-video-frames`、`test:export-reuse`。

### 尚未覆盖

Playwright 的无头和有头模式都无法让标签页进入隐藏状态（`scripts/probe-export-tab-hidden.mjs` 中 `visibilityState` 始终为 visible），后台节流只按代码检查：热循环没有计时器，Mediabunny 使用自身的不受节流计时器。长时间隐藏的标签页可能被 Chrome 的节省内存功能丢弃，此时编辑器会收到失败。进程隔离取决于浏览器：Chrome 在进程数量受限（如低内存设备、Android）时可能复用同站点进程，此时与页内导出效果相同。Firefox、Safari 未测。
