#include "RadarCloudAddon.h"
#include "RadarDisplayAddon.h"
#include "ProvisioningManager.h"
#include "LogisticsSetup.h"
#include "CloudTelemetry.h"
#include "TrafficTracker.h"
#include "TargetQuality.h"
#include "CheckItSecrets.h"
#include <WiFi.h>
#include <time.h>
#include <esp_system.h>
namespace CheckIt { namespace RadarCloudAddon {
namespace {
ProvisioningManager manager;
uint32_t bootId=0,lastHealth=0,lastConnect=0,lastPassageEpoch=0;
bool cloudStarted=false;
RadarDisplayAddon::Snapshot radar{};
uint32_t epoch(){time_t now=time(nullptr);return now>=CHECKIT_MIN_VALID_UNIX_TIME?uint32_t(now):0;}
bool timeReady(){return epoch()!=0;}
const CloudTelemetryConfig config{manager.settings().supabaseUrl,manager.settings().supabaseKey,
 CHECKIT_SUPABASE_TABLE,CHECKIT_SUPABASE_PASSAGE_TABLE,CHECKIT_SUPABASE_HEALTH_TABLE,manager.settings().sensorId,timeReady};
CloudTelemetry cloud(config);
const TrafficTrackerConfig trafficTrackerConfig{
    CHECKIT_TRACKER_MAX_ASSOCIATION_GAP_MS,
    CHECKIT_TRACKER_FINALIZE_GAP_MS,
    CHECKIT_TRACKER_PATH_SAMPLE_INTERVAL_MS,
    CHECKIT_TRACKER_MIN_DURATION_MS,
    CHECKIT_TRACKER_MIN_HITS,
    CHECKIT_TRACKER_MIN_TRAVEL_M,
    CHECKIT_TRACKER_MAX_DISTANCE_DELTA_M,
    CHECKIT_TRACKER_MAX_ANGLE_DELTA_DEG,
    CHECKIT_TRACKER_MAX_SPEED_DELTA_KMH,
    CHECKIT_TRACKER_CLUSTER_DISTANCE_M,
    CHECKIT_TRACKER_CLUSTER_ANGLE_DEG,
    CHECKIT_TRACKER_CLUSTER_SPEED_KMH,
    CHECKIT_TRACKER_MIN_ASSOCIATION_CONFIDENCE,
    CHECKIT_TRACKER_MIN_DIRECTION_CONSISTENCY,
    CHECKIT_TRACKER_ACCEPTED_QUALITY_SCORE,
    CHECKIT_TRACKER_REVIEW_QUALITY_SCORE,
    CHECKIT_TRAFFIC_MICROMOBILITY_MIN_SPEED_KMH,
    CHECKIT_TRAFFIC_MOTOR_VEHICLE_MIN_SPEED_KMH,
    CHECKIT_TRAFFIC_CLASS_CONFIDENCE_THRESHOLD};
TrafficTracker trafficTracker(trafficTrackerConfig);

const TargetQualityConfig targetQualityConfig{
    CHECKIT_TELEMETRY_MIN_DISTANCE_M,
    CHECKIT_TELEMETRY_MAX_DISTANCE_M,
    CHECKIT_TELEMETRY_MIN_SNR,
    CHECKIT_TELEMETRY_MAX_ABS_ANGLE_DEG,
    CHECKIT_TELEMETRY_MIN_SPEED_KMH,
    CHECKIT_IMPLAUSIBLE_SPEED_KMH,
    CHECKIT_IMPLAUSIBLE_SPEED_MIN_SNR,
    CHECKIT_TARGET_CONFIRMATION_MAX_DISTANCE_DELTA_M,
    CHECKIT_TARGET_CONFIRMATION_MAX_ANGLE_DELTA_DEG,
    CHECKIT_TARGET_CONFIRMATION_MAX_SPEED_DELTA_KMH,
    CHECKIT_TARGET_CONFIRMATION_MAX_FRAME_GAP_MS};

void observe(const Ld2451Frame &frame,uint32_t now){
 if(!cloudStarted)return;
 RadarTarget usable[kLd2451MaxTargets]{};uint8_t count=0;
 for(uint8_t i=0;i<frame.targetCount;++i)if(passesTargetQualityGate(frame.targets[i],targetQualityConfig))usable[count++]=frame.targets[i];
 trafficTracker.update(usable,count,now,epoch());
}
String quote(const char *s){String r="\"";for(;*s;++s){if(*s=='"'||*s=='\\')r+='\\';if(uint8_t(*s)>=32)r+=*s;}return r+"\"";}
}
bool serialControl(char command){
 if(command=='s')Serial.println(String("[CLOUD STATUS] ")+statusJson());
 if(command=='h')Serial.println("[CLOUD] u=upload pending data; P=reopen app setup using compiled recovery token (clears configuration, preserves journal)");
 if(command=='u'){Serial.println(uploadNow()?"[CLOUD] upload requested":"[CLOUD] uploader unavailable");return true;}
 if(command=='P'){
  Serial.println(resetSetup(String(CHECKIT_ADMIN_RESET_TOKEN))?"[SETUP] recovery accepted; restart into app setup":"[SETUP] recovery refused: not provisioned or compiled token does not match saved token");return true;
 }
 return false;
}
void begin(){
 bootId=esp_random();ProvisioningSettings defaults{};
 snprintf(defaults.deviceName,sizeof(defaults.deviceName),"%s",CHECKIT_DEVICE_NAME);
 snprintf(defaults.adminResetToken,sizeof(defaults.adminResetToken),"%s",CHECKIT_ADMIN_RESET_TOKEN);
 defaults.speedLimitKmh=13;defaults.dangerSpeedKmh=25;defaults.emergencySpeedKmh=35;
 // No cloud upload until the app commits a sensor identity and credentials.
 if(!manager.begin(defaults,CHECKIT_BLE_SETUP_PIN,false))Serial.println("[CLOUD] settings storage failed");
 if(!LogisticsSetup::begin(manager,CHECKIT_BLE_SETUP_PIN))Serial.println("[SETUP] logistics BLE startup failed");
 if(manager.provisioned())RadarDisplayAddon::configureLimit(manager.settings().speedLimitKmh);
 RadarDisplayAddon::onLiveReport(observe);
 RadarDisplayAddon::onSerialCommand(serialControl);
}
void connect(){
 if(!manager.provisioned())return;
 WiFi.begin(manager.settings().wifiSsid,manager.settings().wifiPassword);
 lastConnect=millis();configTime(0,0,"pool.ntp.org","time.google.com");
 cloudStarted=cloud.begin();
 Serial.printf("[CLOUD] configured sensor=%s; app limit=%u km/h; display=mph; uploader=%s\n",manager.settings().sensorId,manager.settings().speedLimitKmh,cloud.enabled()?"ready":"unavailable");
}
void update(uint32_t now){
 LogisticsSetup::update();manager.update(now);
 if(!manager.provisioned()||manager.state().restartPending)return;
 if(WiFi.status()!=WL_CONNECTED && uint32_t(now-lastConnect)>=15000){lastConnect=now;WiFi.reconnect();}
 if(cloudStarted){
  trafficTracker.expire(now,epoch());
  TrafficPassage passage{};
  if(trafficTracker.peekCompleted(passage)&&cloud.storageReady()&&cloud.enqueue(CloudPassage{bootId,passage})){
   lastPassageEpoch=passage.endedEpoch;trafficTracker.discardCompleted();
  }
 }
 if(uint32_t(now-lastHealth)<5000)return;lastHealth=now;
 RadarDisplayAddon::snapshot(radar,now);
 CloudHealthSnapshot h{};snprintf(h.deviceName,sizeof(h.deviceName),"%s",manager.settings().deviceName);
 h.bootId=bootId;h.uptimeMs=now;h.radarFrameCount=radar.stats.validFrames;
 h.radarFrameErrors=radar.stats.invalidLengths+radar.stats.invalidPayloads+radar.stats.invalidTrailers;
 h.lastRadarFrameAgeMs=radar.hasReport?radar.reportAgeMs:UINT32_MAX;
 h.lastPassageEpoch=lastPassageEpoch;h.wifiRssiDbm=WiFi.status()==WL_CONNECTED?WiFi.RSSI():0;
 h.speedLimitKmh=manager.settings().speedLimitKmh;h.resetReason=esp_reset_reason();
 h.radarActive=radar.hasReport&&radar.reportAgeMs<=3000;h.provisioned=manager.provisioned();h.bleActive=LogisticsSetup::active();
 cloud.updateHealth(h);
}
String statusJson(){
 const auto stats=cloud.stats();
 String json="{\"provisioned\":"+String(manager.provisioned()?"true":"false")+",\"setupName\":"+quote(LogisticsSetup::name());
 json+=",\"sensorId\":"+quote(manager.settings().sensorId)+",\"wifi\":"+String(WiFi.status()==WL_CONNECTED?"true":"false");
 json+=",\"timeReady\":"+String(timeReady()?"true":"false")+",\"enabled\":"+String(cloud.enabled()?"true":"false");
 json+=",\"storageReady\":"+String(cloud.storageReady()?"true":"false")+",\"pending\":"+String(stats.pendingPassages);
 json+=",\"uploaded\":"+String(stats.uploadedPassages)+",\"healthUploaded\":"+String(stats.uploadedHealthReports);
 json+=",\"lastHttp\":"+String(stats.lastHttpStatus)+",\"droppedTracks\":"+String(trafficTracker.stats().droppedCompletedTracks)+"}";
 return json;
}
bool uploadNow(){return cloud.enabled()&&cloud.requestUploadNow();}
bool resetSetup(const String &token){return manager.adminTokenMatches(token)&&manager.requestSetupReset(millis());}
} }
