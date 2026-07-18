#!/bin/bash
# Runs on Codemagic (macOS agent) after `npx cap add ios` / `npx cap sync ios`.
# Injects the privacy manifest + Info.plist keys Apple requires for review.
set -euo pipefail

IOS_APP_DIR="mobile/ios/App/App"
PLIST="$IOS_APP_DIR/Info.plist"

if [ ! -f "$PLIST" ]; then
  echo "❌ $PLIST not found — did 'cap add ios' run first?"
  exit 1
fi

echo "→ Writing PrivacyInfo.xcprivacy"
cat > "$IOS_APP_DIR/PrivacyInfo.xcprivacy" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>NSPrivacyTracking</key>
	<false/>
	<key>NSPrivacyTrackingDomains</key>
	<array/>
	<key>NSPrivacyCollectedDataTypes</key>
	<array>
		<dict>
			<key>NSPrivacyCollectedDataType</key>
			<string>NSPrivacyCollectedDataTypeEmailAddress</string>
			<key>NSPrivacyCollectedDataTypeLinked</key>
			<true/>
			<key>NSPrivacyCollectedDataTypeTracking</key>
			<false/>
			<key>NSPrivacyCollectedDataTypePurposes</key>
			<array>
				<string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
			</array>
		</dict>
		<dict>
			<key>NSPrivacyCollectedDataType</key>
			<string>NSPrivacyCollectedDataTypeUserID</string>
			<key>NSPrivacyCollectedDataTypeLinked</key>
			<true/>
			<key>NSPrivacyCollectedDataTypeTracking</key>
			<false/>
			<key>NSPrivacyCollectedDataTypePurposes</key>
			<array>
				<string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
			</array>
		</dict>
		<dict>
			<key>NSPrivacyCollectedDataType</key>
			<string>NSPrivacyCollectedDataTypeCustomerSupport</string>
			<key>NSPrivacyCollectedDataTypeLinked</key>
			<true/>
			<key>NSPrivacyCollectedDataTypeTracking</key>
			<false/>
			<key>NSPrivacyCollectedDataTypePurposes</key>
			<array>
				<string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
			</array>
		</dict>
	</array>
	<key>NSPrivacyAccessedAPITypes</key>
	<array>
		<dict>
			<key>NSPrivacyAccessedAPIType</key>
			<string>NSPrivacyAccessedAPICategoryUserDefaults</string>
			<key>NSPrivacyAccessedAPITypeReasons</key>
			<array>
				<string>CA92.1</string>
			</array>
		</dict>
	</array>
</dict>
</plist>
EOF

echo "→ Setting Info.plist export compliance + display values"
/usr/libexec/PlistBuddy -c "Delete :ITSAppUsesNonExemptEncryption" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :ITSAppUsesNonExemptEncryption bool false" "$PLIST"

/usr/libexec/PlistBuddy -c "Delete :NSUserTrackingUsageDescription" "$PLIST" 2>/dev/null || true

/usr/libexec/PlistBuddy -c "Delete :CFBundleDisplayName" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string Friendy" "$PLIST"

/usr/libexec/PlistBuddy -c "Delete :UIRequiresFullScreen" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :UIRequiresFullScreen bool true" "$PLIST"

/usr/libexec/PlistBuddy -c "Delete :ITSEncryptionExportComplianceCode" "$PLIST" 2>/dev/null || true

echo "✅ postcap.sh done"
