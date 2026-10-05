# Desktop Remote — Android Agent

A React Native Android app that acts as a **DRS device/agent**: once enrolled it
connects to the signalling gateway, shares its screen over WebRTC to an operator
in the Command Center, and accepts remote input (taps, swipes, typing,
navigation) injected through an `AccessibilityService`. It speaks the same
signalling protocol as `Desktop-Remote-Solution/tools/fakeagent`.

## What it does

- **Enroll** with an enrollment token (`POST /v1/agent/enroll`), generating an
  Ed25519 identity whose private key stays in the Android keystore.
- **Authenticate** to the gateway every 15 min via the challenge/sign/token flow
  (`GET`/`POST /v1/agent/token`), refreshing the device JWT in-band.
- **Signalling** over WebSocket (`drs.signal.v1`, protobuf frames): Register,
  Heartbeat, ParticipantJoin, ConsentRequest, SessionOffer/Answer, ICE,
  PermissionGrant, SessionEnded, Command, Message.
- **Screen share** via `getDisplayMedia()` (Android MediaProjection + a
  foreground service), one capture shared across all viewers.
- **Remote control** via `DrsAccessibilityService` — gated on the participant's
  `control_input` capability bit and the session control mode.

## Project layout (`src/`)

| Path | Role |
|------|------|
| `proto/signal.proto.ts`, `proto/signal.ts` | Embedded protocol + runtime protobuf codec |
| `core/crypto.ts` | Ed25519 keygen + nonce signing (tweetnacl) |
| `core/api.ts`, `core/token.ts`, `core/enroll.ts` | REST client, JWT provider, enrollment |
| `core/storage.ts` | Config (AsyncStorage) + identity (Keychain) |
| `signal/client.ts` | Gateway WebSocket client (port of fakeagent) |
| `webrtc/screenShare.ts` | Shared MediaProjection capture |
| `webrtc/peer.ts` | One peer connection per participant (answerer) |
| `webrtc/inputHandler.ts` | Control-channel events → native input |
| `native/remoteControl.ts` | JS bridge to the AccessibilityService (Android) |
| `webrtc/iosPicker.tsx` | iOS ReplayKit broadcast picker host |
| `core/permissions.ts` | Startup permission requests + readiness |
| `agent/controller.ts` | Orchestrator wiring signal + webrtc + input + commands |
| `screens/*` | Enroll, Status, Settings UI |
| `android/.../remote/*.kt` | AccessibilityService + native module |
| `ios/ScreenShare/*` | Broadcast Upload Extension (SampleHandler + uploader + socket) |

## Platform support

| | Android | iOS |
|---|---------|-----|
| Screen view on desktop | ✅ MediaProjection | ✅ ReplayKit broadcast extension |
| Remote control (input) | ✅ AccessibilityService | ❌ not allowed by iOS |

iOS screen capture needs the `ScreenShare` extension + an App Group
(`group.com.drs.app`) + a signing team — see `HOW-TO-VIEW-AND-CONTROL.md` §5.
Re-run `ios/scripts/add_screenshare_extension.rb` if the extension target is
missing after a clean checkout.

## The operator must offer, the agent answers

The agent is always the WebRTC **answerer** (same as `fakeagent`). For screen +
control to work, the operator/portal's SDP **offer** must contain:

1. a **recvonly video** m-line (the agent attaches its screen track to it), and
2. a data channel labelled **`control`** (or `input`) for remote input.

### Control-channel input protocol (operator → agent)

Newline-free JSON, **normalized** coordinates in `[0,1]` (the agent scales to the
real display):

```jsonc
{"t":"tap","x":0.5,"y":0.5}
{"t":"long","x":0.5,"y":0.5,"ms":600}
{"t":"swipe","x1":0.5,"y1":0.8,"x2":0.5,"y2":0.2,"ms":250}
{"t":"key","k":"back|home|recents|notifications|quick_settings|lock_screen|power_dialog"}
{"t":"text","text":"hello"}
```

Input is applied only when the participant holds the `control_input` bit and the
session control mode allows input (`full`, `parallel`, `backstage`).

## Running

1. Start the backend (`Desktop-Remote-Solution/deploy/docker-compose.yml`) so the
   API (`:8080`) and gateway (`:8081`) are reachable.
2. Create a device group + enrollment token in the portal
   (`POST /v1/device-groups`, `POST /v1/enrollment-tokens`).
3. `npm start` then `npm run android` (emulator reaches the host at `10.0.2.2`).
4. In the app: set the **API base URL**, paste the **enrollment token**, Enroll.
5. Grant the **accessibility** service (Status screen → Open accessibility
   settings) so remote control works. Screen capture prompts on the first viewer.

## Permissions / native setup

- `AndroidManifest.xml` declares `FOREGROUND_SERVICE[_MEDIA_PROJECTION]`,
  `POST_NOTIFICATIONS`, `WAKE_LOCK`, and the `DrsAccessibilityService`.
- `react-native-webrtc` supplies the `MediaProjectionService` (foreground, type
  `mediaProjection`) via manifest merge.
- `RemoteControlPackage` is registered in `MainApplication.kt`.

## Not yet implemented

- End-to-end session encryption / key epochs (agent currently relies on DTLS-SRTP
  + the gateway's trust rules; the E2E sealed-key handshake from
  architecture §1.5 is a follow-up).
- Credential injection (`CredentialDelivery`) is acked as unsupported.
- Most device commands beyond `LOCK`, `MDM_LOCK`, `REFRESH_INFO` return failed.
- Clipboard / file transfer channels.
