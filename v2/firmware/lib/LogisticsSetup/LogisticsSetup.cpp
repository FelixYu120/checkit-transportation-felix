#include "LogisticsSetup.h"
#include "LogisticsSetupProtocol.h"
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLESecurity.h>
#include <freertos/queue.h>
#include <mbedtls/base64.h>
#include <cJSON.h>
namespace CheckIt { namespace LogisticsSetup {
namespace {
ProvisioningManager *manager=nullptr;
BLECharacteristic *response=nullptr;
QueueHandle_t commands=nullptr;
ProvisioningSettings draft{};
uint16_t fields=0;
uint32_t passkey=0;
bool running=false;
char deviceName[32]{};
char readyIdentity[32]{};
struct Message { bool reset; uint16_t length; char text[361]; };
void answer(const char *value){response->setValue(value);}
class Security:public BLESecurityCallbacks {
 uint32_t onPassKeyRequest() override{return passkey;}
 void onPassKeyNotify(uint32_t) override{}
 bool onSecurityRequest() override{return true;}
 bool onConfirmPIN(uint32_t) override{return false;}
 void onAuthenticationComplete(esp_ble_auth_cmpl_t result) override{
  if(!result.success)Serial.println("[SETUP] Bluetooth pairing failed");
 }
} securityCallbacks;
class Connection:public BLEServerCallbacks {
 void onConnect(BLEServer*,esp_ble_gatts_cb_param_t *param) override{
  Message m{};m.reset=true;xQueueSend(commands,&m,0);
  esp_ble_set_encryption(param->connect.remote_bda,ESP_BLE_SEC_ENCRYPT_MITM);
 }
 void onDisconnect(BLEServer*) override{
  Message m{};m.reset=true;xQueueSend(commands,&m,0);
  BLEDevice::startAdvertising();
 }
} connection;
class Write:public BLECharacteristicCallbacks {
 void onWrite(BLECharacteristic *c) override{
  const auto value=c->getValue();Message m{};
  if(value.size()>360){answer("ERR command too long");return;}
  m.length=value.size();memcpy(m.text,value.data(),value.size());
  // GATT permissions enforce encrypted, PIN-authenticated writes before here.
  if(xQueueSend(commands,&m,0)!=pdTRUE)answer("ERR busy; retry");
  c->setValue(""); // Do not retain credentials in the GATT value.
 }
} writeCallback;
bool publicKey(const char *key){
 if(!strncmp(key,"sb_publishable_",15))return strlen(key)>15;
 const char *first=strchr(key,'.');if(!first)return false;
 const char *last=strchr(first+1,'.');if(!last)return false;
 char encoded[432]{};size_t n=last-first-1;if(n>425)return false;
 memcpy(encoded,first+1,n);for(size_t i=0;i<n;++i){if(encoded[i]=='-')encoded[i]='+';if(encoded[i]=='_')encoded[i]='/';}
 while(n%4)encoded[n++]='=';
 unsigned char decoded[432]{};size_t length=0;
 if(mbedtls_base64_decode(decoded,sizeof(decoded)-1,&length,reinterpret_cast<unsigned char*>(encoded),n))return false;
 cJSON *json=cJSON_Parse(reinterpret_cast<char*>(decoded));
 const cJSON *role=cJSON_GetObjectItemCaseSensitive(json,"role");
 const bool ok=cJSON_IsString(role)&&!strcmp(role->valuestring,"anon");cJSON_Delete(json);return ok;
}
void process(const Message &m){
 if(m.reset){draft=manager->settings();fields=0;answer(readyIdentity);return;}
 if(manager->provisioned()){answer("ERR already committed");return;}
 SetupCommand cmd{};
 if(!parseSetupCommand(m.text,m.length,cmd)){answer("ERR invalid setting");return;}
 if(cmd.commit){
  if(fields!=((1U<<SETUP_FIELD_COUNT)-1)){answer("ERR incomplete configuration");return;}
  String error;
  if(!ProvisioningManager::validate(draft,error)){answer((String("ERR ")+error).c_str());return;}
  if(!manager->commitSettings(draft)){answer("ERR could not store configuration");return;}
  answer("OK committed");memset(&draft,0,sizeof(draft));
  Serial.println("[SETUP] app configuration saved; rebooting in five seconds");return;
 }
 if(cmd.field==SUPABASE_KEY&&!publicKey(cmd.value)){answer("ERR use publishable or anon key");return;}
 switch(cmd.field){
 case DEVICE_NAME:strcpy(draft.deviceName,cmd.value);break;
 case SENSOR_ID:strcpy(draft.sensorId,cmd.value);break;
 case WIFI_SSID:strcpy(draft.wifiSsid,cmd.value);break;
 case WIFI_PASSWORD:strcpy(draft.wifiPassword,cmd.value);break;
 case SUPABASE_URL:strcpy(draft.supabaseUrl,cmd.value);break;
 case SUPABASE_KEY:strcpy(draft.supabaseKey,cmd.value);break;
 case SPEED_LIMIT:draft.speedLimitKmh=cmd.number;break;
 case DANGER_SPEED:draft.dangerSpeedKmh=cmd.number;break;
 case EMERGENCY_SPEED:draft.emergencySpeedKmh=cmd.number;break;
 case LATITUDE:draft.latitude=cmd.number;break;
 case LONGITUDE:draft.longitude=cmd.number;break;
 case HEADING:draft.radarHeadingDeg=cmd.number;break;
 default:return;
 }
 fields|=1U<<cmd.field;
 char ack[64];snprintf(ack,sizeof(ack),"OK %s",setupFieldName(cmd.field));answer(ack);
 memset(&cmd,0,sizeof(cmd));
}
}
bool begin(ProvisioningManager &storage,uint32_t pin){
 manager=&storage;if(storage.provisioned())return true;
 if(pin<100000||pin>999999)return false;
 commands=xQueueCreate(4,sizeof(Message));if(!commands)return false;
 passkey=pin;const uint64_t mac=ESP.getEfuseMac();
 // Full stable identity is read only over the authenticated setup characteristic.
 snprintf(readyIdentity,sizeof(readyIdentity),"READY serial=%02X%02X%02X%02X%02X%02X",
  unsigned(mac&255),unsigned((mac>>8)&255),unsigned((mac>>16)&255),
  unsigned((mac>>24)&255),unsigned((mac>>32)&255),unsigned((mac>>40)&255));
 snprintf(deviceName,sizeof(deviceName),"CheckIt-Setup-%02X%02X",unsigned((mac>>32)&255),unsigned((mac>>40)&255));
 BLEDevice::init(deviceName);BLEDevice::setMTU(512);BLEDevice::setSecurityCallbacks(&securityCallbacks);
 static BLESecurity security;
 security.setStaticPIN(pin);security.setAuthenticationMode(ESP_LE_AUTH_REQ_SC_MITM_BOND);
 security.setCapability(ESP_IO_CAP_OUT);security.setKeySize(16);
 security.setInitEncryptionKey(ESP_BLE_ENC_KEY_MASK|ESP_BLE_ID_KEY_MASK);
 security.setRespEncryptionKey(ESP_BLE_ENC_KEY_MASK|ESP_BLE_ID_KEY_MASK);
 BLEServer *server=BLEDevice::createServer();server->setCallbacks(&connection);
 BLEService *service=server->createService("71d10001-6e7b-4b7d-9f35-3bb4ecb1c101");
 auto *command=service->createCharacteristic("71d10002-6e7b-4b7d-9f35-3bb4ecb1c101",BLECharacteristic::PROPERTY_WRITE);
 command->setAccessPermissions(ESP_GATT_PERM_WRITE_ENC_MITM);command->setCallbacks(&writeCallback);
 response=service->createCharacteristic("71d10003-6e7b-4b7d-9f35-3bb4ecb1c101",BLECharacteristic::PROPERTY_READ);
 response->setAccessPermissions(ESP_GATT_PERM_READ_ENC_MITM);answer(readyIdentity);
 service->start();auto *advertising=BLEDevice::getAdvertising();
 advertising->addServiceUUID(service->getUUID());advertising->setScanResponse(true);advertising->start();
 draft=storage.settings();running=true;
 Serial.printf("[SETUP] %s: logistics app PIN-protected setup ready\n",deviceName);return true;
}
void update(){if(!running)return;Message m{};if(xQueueReceive(commands,&m,0)==pdTRUE){process(m);memset(&m,0,sizeof(m));}}
bool active(){return running;}
const char *name(){return deviceName;}
} }
