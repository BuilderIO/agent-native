# NutriTrack iOS App Build Instructions

This guide will help you build and deploy the NutriTrack native iOS app to your iPhone with Apple Health integration.

## Prerequisites

1. **Mac computer** with macOS
2. **Xcode** (free from App Store)
3. **Apple ID** (free - no paid developer account needed for personal use)
4. **iPhone** with iOS 15+
5. **USB cable** to connect iPhone to Mac

## One-Time Setup

### 1. Clone the Repository

```bash
git clone https://github.com/steve8708/calorie-tracker.git
cd calorie-tracker
```

### 2. Install Dependencies

```bash
pnpm install
# or
npm install
```

### 3. Build the Web App

```bash
npm run build:client
```

### 4. Sync iOS Project

```bash
npx cap sync ios
```

### 5. Open in Xcode

```bash
npx cap open ios
```

This opens the iOS project in Xcode.

## Xcode Configuration

### 1. Select Your Team

1. In Xcode, click on **App** in the left sidebar (the project)
2. Select the **App** target
3. Go to **Signing & Capabilities** tab
4. Check **Automatically manage signing**
5. Select your **Team** (your Apple ID)
   - If you don't see your Apple ID, go to Xcode → Settings → Accounts → Add your Apple ID

### 2. Add HealthKit Capability

1. In **Signing & Capabilities** tab, click **+ Capability**
2. Search for and add **HealthKit**
3. Make sure these are checked:
   - ✅ HealthKit
   - ✅ Clinical Health Records (optional)

### 3. Add Entitlements File

The entitlements file should already be at `ios/App/App/App.entitlements`. If not linked:

1. In Xcode, select the **App** target
2. Go to **Build Settings** tab
3. Search for "Code Signing Entitlements"
4. Set the value to: `App/App.entitlements`

### 4. Update Bundle Identifier (if needed)

If you get a signing error, you may need to change the bundle ID:

1. Go to **Signing & Capabilities**
2. Change **Bundle Identifier** to something unique like: `com.yourname.nutritrack`

## Build and Run on Your iPhone

### 1. Connect Your iPhone

1. Connect iPhone to Mac via USB
2. **Trust this computer** when prompted on iPhone
3. In Xcode, select your iPhone from the device dropdown (top of screen)

### 2. Enable Developer Mode on iPhone (iOS 16+)

1. Go to iPhone **Settings** → **Privacy & Security**
2. Scroll down and tap **Developer Mode**
3. Enable it and restart when prompted

### 3. Build and Run

1. Click the **Play button** (▶️) in Xcode, or press `Cmd + R`
2. Wait for the build to complete
3. **First time only**: You'll see "Untrusted Developer" on your iPhone
   - Go to iPhone **Settings** → **General** → **VPN & Device Management**
   - Tap your Apple ID email
   - Tap **Trust "your email"**
4. Run again from Xcode

## Using Apple Health

When you first open the app:

1. Tap the **Health** button next to Exercise
2. Grant permission when prompted to access Apple Health
3. Your workouts will be available to import!

When you log weight:
- It automatically syncs to Apple Health
- You'll see "Weight logged & synced to Apple Health"

## Re-deploying After Code Changes

Whenever you make changes:

```bash
# Build the web app
npm run build:client

# Sync with iOS
npx cap sync ios

# Open Xcode and run
npx cap open ios
```

Or run all at once:
```bash
npm run build:client && npx cap sync ios && npx cap open ios
```

## Notes

### Free Developer Account Limitations

With a free Apple ID (no $99/year developer program):
- App expires after **7 days** and needs to be reinstalled
- You can only install on **3 devices**
- No App Store distribution

### Paid Developer Account ($99/year)

If you want the app to stay installed permanently:
1. Enroll at https://developer.apple.com/programs/
2. Your apps won't expire
3. You can distribute via TestFlight or App Store

## Troubleshooting

### "Untrusted Developer" Error
→ Go to Settings → General → VPN & Device Management → Trust your developer certificate

### "Unable to install" Error
→ Delete any existing NutriTrack app on your phone, then try again

### Build Fails with Signing Error
→ Make sure you selected a Team in Signing & Capabilities
→ Try changing the Bundle Identifier to something unique

### HealthKit Not Working
→ Make sure HealthKit capability is added in Xcode
→ Check that you granted permissions when prompted
→ Go to Settings → Health → Data Access & Devices → NutriTrack to manage permissions

### App Crashes on Launch
→ Check Xcode console for errors
→ Make sure you ran `npx cap sync ios` after building
