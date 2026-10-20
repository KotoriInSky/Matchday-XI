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
