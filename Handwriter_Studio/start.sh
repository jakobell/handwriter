#!/usr/bin/env sh
cd "$(dirname "$0")" || exit 1
exec python3 -m http.server 8000 --bind 127.0.0.1 --directory docs
