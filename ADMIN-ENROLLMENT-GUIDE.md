# Admin → user: enrollment token kaise do

Backend (live): **`https://api.2-25-114-216.nip.io`**
App me yeh URL default set hai, to user ko kuch change nahi karna.

Enrollment ka matlab: admin ek **enrollment token (secret)** banata hai aur woh
string phone user ko deta hai. User app me woh paste karke **Enroll** dabata hai —
bas, device register ho jaata hai aur online aa jaata hai.

```
Admin (portal/curl)                         Phone user (app)
───────────────────                         ────────────────
1. login            → access_token
2. device group     → group_id
3. enrollment token → secret  ───(share)──►  4. app me paste → Enroll → online
```

---

## Admin ke 3 steps (curl — copy/paste chalega)

> `TENANT`, `EMAIL`, `PASSWORD` apne admin account wale daalein (jo backend deploy
> karte waqt banaya tha).

### 1) Login → access_token
```bash
ACCESS=$(curl -s -X POST https://api.2-25-114-216.nip.io/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"tenant_slug":"TENANT","email":"EMAIL","password":"PASSWORD"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
echo "$ACCESS"
```

### 2) Device group banao (ek dafa) → group_id
```bash
GROUP=$(curl -s -X POST https://api.2-25-114-216.nip.io/v1/device-groups \
  -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d '{"name":"Phones","kind":"static"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
echo "$GROUP"
```

### 3) Enrollment token banao → **secret** (yahi user ko dena hai)
```bash
curl -s -X POST https://api.2-25-114-216.nip.io/v1/enrollment-tokens \
  -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Ali-ka-phone\",\"group_id\":\"$GROUP\",\"max_uses\":1}"
```
Response:
```json
{ "token": { "id": "...", "name": "Ali-ka-phone", "group_id": "...", "max_uses": 1 },
  "secret": "ent_XXXXXXXXXXXXXXXXXXXX" }     ← yeh "secret" user ko do
```

- `max_uses: 1` → token sirf ek phone enroll kar sakta hai (recommended).
- Har naye phone ke liye step 3 dubara chalao (ek naya secret).
- `expires_at` (ISO time) de kar token ko time-limited bhi kar sakte ho.

---

## User ko secret kaise bhejo

`secret` ek chhoti si string hai — kisi bhi tarah share karo:

- **WhatsApp / SMS / email** se bhej do; user app me paste kar de.
- Ya user ke paas phone ho to khud app me type karwa do.
- Portal UI ho to "copy" button se copy karke do.

> Security: secret kisi ko dikh gaya aur `max_uses` baaki ho to woh enroll kar
> sakta hai. Isliye `max_uses: 1` + short `expires_at` behtar hai. Secret public
> jagah (group chat, screenshot) par mat daalo.

---

## Phone user kya kare (app me)

1. **Desktop Remote** app kholo.
2. (API URL already bhara hua hai — chhedna nahi.)
3. **TOKEN** field me admin ka diya **secret** paste karo.
4. **Enroll device** dabao → status **Online** → desktop se dikhne/control hone ke
   liye ready.
5. Pehli session par screen-capture (aur Android par remote-control accessibility)
   ki ijaazat **Allow** karo.

---

## Portal UI se (agar available ho)

Curl ke bajaye portal me: **Device Groups → New** phir **Enrollment Tokens →
New** → token ka **secret** copy karke user ko do. REST endpoints wahi hain jo
upar hain (`/v1/device-groups`, `/v1/enrollment-tokens`).

---

## Verify: device online aa gaya?
```bash
curl -s https://api.2-25-114-216.nip.io/v1/devices \
  -H "Authorization: Bearer $ACCESS" | python3 -m json.tool | head -40
```
Enroll ke baad yahan device dikhega; gateway se connect hote hi `online: true`.
