# 素材来源与许可证（Assets & Credits）

## 🎀 桌宠形象（VRM 3D 模型）

| 项目 | 内容 |
|---|---|
| 模型名称 | **Victoria Rubin（ヴィクトリア・ルービン）**，即 VRoid Studio 旧 β 版示例模型 **β Ver AvatarSample_4**（原始文件名 `AvatarSample_G.vrm`，VRM 内嵌标题 `ヴィクトリア・ルービン`） |
| 作者 | **VRoid Project（pixiv Inc.）** |
| 许可证 | **CC0 1.0 通用（公有领域贡献）** —— VRoid 官方说明："The CC license for this model is CC0. This model can be edited and used freely. Copyright is waived…"（可自由修改、商用、再分发，无需署名） |
| 官方许可说明 | <https://vroid.pixiv.help/hc/en-us/articles/360014900233-%CE%B2-Ver-AvatarSample-4> |
| VRoid 示例模型总说明 | <https://vroid.pixiv.help/hc/en-us/articles/4402614652569> |
| 取得来源 | OpenGameArt「VRoid Studio CC0 models」（提交者 hecko，页面标注 CC0，说明其中 AvatarSample D–G 来自 VRoid 官方 CC0 发布）：<https://opengameart.org/content/vroid-studio-cc0-models>，文件 `avatarsample_g.zip` |
| VRM 内嵌授权元数据 | 使用者：Everyone；商用：Allow；暴力/性表现：Allow；再分发与改动：允许；署名：unnecessary |
| 本项目中的文件 | `src/models/Victoria_Rubin.vrm` |

**本项目对模型做的修改**：仅把内嵌贴图按比例缩小到最长边 ≤ 1024 px（缩略图 256 px）以减小仓库体积（约 15.3 MB → 8.3 MB），网格、骨骼、材质、表情与授权元数据均未改动。缩小脚本：`tools/shrink-vrm.py`。

> 为什么选它：VRoid 的 CC0 示例模型授权条款明确、允许再分发；粉金配色与本项目的粉色主题契合。
> 备选方案：右键桌宠 →「🖼 更换 VRM 形象…」可使用你自己有权使用的任何 `.vrm`（请自行确认其授权）。

### 其他核对过的候选（未打包）
- `Seed-san`（VirtualCast）与 `VRM1_Constraint_Twist_Sample`（pixiv）：VRM Public License 1.0，允许再分发，但需遵守署名等条款，未采用。
- VRoid 新版 `AvatarSample A–Z`：**非 CC0**，禁止把 VRM 的再分发许可设为 CC0、禁止无正当理由的付费再分发，未采用。

## 🐱 兜底形象（SVG 猫娘）与 README 封面
`src/pet.html` 内的手绘 SVG 猫娘、`docs/banner.svg` 为本项目原创，随项目以 MIT 许可发布。仅当 VRM 加载失败（如 WebGL 不可用）时显示猫娘。

## 🔤 封面字体
`docs/banner.svg` 的标题文字使用 **Noto Sans CJK SC**（Google / Adobe，SIL Open Font License 1.1）转成矢量路径生成，不依赖运行时字体。字体：<https://github.com/notofonts/noto-cjk>

## 📦 第三方代码
见 [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)（three.js、@pixiv/three-vrm，均为 MIT；Electron 为 MIT）。
