#include <Arduino.h>
#include <driver/uart.h>
#include <esp_err.h>

// RX-only IDF UART setup: no ESP32 TX pin is assigned and no radar writes exist.
constexpr uart_port_t kUart = UART_NUM_2;
QueueHandle_t events = nullptr;
bool ready = false;
bool bannerShown = false;
uint32_t bytesReceived = 0, uartErrors = 0, lastByteMs = 0, lastStatusMs = 0;
static_assert(LDTR_PARITY >= 0 && LDTR_PARITY <= 2, "Invalid parity setting");
static_assert(LDTR_STOP_BITS == 1 || LDTR_STOP_BITS == 2, "Invalid stop bits");

void banner() {
  Serial.println("\nLDTR21BT_A / T-SIM7080G-S3 receive-only bench capture");
  Serial.printf("USB=115200; radar RX=GPIO%d, %d baud, 8 data bits, parity=%d, stop=%d\n",
                LDTR_RX_PIN, LDTR_BAUD, LDTR_PARITY, LDTR_STOP_BITS);
  Serial.println("Radar settings are provisional. Confirm the exact unit's supply, pinout and protocol.");
  Serial.println("No commands transmitted. HEX/ASCII chunks are NOT protocol frames or decoded speeds.");
  Serial.println("USB keys: h=help, s=status. Output requires an open USB monitor.");
}

void status() {
  Serial.printf("[STATUS] uart=%s bytes=%lu errors=%lu last_byte_age_ms=",
                ready ? "ready" : "failed", (unsigned long)bytesReceived,
                (unsigned long)uartErrors);
  if (bytesReceived) Serial.println(millis() - lastByteMs);
  else Serial.println("none (silence does not prove the radar is off)");
}

bool check(esp_err_t result, const char* stage) {
  if (result == ESP_OK) return true;
  Serial.printf("[SETUP ERROR] %s: %s\n", stage, esp_err_to_name(result));
  return false;
}

void setup() {
  Serial.begin(115200);
  delay(1200);
  uart_config_t config = {};
  config.baud_rate = LDTR_BAUD;
  config.data_bits = UART_DATA_8_BITS;
  config.parity = LDTR_PARITY == 1 ? UART_PARITY_EVEN :
                  LDTR_PARITY == 2 ? UART_PARITY_ODD : UART_PARITY_DISABLE;
  config.stop_bits = LDTR_STOP_BITS == 2 ? UART_STOP_BITS_2 : UART_STOP_BITS_1;
  config.flow_ctrl = UART_HW_FLOWCTRL_DISABLE;
  config.source_clk = UART_SCLK_APB;
  ready = check(uart_param_config(kUart, &config), "config") &&
          check(uart_set_pin(kUart, UART_PIN_NO_CHANGE, LDTR_RX_PIN,
                             UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE), "RX pin") &&
          check(uart_driver_install(kUart, 4096, 0, 20, &events, 0), "driver");
  if (Serial) { banner(); status(); bannerShown = true; }
}

void loop() {
  if (Serial && !bannerShown) { banner(); status(); bannerShown = true; }
  while (Serial.available()) {
    char c = Serial.read();
    if (c == 'h' || c == '?') banner();
    if (c == 's') status();
  }
  if (ready) {
    uart_event_t event;
    while (xQueueReceive(events, &event, 0) == pdTRUE) {
      if (event.type == UART_FIFO_OVF || event.type == UART_BUFFER_FULL ||
          event.type == UART_PARITY_ERR || event.type == UART_FRAME_ERR) {
        ++uartErrors;
        Serial.printf("[UART ERROR] event=%d (overflow/parity/framing); capture may be incomplete\n", event.type);
      }
    }
    uint8_t data[32];
    int count = uart_read_bytes(kUart, data, sizeof(data), pdMS_TO_TICKS(10));
    if (count > 0) {
      bytesReceived += count;
      lastByteMs = millis();
      // Drain UART even without a USB client, without blocking on console output.
      if (Serial) {
        Serial.printf("[RX %lu ms] ", (unsigned long)lastByteMs);
        for (int i = 0; i < count; ++i) Serial.printf("%02X ", data[i]);
        Serial.print(" | ");
        for (int i = 0; i < count; ++i)
          Serial.write(data[i] >= 32 && data[i] <= 126 ? data[i] : '.');
        Serial.println();
      }
    }
  }
  if (Serial && millis() - lastStatusMs >= 5000) { status(); lastStatusMs = millis(); }
  delay(1);
}
