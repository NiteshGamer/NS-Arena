# How to Build the NS Arena APK

## What You Need
- A GitHub account (free)
- This zip file extracted

---

## Steps

### 1. Create a GitHub Repository
1. Go to github.com → click **+** → **New repository**
2. Name it `ns-arena`, set to **Private**, click **Create**

### 2. Upload All Files
On GitHub, click **uploading an existing file** and drag everything from this
folder into it. Make sure you include the hidden `.github/` folder too.

> On mobile: use the GitHub app or GitHub website to upload files one folder at a time.

### 3. Wait for the Build (about 5-8 minutes)
1. Go to your repo → click **Actions** tab
2. You'll see **"Build NS Arena APK"** running automatically
3. Wait for the green ✅ checkmark

### 4. Download the APK
1. Click on the completed workflow run
2. Scroll down to **Artifacts**
3. Click **NS-Arena-BETA-1.0.0** to download the zip
4. Extract it — inside is `app-debug.apk`

### 5. Install on Android
1. Transfer the APK to your phone
2. **Settings → Apps → Special app access → Install unknown apps**
3. Enable for your file manager
4. Tap the APK → Install

---

## Setting Up Multiplayer in the APK
Single Player works **offline** with no setup.

For Multiplayer you need your server running:
1. Start your server on Termux + ngrok as usual
2. Open NS Arena app → tap **Settings** (in-game top-right)
3. Enter your ngrok URL in the **Server URL** field
4. Tap **Save Server URL**
5. Go back and play Multiplayer

You only need to set the URL once — it's saved on the device.

---

## Re-building After Code Changes
Just push updated files to GitHub — Actions rebuilds automatically.
