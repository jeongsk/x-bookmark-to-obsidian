#!/bin/bash
# Install bundled native host runtime for X Bookmark to Obsidian on macOS.

set -euo pipefail

APP_NAME="x-bookmark-to-obsidian"
HOST_NAME="com.btl.file_writer"
EXTENSION_ID="bbldbbppbbfjepkhjadlpomoiajmngdk"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNTIME_DIR="$HOME/Library/Application Support/$APP_NAME/native-host"
HOST_PATH="$RUNTIME_DIR/btl_file_writer.py"
FETCHER_PATH="$RUNTIME_DIR/fetch_tweet.py"
MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"

if ! command -v python3 >/dev/null 2>&1; then
    echo "python3를 찾을 수 없습니다. Python 3를 먼저 설치한 후 설치 프로그램을 실행하세요."
    exit 1
fi

mkdir -p "$RUNTIME_DIR"
cp "$SCRIPT_DIR/btl_file_writer.py" "$HOST_PATH"
cp "$SCRIPT_DIR/fetch_tweet.py" "$FETCHER_PATH"
chmod +x "$HOST_PATH" "$FETCHER_PATH"

mkdir -p "$MANIFEST_DIR"
cat > "$MANIFEST_DIR/$HOST_NAME.json" <<MANIFEST
{
  "name": "$HOST_NAME",
  "description": "Native host for X Bookmark to Obsidian Chrome extension",
  "path": "$HOST_PATH",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
MANIFEST

echo "Installed runtime:"
echo "  $RUNTIME_DIR"
echo ""
echo "Installed native host manifest:"
echo "  $MANIFEST_DIR/$HOST_NAME.json"
echo ""
echo "Fixed extension ID:"
echo "  $EXTENSION_ID"
echo ""
echo "완료! 변경 사항을 적용하려면 Chrome을 재시작하세요."
