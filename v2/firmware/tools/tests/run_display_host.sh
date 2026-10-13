#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
test_binary="$(mktemp /tmp/checkit-display-test.XXXXXX)"
trap 'rm -f "$test_binary"' EXIT
clang++ -std=c++17 -Itools/tests/display_host \
  -Ilib/RadarDisplayAddon -Ilib/Ld2451Protocol -Ilib/LonelyBinaryDisplay \
  -Ilib/SpeedDisplayPolicy -Ilib/TargetQuality -Ilib/CheckItCore \
  -Ilib/CheckItProtocol -Ilib/CheckItConfig \
  tools/tests/display_host/flash_test.cpp \
  lib/RadarDisplayAddon/RadarDisplayAddon.cpp \
  lib/Ld2451Protocol/Ld2451Protocol.cpp \
  lib/LonelyBinaryDisplay/LonelyBinaryDisplay.cpp \
  lib/SpeedDisplayPolicy/SpeedDisplayPolicy.cpp \
  lib/TargetQuality/TargetQuality.cpp -o "$test_binary"
"$test_binary"
