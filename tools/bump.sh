#!/bin/sh
# 公開前に実行: 読み込みファイルのバージョンと、最新版チェック用の ver.txt をそろえる
cd "$(dirname "$0")/.." || exit 1
V=$(date +%Y%m%d%H%M%S)
sed -i '' -E "s#\?v=[0-9]+\"#?v=$V\"#g" index.html board.html
sed -i '' -E "s#window\.KT_VER = '[0-9]+'#window.KT_VER = '$V'#" index.html board.html
printf '%s\n' "$V" > ver.txt
echo "$V"
