#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "x-bookmark-to-obsidian 설치 프로그램을 시작합니다..."
echo ""

bash "$SCRIPT_DIR/native-host/install-macos.sh"

echo ""
echo "설치가 완료되었습니다."
echo "다음 단계:"
echo "  1. Chrome 재시작"
echo "  2. 확장 프로그램 팝업 열기"
echo "  3. Obsidian 저장 디렉토리 선택"
echo ""
printf "Enter 키를 누르면 창이 닫힙니다..."
read -r _
