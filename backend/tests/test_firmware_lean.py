"""Compile the actual telemetry methods against fake I/O; exercise failure/retry
and JSON contracts without connecting hardware or replacing the production logic.
"""
import json
from pathlib import Path
import re
import shutil
import subprocess
import pytest

FIRMWARE = Path(__file__).resolve().parents[2]/'v2/firmware'


def test_actual_firmware_payloads_and_legacy_journal(tmp_path):
    compiler = shutil.which('clang++') or shutil.which('g++')
    if not compiler:
        pytest.skip('C++ compiler required for telemetry host test')
    source = (FIRMWARE/'lib/CloudTelemetry/CloudTelemetry.cpp').read_text()
    header = (FIRMWARE/'lib/CloudTelemetry/CloudTelemetry.h').read_text()
    # Methods have top-level closing braces at column zero. Include their actual
    # source, so changes to firmware selection/acknowledgement are under test.
    def method(name):
        match=re.search(r'^(?:void|bool|String) '+re.escape(name)+r'\([^\n]*(?:\n.*?)*?^}',source,re.M)
        assert match, name
        return match.group(0)
    structs='\n'.join(re.search(r'struct '+name+r' \{.*?\n\};',header,re.S).group(0)
                      for name in ['CloudHealthSnapshot','CloudTelemetryStats'])
    journal_header=(FIRMWARE/'lib/PassageJournal/PassageJournal.h').read_text()
    structs+='\n'+re.search(r'struct PassageJournalStats \{.*?\n\};',journal_header,re.S).group(0)
    code=r'''
#include <string>
#include <vector>
#include <cassert>
#include <iostream>
#include <ctime>
#include <cstring>
#include <type_traits>
#include "CheckItConfig.h"
#include "CloudPassage.h"
#define F(x) x
#define portENTER_CRITICAL(x) ((void)0)
#define portEXIT_CRITICAL(x) ((void)0)
#define pdTRUE 1
int xQueueSend(void*, const void*, int) { return 1; }
struct String : std::string {
  using std::string::string;
  using std::string::operator+=;
  template<class T, typename std::enable_if<std::is_integral<T>::value && !std::is_same<T,char>::value,int>::type = 0>
  String& operator+=(T value) { append(std::to_string(value)); return *this; }
};
struct SerialStub { void println(const char*){} template<class...T> void printf(const char*,T...){} } Serial;
using namespace CheckIt;
'''+structs+r'''
struct FakeJournal {
 std::vector<CloudPassage> records;
 bool acknowledged=false, failAck=false;
 size_t consumed=0, appended=0;
 uint32_t acknowledgedOffset() const { return acknowledged?records.size():0; }
 size_t readBatch(CloudPassage* batch,size_t capacity,uint32_t& next) {
   if(acknowledged) {next=records.size();return 0;}
   assert(records.size()<=capacity);
   for(size_t i=0;i<records.size();++i)batch[i]=records[i];
   next=records.size();return records.size();
 }
 bool acknowledge(uint32_t next,size_t count) {
   if(failAck)return false;
   assert(next==records.size());consumed=count;acknowledged=true;return true;
 }
 bool append(const CloudPassage&) {++appended;return true;}
 PassageJournalStats stats() const {return {true,3,1,2,400,1000};}
};
struct CloudTelemetry {
 struct Config { const char*sensorId="sensor\"test";const char*passageTableName="traffic_passages"; } config_;
 FakeJournal passageJournal_;
 CloudTelemetryStats stats_{};
 bool storageReady_=true, failPost=false;
 void* queue_=nullptr;
 mutable int statsMux_=0;
 std::vector<std::string> posted;
 int directionSlot(Direction d)const{return d==DIR_UNKNOWN?-1:0;}
 void recordQueueResult(bool){}
 bool postPayload(const char*,const char*,const String& body,uint32_t count,const char*) {
   assert(count>0);posted.push_back(body);return !failPost;
 }
 bool enqueue(const CloudPassage&);
 bool uploadPendingPassages();
 void appendPassageObject(String&,const CloudPassage&)const;
 String buildPassagePayload(const CloudPassage*,size_t)const;
 String buildHealthPayload(const CloudHealthSnapshot&)const;
};
'''
    for name in ['appendJsonString','appendObservedAt','CloudTelemetry::enqueue',
                 'CloudTelemetry::appendPassageObject','CloudTelemetry::buildPassagePayload',
                 'CloudTelemetry::buildHealthPayload','CloudTelemetry::uploadPendingPassages']:
        code+='\n'+method(name)
    code+=r'''
int main() {
 CloudPassage accepted{};accepted.bootId=7;accepted.passage.trackId=11;
 accepted.passage.direction=DIR_APPROACH;accepted.passage.qualityStatus=TRACK_ACCEPTED;
 accepted.passage.trafficClass=TRAFFIC_MOTOR_VEHICLE;
 accepted.passage.startedEpoch=1800000000;accepted.passage.endedEpoch=1800000010;
 accepted.passage.medianSpeedKmh=23;accepted.passage.maxSpeedKmh=31;
 auto rejected=accepted;rejected.passage.trackId=12;rejected.passage.qualityStatus=TRACK_REJECTED;
 auto review=accepted;review.passage.trackId=13;review.passage.qualityStatus=TRACK_REVIEW;
 CloudTelemetry t;
 // Non-accepted tracks must be consumed even if durable storage is unavailable.
 t.storageReady_=false;assert(t.enqueue(rejected));assert(t.enqueue(review));
 assert(!t.enqueue(accepted));assert(t.passageJournal_.appended==0);
 t.storageReady_=true;assert(t.enqueue(accepted));assert(t.passageJournal_.appended==1);
 t.passageJournal_.records={rejected,accepted,review};
 t.failPost=true;assert(!t.uploadPendingPassages());assert(!t.passageJournal_.acknowledged);
 t.failPost=false;t.passageJournal_.failAck=true;
 assert(!t.uploadPendingPassages());assert(!t.passageJournal_.acknowledged);
 t.passageJournal_.failAck=false;assert(t.uploadPendingPassages());
 assert(t.passageJournal_.consumed==3);assert(t.stats_.uploadedPassages==1);
 assert(t.posted.size()==3);assert(t.posted[0]==t.posted[1]&&t.posted[1]==t.posted[2]);
 std::cout<<t.posted.back()<<"\n";
 CloudTelemetry discarded;discarded.passageJournal_.records={rejected,review};
 assert(discarded.uploadPendingPassages());assert(discarded.posted.empty());
 assert(discarded.passageJournal_.consumed==2&&discarded.stats_.uploadedPassages==0);
 CloudHealthSnapshot health{};health.bootId=7;health.uptimeMs=1500;health.radarActive=true;
 health.radarFrameCount=42;health.wifiRssiDbm=-55;health.lastRadarFrameAgeMs=500;
 strcpy(health.wifiSsid,"Field \"AP\"");
 health.lastPassageEpoch=1800000010;
 std::cout<<t.buildHealthPayload(health)<<"\n";
}
'''
    cpp=tmp_path/'telemetry.cpp';cpp.write_text(code)
    binary=tmp_path/'telemetry'
    command=[compiler,'-std=c++17',str(cpp),'-o',str(binary)]
    for lib in ['CheckItConfig','CheckItCore','CloudTelemetry','TrafficTracker']:
        command+=['-I',str(FIRMWARE/'lib'/lib)]
    command += [str(FIRMWARE/'lib/TrafficTracker/TrafficTracker.cpp')]
    subprocess.run(command,check=True,capture_output=True,text=True)
    output=subprocess.run([str(binary)],check=True,capture_output=True,text=True).stdout.splitlines()
    passage=json.loads(output[0])[0]
    assert set(passage)=={'sensor_id','boot_id','track_id','observed_at','direction','traffic_class','speed_kmh','max_speed_kmh','firmware_version','received_at'}
    assert passage['track_id']==11 and passage['boot_id']==7
    assert passage['speed_kmh']==23 and passage['max_speed_kmh']==31
    assert passage['observed_at']=='2027-01-15T08:00:10Z'
    assert passage['received_at'] is None and passage['firmware_version']=='3.1.0-lean'
    health=json.loads(output[1])[0]
    assert set(health)=={'sensor_id','last_seen_at','last_radar_frame_at','last_passage_at','health_status','boot_id','uptime_ms','radar_active','wifi_rssi_dbm','pending_passages','storage_free_bytes','last_http_status','firmware_version','updated_at','diagnostics'}
    assert health['diagnostics']['wifi_ssid']=='Field \"AP\"'
    assert health['diagnostics']['radar_frame_count']==42
    assert health['diagnostics']['storage_errors']==3
    assert health['pending_passages']==3 and health['wifi_rssi_dbm']==-55
