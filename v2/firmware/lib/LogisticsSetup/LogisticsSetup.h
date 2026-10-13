#pragma once
#include "ProvisioningManager.h"
namespace CheckIt { namespace LogisticsSetup {
bool begin(ProvisioningManager &manager, uint32_t pin);
void update();
bool active();
const char *name();
} }
