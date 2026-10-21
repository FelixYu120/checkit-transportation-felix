#pragma once

#include <stddef.h>
#include <stdint.h>
#include <string.h>

namespace CheckIt {

// Reassemble independently encrypted/acknowledged provisioning messages.
// ESP-IDF 4.4's protocomm BLE prepare-write buffer is only 257 bytes.
class ConfigurationTransfer {
 public:
  static constexpr size_t kCapacity = 2048;
  static constexpr unsigned kMaxParts = 64;
  enum class Result { Rejected, Receiving, Complete };

  void reset() {
    active_ = false;
    used_ = next_ = total_ = 0;
    buffer_[0] = id_[0] = '\0';
  }

  Result append(uint32_t session, const char *id, unsigned index,
                unsigned total, const char *data, size_t size, uint32_t now) {
    if (!id || !id[0] || strlen(id) >= sizeof(id_) || !data || !size ||
        total == 0 || total > kMaxParts || index >= total) return reject();
    for (const char *p = id; *p; ++p) {
      if (!((*p >= 'a' && *p <= 'z') || (*p >= 'A' && *p <= 'Z') ||
            (*p >= '0' && *p <= '9') || *p == '-' || *p == '_')) return reject();
    }
    if (active_ && uint32_t(now - updated_) > 30000U) reset();
    if (index == 0) {
      reset();
      active_ = true;
      session_ = session;
      total_ = total;
      strcpy(id_, id);
    }
    if (!active_ || session != session_ || strcmp(id, id_) != 0 ||
        total != total_ || index != next_ || size > kCapacity - used_) return reject();
    memcpy(buffer_ + used_, data, size);
    used_ += size;
    buffer_[used_] = '\0';
    updated_ = now;
    ++next_;
    if (next_ != total_) return Result::Receiving;
    active_ = false;
    return Result::Complete;
  }

  const char *data() const { return buffer_; }
  size_t size() const { return used_; }
  unsigned nextIndex() const { return next_; }

 private:
  Result reject() { reset(); return Result::Rejected; }
  char buffer_[kCapacity + 1]{};
  char id_[25]{};
  size_t used_ = 0;
  unsigned next_ = 0, total_ = 0;
  uint32_t session_ = 0, updated_ = 0;
  bool active_ = false;
};

}  // namespace CheckIt
