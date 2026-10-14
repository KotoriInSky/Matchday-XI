# FIFA member-association flags

The editor includes the 211 associations in the [FIFA member directory](https://inside.fifa.com/associations), checked on 2026-10-13. This is a football membership catalog, rather than a political territory classification. IOC identifiers are search aliases within this catalog.

In **Tags**, search by Chinese name, English name or a FIFA / IOC code and select a flag to add it to the project. Results appear only while the search contains text; clearing it collapses the list. In a player's tag picker, switch to **FIFA member associations** to add and assign it in one action. Existing uploaded tags remain available. Repeated selection reuses the existing library tag, including its shared crop and edited name. Replacing its image turns it into a custom tag.

Examples: `Latvia`, `拉脱维亚`, `LVA` (FIFA) and `LAT` (IOC) find Latvia; `Indonesia`, `IDN` and `INA` find Indonesia. Search also accepts English full names such as `United States of America` and `Republic of Korea`. `GBR` finds the four British home associations. Former IOC codes `LIB` and `SIN` remain search aliases for Lebanon and Singapore. Associations without a corresponding IOC-recognized NOC are still available by name and FIFA code.

`china` is a shared search alias for China PR, Hong Kong, China, Macau, China and Chinese Taipei. Individual FIFA codes still resolve their own association.

Names are localized for the six built-in interface languages. The catalog preserves the FIFA English name and code. Association-specific names include Chinese Taipei, Hong Kong, China, and Macau, China; the four British home associations have separate flags. New Caledonia uses two flags together and Peru uses its coat-of-arms variant to follow the FIFA directory. Independent SVG artwork can have different proportions, colours and emblem details from FIFA's bitmaps.

Flags are served with the app and selected SVGs are embedded in the project, including their source notices. Backups and exports therefore do not depend on an external flag service. Search terms remain in the browser. The library is a dated snapshot, not an automatically updated membership feed.

The demo's default tags also use these library SVGs, embedded with their notices. Run `node scripts/build-default-flags.mjs` after updating the corresponding library assets to refresh the portable defaults. Existing saved projects retain their own tags.

210 SVG assets are based on MIT-licensed [flag-icons](https://github.com/lipis/flag-icons). The Chinese Taipei representative flag is sourced from Wikimedia Commons, which identifies it as public domain; trademark and insignia restrictions remain separate. See the distributed [source and copyright notice](../public/flags/FIFA-FLAGS-SOURCES.txt), [MIT notice](../public/flags/FLAG-ICONS-LICENSE.txt) and [per-file manifest](../public/flags/manifest.json). Matchday XI is independent of FIFA, IOC and the associations.

## 中文说明

在「标签」中按中文名、英语全名或 FIFA／IOC 代码搜索，输入内容后展开结果，清空后收起。点击旗帜加入项目。球员的标签选择器也可以切换到「FIFA 会员协会」，直接添加并选用。重复选择会复用已加入的旗帜；替换图片后成为自定义标签。

例如 `LVA` 和 `LAT` 都能找到拉脱维亚，`IDN` 和 `INA` 都能找到印度尼西亚。`GBR` 会找到四个英国足协会籍。IOC 代码仅供搜索，范围始终是 FIFA 的 211 个会员协会。

`china` 同时匹配中国、中国香港、中国澳门和中华台北；单独输入 FIFA 代码仍定位对应的协会。

名单按 2026-10-13 的 FIFA 官方目录核对，采用体育协会会籍及代表队命名，不作为政治实体或主权分类。旗帜版本按目录核对，独立 SVG 素材的比例、颜色和图案细节可能不同。搜索在浏览器内进行，选中的旗帜随项目保存和备份，无需连接 FIFA 或其他外部服务。

项目代码保持 MIT；第三方旗帜保留各自许可和版权声明，详见上方素材来源、许可证与校验清单。
