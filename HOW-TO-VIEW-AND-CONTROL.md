# Desktop se Android aur iOS screens view & control karna

Yeh document batata hai ke aap (operator) apne **desktop** se enrolled phones ki
screen kaise **live dekh** sakte hain aur (Android par) **control** kar sakte
hain. Mobile app (`drs/`) phone par **agent/device** hai; desktop **operator**
hai; backend (`Desktop-Remote-Solution/`) sirf signalling relay karta hai —
screen ka video aur control input **end-to-end P2P (WebRTC)** jaata hai, backend
ke through nahi.

---

## 1. Bade level par kaise chalta hai

```
  ┌─────────────┐   REST + WebSocket (signalling only)   ┌──────────────┐
  │   Desktop    │◄──────────────────────────────────────►│   Backend     │
  │  (operator)  │        /v1/...   +   gateway /ws        │ API + Gateway │
  └──────┬───────┘                                         └──────┬───────┘
         │                                                        │
         │            WebRTC (screen video + control)             │
         │            END-TO-END, P2P ya TURN relay               │
         │                                                        │
         ▼                                                        ▼
   screen dikhti hai                                     ┌─────────────────┐
   input bheja jaata hai  ◄───────────────────────────► │  Phone (agent)   │
                                                         │ Android / iOS    │
                                                         └─────────────────┘
```

- **Android**: screen **view + full control** (tap/swipe/type/back/home) —
  AccessibilityService input inject karti hai.
- **iOS**: screen **view only**. Apple third-party apps ko iOS remotely control
  karne **nahi** deta (koi AccessibilityService-equivalent nahi). Yeh Apple ki
  security policy hai, code ki kami nahi.

---

## 2. Phone par ek dafa ka setup (owner karta hai)

1. App kholo → **API base URL** daalo → portal se bana **enrollment token** paste
   karke **Enroll** karo.
2. App khulte hi jo permissions maangi jaayein woh **Allow** karo.
3. **Android**: Status screen → **Enable remote control** → accessibility list me
   "Desktop Remote Control" ON karo. (Yeh OS har device par ek dafa manually ON
   karwata hai — automatic grant possible nahi.)
4. Jab operator pehli dafa connect karega, phone **screen capture** ki permission
   maangega (Android: MediaProjection dialog; iOS: broadcast picker → **Start
   Broadcast**). Owner **Allow/Start** kare.

> Note: Screen capture aur accessibility ko OS jaan-boojh kar har baar explicit
> consent se baandhta hai. "Sab permission automatic open" sirf enterprise MDM /
> device-owner provisioning se hoti hai — normal app me nahi.

---

## 3. Desktop se connect karna (operator flow)

Yeh exact REST + signalling sequence hai. Reference client:
`Desktop-Remote-Solution/tools/testpage/` (login + gateway + data channel) —
usme sirf **video receive** add karna hai (neeche step 4).

### 3.1 Login
```
POST /v1/auth/login { tenant_slug, email, password }   → access_token
```

### 3.2 Device dhoondo (online hai?)
```
GET /v1/devices        (Authorization: Bearer <access_token>)
→ device list with online:true/false
```

### 3.3 Session start karo (unattended access)
```
POST /v1/devices/{id}/connect
     { "control_mode": "full", "client": { "type": "portal" } }
→ {
    session, participant_id, participant_token,
    gateway_url, ice_servers,       // STUN/TURN
    permissions                     // bitmask (view_screen=1, control_input=2, …)
  }
```
- Android control chahiye → `control_mode: "full"` (ceiling me control_input hota hai).
- Sirf dekhna hai (ya iOS) → `control_mode: "view_stealth"` ya viewer role.

### 3.4 Gateway se WebSocket connect + Register
- `gateway_url` par WS kholo, **subprotocol `drs.signal.v1`**, binary protobuf
  frames. (Backend ka proto: `proto/drs/signal/v1/signal.proto`.)
- Pehla frame **Register** bhejो with `participant_token`.
- Gateway **Registered** deta hai jisme session info + aapke `permissions`.

### 3.5 WebRTC offer banao — **yeh zaroori hai**
Agent hamesha **answerer** hai. Aapke SDP **offer** me yeh hona chahiye:

1. **recvonly video** transceiver (phone ki screen receive karne ke liye), aur
2. ek **data channel jiska label `control`** ho (Android input bhejne ke liye).

Browser JS misaal:
```js
const pc = new RTCPeerConnection({ iceServers });   // step 3.3 wale ice_servers
pc.addTransceiver('video', { direction: 'recvonly' });   // screen aayegi
const control = pc.createDataChannel('control');         // input jaayega

pc.ontrack = (e) => { videoEl.srcObject = e.streams[0]; };   // screen render
pc.onicecandidate = (e) => sendIceCandidate(e.candidate);    // gateway par IceCandidate

const offer = await pc.createOffer();
await pc.setLocalDescription(offer);
sendSessionOffer(sessionId, agentDeviceId, offer.sdp);       // gateway par SessionOffer
```
- **SessionOffer** gateway par bhejो (`to` = agent device). Agent **SessionAnswer**
  aur ICE wapas bhejेga — unhe `pc.setRemoteDescription` / `pc.addIceCandidate`
  karo. ICE settle hote hi **screen `videoEl` me live** aa jaayegi.

### 3.6 Android control bhejना
`control` data channel par normalized (0..1) coordinates wale JSON events bhejो:
```jsonc
{"t":"tap","x":0.5,"y":0.5}
{"t":"long","x":0.5,"y":0.5,"ms":600}
{"t":"swipe","x1":0.5,"y1":0.8,"x2":0.5,"y2":0.2,"ms":250}
{"t":"key","k":"back"}      // home | recents | notifications | quick_settings | lock_screen | power_dialog
{"t":"text","text":"hello"}
```
- Mouse click → `tap` (click position ko video ke width/height se divide karke 0..1).
- Drag → `swipe`. Keyboard → `text` / `key`.
- Input tabhi apply hoga jab aapke paas **control_input** bit ho aur control_mode
  input allow kare (`full`/`parallel`/`backstage`). iOS par input ignore hota hai.

### 3.7 Session band karna
```
POST /v1/sessions/{id}/end
```

---

## 4. Dono (Android + iOS) ek saath desktop par dekhna

- Har phone ke liye ek alag session (`/devices/{id}/connect`) banao — har ek apna
  `participant_token` + WebRTC peer connection deta hai.
- Desktop UI me do video tiles rakho: ek Android ka `videoEl`, ek iOS ka. Dono
  independent P2P streams hain.
- Android tile par mouse/keyboard events → us peer ke `control` channel par.
- iOS tile view-only — input disabled.

---

## 5. iOS screen sharing ke liye zaroori (ek dafa, Apple account)

iOS screen capture ReplayKit **Broadcast Upload Extension** + **App Group** se
chalti hai. Project me yeh sab wire ho chuka hai (`ios/ScreenShare/`,
entitlements, Info.plist keys). Aapko sirf Apple Developer account me:

1. **App Group** register karo: `group.com.drs.app` (ya apna) — aur dono targets
   (`drs`, `ScreenShare`) me capability add karo.
2. Dono targets ko ek **Team** assign karo (Xcode → Signing & Capabilities,
   Automatic signing).
3. `cd ios && pod install` → `drs.xcworkspace` Xcode me kholo → real **device**
   par run karo (ReplayKit broadcast simulator par nahi chalti).

> Bundle ids: app `com.drs.app`, extension `com.drs.app.ScreenShare`, app group
> `group.com.drs.app`. Agar inhe badlo to teeno jagah match rakho:
> `ios/drs/Info.plist`, `ios/ScreenShare/Info.plist`, dono `.entitlements`.

Agar ids badalne hon to `ios/scripts/add_screenshare_extension.rb` ke constants
update karke dubara chala sakte ho.

---

## 6. Local test (sabse tez raasta)

1. Backend uthao: `cd Desktop-Remote-Solution && docker compose -f deploy/docker-compose.yml up`
2. Portal/Postman se: device-group + enrollment-token banao.
3. **Android**: `cd drs && npm run android` → enroll → accessibility ON.
4. Desktop: `tools/testpage/` kholo (ya apna WebRTC client) → login → device
   connect → **video transceiver + control channel** wala offer bhejो → screen
   aa jaayegi, control test karo.
5. **iOS**: section 5 ke steps ke baad real device par run → connect → **Start
   Broadcast** → screen desktop par view.

---

## 7. Do OS limitations (clarity ke liye)

| | Android | iOS |
|---|---------|-----|
| Screen **view** on desktop | ✅ | ✅ |
| Remote **control** (input) | ✅ (AccessibilityService) | ❌ (Apple allow nahi karta) |
| Screen capture auto-grant | ❌ (per-session consent) | ❌ (broadcast picker) |
| Control auto-enable | ❌ (manual accessibility ON) | — |

Yeh dono "nahi" OS security boundaries hain — enterprise MDM/supervised
provisioning ke bagair bypass nahi hoti.
```
```
