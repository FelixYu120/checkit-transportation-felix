#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
test_binary="$(mktemp /tmp/checkit-config-test.XXXXXX)"
trap 'rm -f "$test_binary"' EXIT
clang++ -std=c++17 -fsanitize=address,undefined -Ilib/ProvisioningManager \
  tools/tests/configuration_transfer_test.cpp -o "$test_binary"
"$test_binary"
