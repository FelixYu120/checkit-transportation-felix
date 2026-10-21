#include "ConfigurationTransfer.h"
#include <assert.h>
#include <stdio.h>
#include <string>

using Transfer = CheckIt::ConfigurationTransfer;
using Result = Transfer::Result;

int main() {
  Transfer transfer;
  const std::string payload = "{\"key\":\"" + std::string(800, 'x') + "\"}";
  const unsigned parts = (payload.size() + 99) / 100;
  for (unsigned index = 0; index < parts; ++index) {
    const auto part = payload.substr(index * 100, 100);
    const auto result = transfer.append(7, "transfer1", index, parts, part.data(), part.size(), index * 100);
    assert(result == (index + 1 == parts ? Result::Complete : Result::Receiving));
  }
  assert(transfer.size() == payload.size());
  assert(std::string(transfer.data()) == payload);

  auto begin = [&]() { assert(transfer.append(7, "id", 0, 3, "a", 1, 100) == Result::Receiving); };
  begin();
  assert(transfer.append(7, "id", 2, 3, "c", 1, 200) == Result::Rejected); // Missing part.
  begin();
  assert(transfer.append(8, "id", 1, 3, "b", 1, 200) == Result::Rejected); // New BLE session.
  begin();
  assert(transfer.append(7, "other", 1, 3, "b", 1, 200) == Result::Rejected);
  begin();
  assert(transfer.append(7, "id", 1, 2, "b", 1, 200) == Result::Rejected);
  begin();
  assert(transfer.append(7, "id", 1, 3, "b", 1, 30101) == Result::Rejected); // Expired transfer.
  begin();
  assert(transfer.append(7, "id", 1, 3, "b", 1, 200) == Result::Receiving);
  assert(transfer.append(7, "id", 1, 3, "b", 1, 201) == Result::Rejected); // Duplicate.

  const std::string full(Transfer::kCapacity, 'x');
  assert(transfer.append(7, "id", 0, 2, full.data(), full.size(), 100) == Result::Receiving);
  assert(transfer.append(7, "id", 1, 2, "!", 1, 101) == Result::Rejected);
  assert(transfer.size() == 0);
  assert(transfer.append(7, "id", 0, 1, full.data(), full.size(), 100) == Result::Complete);
  assert(transfer.size() == Transfer::kCapacity);
  assert(transfer.append(7, "bad id", 0, 1, "x", 1, 100) == Result::Rejected);
  assert(transfer.append(7, "id", 0, 65, "x", 1, 100) == Result::Rejected);
  assert(transfer.append(7, "old", 0, 2, "old", 3, 100) == Result::Receiving);
  assert(transfer.append(8, "new", 0, 1, "new", 3, 200) == Result::Complete);
  assert(std::string(transfer.data()) == "new");
  puts("PASS: protected configuration reassembly, bounds, ordering, session isolation, timeout and restart.");
}
