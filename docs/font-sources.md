# 内置字体 / Bundled fonts

内置字体为 Google Fonts 提供的未修改 WOFF2 文件，随网站同源托管。页面和本地渲染器不连接 Google Fonts。首次加载某款字体时请求其样式表，浏览器只下载当前文字需要的 Unicode 字符子集；上传字体的功能保持不变。

Built-in fonts are unmodified WOFF2 files sourced from Google Fonts and served by the website itself. Font families and Unicode subsets load as needed. No runtime Google Fonts connection is required.

## 许可与来源

2026-10-13 核对了全部内置字体的上游许可，均为 SIL Open Font License 1.1。每款字体的原始版权及许可声明保存在 `public/fonts/<family>/OFL.txt`，并随网站部署。字体不适用项目代码的 MIT 许可证。

| 字体用途 | 字体 |
| --- | --- |
| 体育标题 | Graduate、Black Ops One、Bungee、Russo One、Staatliches、Orbitron |
| 拉丁文字与数字 | Outfit、Poppins、Montserrat、Saira Condensed、Anton、Bebas Neue、Oswald、Teko、Big Shoulders Display、Chakra Petch、Rajdhani、Fjalla One、Archivo Black、Kanit、Barlow Semi Condensed、Barlow、Roboto Condensed、IBM Plex Sans Condensed、Manrope |
| 中文、日文与韩文 | Noto Sans SC、Noto Serif SC、Noto Sans TC、Noto Serif TC、Noto Sans JP、Noto Sans KR |
| 品牌标题 | Newsreader |

[资源清单](../public/fonts/manifest.json)记录了每款字体的上游 CSS、许可地址，以及每个 WOFF2 文件的来源、SHA-256 和大小。许可文件保留了各字体作者的版权声明与保留名称。

## 更新字体资源

正常安装、构建和部署直接使用仓库中的字体文件，不需要请求 Google。只有维护者更新字体时，才需要 Python 3 和对 Google Fonts、GitHub 原始文件的网络访问：

```sh
python scripts/vendor-fonts.py
```

脚本读取 `src/engine/constants.ts` 中的字体与字重，并补充界面使用的 Newsreader 600、Noto Serif SC 600 和 Saira Condensed 600。脚本验证 OFL-1.1 许可和 WOFF2 文件头，保留字符子集，生成本站相对路径 CSS、许可文件与来源清单。更新后应检查字体显示与浏览器导出，并提交生成的资源。

上传的字体仍须遵循自己的许可，尤其是嵌入和再分发条件。Demon Letter 未收录，因为尚未核实具体字体与许可。
