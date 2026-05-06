#!/usr/bin/env bash
set -euo pipefail

echo "X Bookmark to Obsidian — Native Messaging Host Installer"
echo "========================================================="
echo ""

HOST_NAME="com.xbookmark.obsidian"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

NATIVE_HOST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$NATIVE_HOST_DIR"

MANIFEST_PATH="$NATIVE_HOST_DIR/${HOST_NAME}.json"

python3_path=$(which python3)

cat > "$MANIFEST_PATH" << EOF
{
  "name": "$HOST_NAME",
  "description": "X Bookmark to Obsidian native messaging host",
  "path": "$python3_path",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://EXTENSION_ID_PLACEHOLDER/"
  ]
}
EOF

echo "Native messaging host manifest created at: $MANIFEST_PATH"
echo ""
echo "IMPORTANT: Replace EXTENSION_ID_PLACEHOLDER with your actual extension ID"
echo "You can find it at chrome://extensions after loading the unpacked extension."
echo ""
echo "Native host files are located at: $SCRIPT_DIR/native-host/"
echo "Run the following to test the native host:"
echo "  echo '{\"action\":\"ping\"}' | python3 $SCRIPT_DIR/native-host/btl_file_writer.py"
