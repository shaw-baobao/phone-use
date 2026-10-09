# Phone Use

An open-source Codex MCP App for viewing and directly controlling a connected phone, powered by [MobileCLI](https://github.com/mobile-next/mobilecli).

**Experimental v0.1.0.** The first target is a real iPhone connected to macOS. Android uses MobileCLI's same interface, but has not been verified on hardware for this project.

## What it does

- Live MJPEG screen preview inside a Codex panel, with no simulated notch or phone bezel.
- Click to tap, drag to swipe, hold to long press. Home and explicit text input controls.
- Explicit **You / AI** control ownership, with one shared command queue. Switching ownership cancels queued actions.
- **Pause preview** stops screen capture; **Disconnect** releases this panel's connection; **Stop automation** also terminates the selected iOS DeviceKit runner. Pausing or disconnecting alone can leave iOS's “Automation Running” indicator visible.
- MCP tools for device discovery, UI-tree observation, optional fresh screen images, and AI actions. Manual controls call app-only tools directly, without a model round trip.

Frames are requested at up to 10 fps, scaled to 50%. The app polls the latest frame about every 120 ms. This is interactive screen mirroring, not a guaranteed-latency video transport. Hidden or closed panels stop leasing capture; the server stops its stream within roughly 6 seconds. It does not automatically terminate a device agent when the panel closes.

## Requirements

- Node.js 22 or newer; `node`, `mobilecli`, and `codex` available in PATH.
- Codex desktop with MCP Apps support.
- MobileCLI (initial integration tested with 1.0.18).
- Real iPhone: trusted USB pairing, Developer Mode, Xcode/signing prerequisites, and MobileCLI's DeviceKit agent installed. Follow MobileCLI's documentation for setup and dependency licenses. Phone Use does not bundle or relicense MobileCLI or DeviceKit.

```sh
npm install -g mobilecli@latest
mobilecli devices --platform ios
mobilecli agent install --device YOUR_DEVICE_ID --provisioning-profile /absolute/path/to/profile.mobileprovision
mobilecli agent status --device YOUR_DEVICE_ID
```

Use a profile that authorizes the DeviceKit bundle ID and your selected device. Never commit provisioning profiles or signing keys.

## Install in Codex

```sh
git clone https://github.com/shaw-baobao/phone-use.git
cd phone-use
npm ci
npm run build
npm test
npm run install:codex
```

The installer stages only the bundled server, panel, plugin metadata, README, and license into Codex's plugin cache. It registers the `phone-use-local` marketplace, installs `phone-use`, and registers the `phone_use` MCP server using the current Node executable. It does not alter other MCP servers or phone apps.

Reconnect your Codex chat (or restart Codex), then ask **“打开 Phone Use 实时屏幕”**. Choose the exact device, click **Connect**, and keep the phone unlocked. Manual control is enabled first. Select **AI** to allow the assistant to use `phone_action`; select **You** to take control back.

After pulling updates, run `npm ci`, `npm run build`, and `npm run install:codex` again, then reconnect Codex. To uninstall:

```sh
codex mcp remove phone_use
codex plugin remove phone-use@phone-use-local
```

## Local browser preview

```sh
npm run preview
```

Open the localhost URL printed by the process, including its random token fragment. The HTTP listener binds only to `127.0.0.1`; input requests require that token and matching host/origin. Treat the URL as a local control credential. Do not share it. The preview is intended for local development, not remote hosting.

## Architecture

```text
Codex panel / localhost preview
  │ normalized pointer coordinates, session, displayed-frame sequence
  ▼
MCP App tools ───── AI observation/action tools
  │                    │
  └── control owner + shared action queue ──┐
                                          ▼
                                 MobileCLI subprocesses
                                          ▼
                               DeviceKit / Android backend
```

The server uses argument arrays with `shell: false`. It decodes bounded MJPEG frames, corrects orientation, rejects expired frame sessions, and maps pointer coordinates over the actual image (excluding letterboxing). Rotation invalidates a gesture session. Commands are sent once; errors never trigger an automatic action retry. A successful tool response means the command completed, not that the intended phone state was verified. Read a fresh UI tree or screen afterward.

Manual control tools have MCP App-only visibility. AI control requires the user to grant ownership in the panel. Ownership is scoped to one server process; other MobileCLI tools or a second Phone Use server can still control the same phone independently. Use one active controller per device. The capture stream is separate from the serialized action queue so the screen can update during actions.

## Tool surface

| Tool | Purpose |
| --- | --- |
| `phone_open` | Open the panel; optionally connect an exact device ID |
| `phone_devices` | Discover devices |
| `phone_observe` | Read the current UI tree and include a fresh cached image when available |
| `phone_action` | AI tap, swipe, long press, text, Home, app launch (AI ownership required) |
| `phone_stop` | Disconnect; optionally stop the selected iOS runner |
| App-only tools | Connect, frame polling, ownership, pause, manual input |

Normalized coordinates run from 0 to 1 across the displayed phone image. Authentication is a user handoff: pause capture while the user enters credentials. Screens and typed text stay on the local MCP/host path; this project has no analytics or external upload endpoint. Your Codex/model provider may receive observations you explicitly request through tools.

## Development

```sh
npm run build
npm test
npm run preview
```

The repository includes self-contained generated `assets/panel.html` and `dist/server.mjs` so the installed plugin needs no `node_modules`. CI checks the build, regression tests, and generated-file consistency. Tests cover MJPEG parsing, coordinate mapping, frame expiry, rotation, ownership cancellation, literal text arguments, action failures, and the bundled MCP protocol/resource.

## Limitations

Device lock, trust, signing, or agent failure requires user intervention. This release has no audio, multi-touch, pinch gesture, hardware keyboard passthrough, remote access, or device-agent installation wizard. AI observation uses MobileCLI's UI tree plus a cached fresh frame; a paused preview blocks observation. “Stop automation” currently terminates iOS's selected runner and reports whether a runner was actually stopped; it does not uninstall the agent or stop MobileCLI's shared daemon.

MIT license for Phone Use. Third-party packages retain their own licenses; see [bundled notices](assets/THIRD_PARTY_NOTICES.txt). The design uses the MCP Apps SDK and MobileCLI; it is an independent project and does not fork iPhone-use code.
