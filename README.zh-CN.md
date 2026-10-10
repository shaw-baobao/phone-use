# Phone Use

[英文](README.md) | [简体中文](README.zh-CN.md)

一个基于 [MobileCLI](https://github.com/mobile-next/mobilecli) 的开源 Codex MCP 应用，用于查看并直接操作已连接的手机。

**实验性项目。** 在 macOS 上，真实 iPhone 和已启动的 iOS 模拟器使用同一个面板和控制方式。Android 也通过 MobileCLI 的统一接口接入，但本项目尚未在 Android 真机上验证。

## 功能

- 在 Codex 面板内实时显示 MJPEG 手机画面，不额外绘制刘海或手机边框。
- 点击模拟轻点，拖动模拟滑动，按住模拟长按。底部提供 **返回桌面 / 截图 / 最近任务** 三个按钮，侧栏支持向当前输入框发送文字。
- iOS 真机的返回桌面按钮通过 MobileCLI 执行从屏幕底边快速、较长距离的上滑，并检查 SpringBoard 是否在前台；模拟器使用原生主屏幕按键，Android 使用主屏幕硬件键。画面流中断时，返回桌面和最近任务仍可使用；坐标操作仍要求有新鲜的已显示画面。手机已经在桌面时，再次点击返回桌面可能没有明显变化。截图通过 MobileCLI 获取新的全分辨率 PNG，并请求宿主下载；本地预览则通过浏览器下载。
- 最近任务在 Android 上使用 `APP_SWITCH` 按键，在 iOS 上使用从屏幕底边短距离、慢速上滑的手势；需在目标设备上确认实际效果。
- 通过 **手动控制 / 助手控制** 明确切换控制权，操作共用一个串行队列。切换控制权会取消尚未执行的排队操作。
- **暂停预览** 暂停画面采集；**断开连接** 断开当前面板连接；**停止自动化** 还会终止所选 iOS 设备的 DeviceKit 执行程序。暂停后，手机输入和截图也会被阻止。仅暂停或断开连接，可能仍会看到 iOS 的“自动化正在运行”提示。
- 提供设备发现、界面结构树读取、可选的新鲜画面和助手操作等 MCP 工具。手动控制直接调用仅供 MCP 应用使用的工具，无需经过模型。

画面采集请求最高为每秒 10 帧，缩放为原始尺寸的 50%；面板约每 120 毫秒轮询最新画面。这是可交互的屏幕镜像，不保证视频传输延迟。面板隐藏或关闭后会停止续期采集，服务端约在 6 秒内停止画面流；关闭面板不会自动终止设备代理程序。

## 环境要求

- Node.js 22 或更新版本；`node`、`mobilecli` 和 `codex` 必须在可执行文件搜索路径中。
- 支持 MCP 应用的 Codex 桌面版。
- MobileCLI（首次集成使用 1.0.18 验证）。
- 真实 iPhone：已信任的 USB 配对、开发者模式、Xcode 与签名环境，以及已安装的 MobileCLI DeviceKit 代理程序。设置方法及依赖许可请参阅 MobileCLI 文档。Phone Use 不打包 MobileCLI 或 DeviceKit，也不改变它们的许可。

```sh
npm install -g mobilecli@latest
mobilecli devices --platform ios
mobilecli agent install --device YOUR_DEVICE_ID --provisioning-profile /absolute/path/to/profile.mobileprovision
mobilecli agent status --device YOUR_DEVICE_ID
```

所用描述文件必须授权 DeviceKit 的应用标识符和目标设备。不要提交描述文件或签名密钥。

## iOS 模拟器

通过 Xcode 的 Simulator 应用或 `xcrun simctl boot SIMULATOR_UDID` 启动可用的模拟器，然后执行：

```sh
mobilecli devices --platform ios
mobilecli agent install --device SIMULATOR_UDID
```

在 Phone Use 中选择类型为 **iOS 模拟器** 的设备并连接。模拟器需要 DeviceKit 的模拟器代理程序，无需描述文件或 USB 配对。目前设备发现只显示已启动的模拟器，Phone Use 不会替你启动已关机的模拟器。停止自动化会终止模拟器执行程序，但模拟器本身仍保持启动。

## 安装发布包

从 [GitHub 发布页面](https://github.com/shaw-baobao/phone-use/releases) 下载 `phone-use-VERSION.zip` 或 `.tar.gz`。使用附带的 `SHA256SUMS` 校验文件，解压后执行：

```sh
cd phone-use-VERSION
node scripts/install.mjs
```

发布包已包含打包后的服务端和面板，不需要执行 `npm ci` 或构建。仍需安装 Node.js 22+、MobileCLI、Codex，并满足平台要求；这些工具和 DeviceKit 代理程序不包含在压缩包中。本地浏览器预览可使用 `node dist/server.mjs --preview`。

## 安装到 Codex

```sh
git clone https://github.com/shaw-baobao/phone-use.git
cd phone-use
npm ci
npm run build
npm test
npm run install:codex
```

安装器只将打包后的服务端、面板、插件元数据、说明文档和许可证放入 Codex 插件缓存。它会注册 `phone-use-local` 插件市场、安装 `phone-use` 插件，并使用当前 Node.js 可执行文件注册 `phone_use` MCP 服务，不修改其他 MCP 服务或手机应用。

重新连接 Codex 对话（或重启 Codex），然后输入 **“打开 Phone Use 实时屏幕”**。选择准确的设备，点击 **连接**，并保持手机解锁。默认由你手动控制；选择 **助手控制** 后，助手才可以使用 `phone_action`；选择 **手动控制** 可收回控制权。

拉取更新后，再次执行 `npm ci`、`npm run build` 和 `npm run install:codex`，然后重新连接 Codex。卸载命令：

```sh
codex mcp remove phone_use
codex plugin remove phone-use@phone-use-local
```

## 连接失败后的恢复

MobileCLI 报告 WebDriverAgent 或 DeviceKit 未就绪时，面板显示 **Connection failed** 并保留原始错误。能发现设备、代理已安装、手机已解锁，都不能证明代理服务已连通。连接等待中或失败后仍可点击 **停止自动化**：取消当前 CLI 等待，并尝试停止已确认选中的 iOS 执行程序，然后手动点击 **连接** 重试。取消 CLI 请求不保证 MobileCLI 共享守护进程已取消内部任务；插件不会重启共享守护进程，也不会自动重试手机输入。

回归验证：`node --test tests/core.test.mjs tests/connection-ui.test.mjs tests/cli.test.mjs`。这些测试覆盖失败状态、取消连接和面板恢复按钮；实时画面是否可用仍需在目标手机上验证。

## 本地浏览器预览

```sh
npm run preview
```

打开进程输出的本地网址，包括其中随机生成的令牌片段。HTTP 服务只监听 `127.0.0.1`；输入请求必须携带令牌，并通过主机名及请求来源校验。这个网址是本地控制凭证，请勿分享。本地预览用于开发，不适合远程托管。

## 架构

```text
Codex 面板 / 本地预览
  │ 归一化坐标、会话、已显示画面的序号
  ▼
MCP 应用工具 ───── 助手观察 / 操作工具
  │                    │
  └── 控制权 + 共享操作队列 ──────────┐
                                     ▼
                              MobileCLI 子进程
                                     ▼
                           DeviceKit / Android 后端
```

服务端通过参数数组启动命令，使用 `shell: false`。它对 MJPEG 帧大小设限、修正方向、拒绝过期画面会话，并根据实际图像区域映射坐标，排除留白区域。旋转会使原手势会话失效。操作命令只发送一次，出错时不会自动重试操作。工具返回成功表示命令执行完成，不等于预期的手机状态已得到验证；操作后应读取新的界面结构树或画面确认。

手动控制工具只对 MCP 应用可见。助手操作需要用户在面板中授予控制权。控制权只在单个服务端进程内有效；其他 MobileCLI 工具或另一个 Phone Use 服务仍可独立操作同一手机。每台设备应只使用一个活动控制器。画面流与串行操作队列分开，操作期间画面仍可更新。

## 工具

| 工具 | 用途 |
| --- | --- |
| `phone_open` | 打开面板；可指定准确的设备标识符并连接 |
| `phone_devices` | 发现设备 |
| `phone_observe` | 读取当前界面结构树，并在可用时附带新鲜的缓存画面 |
| `phone_action` | 助手轻点、滑动、长按、文字输入、返回桌面、启动应用（需助手控制权） |
| `phone_stop` | 断开连接；可选终止所选 iOS 执行程序 |
| 仅供 App 使用的工具 | 连接、画面轮询、控制权、暂停、手动输入 |

归一化坐标的范围为 0 到 1，对应显示的手机图像。身份认证应交给用户处理：用户输入凭证时暂停画面采集。画面和输入文字经过本地 MCP / 宿主通道；本项目没有分析统计或外部上传接口。你通过工具主动请求的观察内容可能会被发送给 Codex / 模型服务提供方。

## 开发

```sh
npm run build
npm test
npm run preview
```

仓库包含可独立使用的生成文件 `assets/panel.html` 和 `dist/server.mjs`，因此安装后的插件不需要 `node_modules`。CI 检查构建、回归测试及生成文件的一致性。测试涵盖 MJPEG 解析、坐标映射、画面过期、旋转、控制权切换时取消排队操作、文字参数原样传递、操作失败及打包后的 MCP 协议和资源。

## 限制

设备锁屏、信任、签名或代理程序故障需要用户介入。当前版本不支持音频、多点触控、捏合手势、硬件键盘透传、远程访问或设备代理程序安装向导。助手观察使用 MobileCLI 界面结构树及新鲜的缓存画面；暂停预览也会阻止观察。“停止自动化”目前会终止所选 iOS 执行程序，并报告是否实际停止了执行程序；不会卸载代理程序或停止 MobileCLI 的共享后台进程。

Phone Use 使用 MIT 许可证。第三方依赖保留各自的许可证，详见[随包许可声明](assets/THIRD_PARTY_NOTICES.txt)。本项目使用 MCP 应用开发工具包和 MobileCLI，是独立项目，没有从 iPhone-use 派生代码。

## 版本发布

`package.json` 是运行时版本的来源。保持 `.codex-plugin/plugin.json` 及 `package-lock.json` 根条目的版本一致。构建会校验插件与包的版本是否相同；面板、MCP 服务和资源标识符均使用该版本。

```sh
# 更新版本号和发布说明后执行：
npm ci
npm run build
npm test
npm run package
git add .
git commit -m "Release vX.Y.Z"
git tag -a vX.Y.Z -m "Phone Use vX.Y.Z"
git push origin main vX.Y.Z
```

[发布工作流](.github/workflows/release.yml) 在推送 `v*` 标签时运行，也可在 GitHub 上手动运行该工作流并指定已有标签。它会校验标签与源码版本、构建并测试、核对生成文件、生成 ZIP / tar.gz 和 SHA-256 校验文件，随后上传并发布 GitHub 版本。压缩包只包含明确列入清单的运行时 / 插件文件，不包含开发依赖、设备截图、签名描述文件或本地状态。

只有发布任务拥有 `contents: write` 权限。预发布标签（如 `v0.2.0-beta.1`）会标记为预发布版本。失败的草稿上传可以重试，已经发布的版本不会被静默覆盖。这些压缩包是跨平台的 JavaScript 包，不是独立的原生可执行程序。

iOS 真机系统手势已在使用手势导航的 iPhone 上验证；带实体主屏幕按钮的旧款 iPhone 尚未验证。
