#include <Arduino.h>
#include <cassert>
#include <cstdio>
#include <vector>
#include "RadarDisplayAddon.h"
#include "SpeedDisplayPolicy.h"
FakeSerial Serial;
uint32_t now=0;
bool pins[64]{};
uint16_t shifted=0,last=0xFFFF;
unsigned bits=0,latches=0;
uint32_t millis(){return now;}
void pinMode(int pin,int){assert(pin==21||pin==47||pin==48);}
uint64_t elapsedUs=0, lastClockEdgeUs=0, latchRiseUs=0;
void delayMicroseconds(unsigned int us){assert(us==500);elapsedUs+=us;}
void digitalWrite(int pin,int value){
  assert(pin==21||pin==47||pin==48);
  if(pin==48&&value==HIGH&&!pins[pin]){shifted=uint16_t((shifted<<1)|pins[21]);++bits;}
  if(pin==47&&value==HIGH&&!pins[pin]){assert(bits==16);bits=0;++latches;last=shifted;}
  if(pin==48 && bool(value)!=pins[pin]){assert(elapsedUs-lastClockEdgeUs>=500);lastClockEdgeUs=elapsedUs;}
  if(pin==47 && value==HIGH && !pins[pin])latchRiseUs=elapsedUs;
  if(pin==47 && value==LOW && pins[pin])assert(elapsedUs-latchRiseUs==500);
  pins[pin]=value;
}
void update(uint32_t t){now=t;CheckIt::RadarDisplayAddon::update(t);}
void command(char c,uint32_t t){Serial.pending=c;update(t);}
void begin(uint32_t t){now=t;CheckIt::RadarDisplayAddon::begin();assert(last==0);}
void bytes(uint32_t t,const std::vector<uint8_t>& data){
  now=t;for(auto b:data)CheckIt::RadarDisplayAddon::observeByte(b,t);update(t);
}
void report(uint32_t t,uint8_t speed=0,uint8_t snr=255,uint8_t distance=13,uint8_t angle=0x90){
  if(!speed) bytes(t,{0xF4,0xF3,0xF2,0xF1,0,0,0xF8,0xF7,0xF6,0xF5});
  else bytes(t,{0xF4,0xF3,0xF2,0xF1,7,0,1,0,angle,distance,1,speed,snr,0xF8,0xF7,0xF6,0xF5});
}
uint16_t digits(int number){
  const uint8_t patterns[]={0x3F,0x06,0x5B,0x4F,0x66,0x6D,0x7D,0x07,0x7F,0x6F};
  return (uint16_t(patterns[number/10])<<8)|patterns[number%10];
}
int main(){
  Serial.connected=false; begin(0);update(1000);assert(last==0);
  report(1100,12);assert(last==0);report(1200,13);assert(last==digits(8));
  report(1300,14);assert(last==digits(9));report(1400,22);assert(last==digits(14));
  report(1500,3);assert(last==0);update(1800);assert(last==digits(14));
  // No one-second gap: a new report at the old deadline starts immediately.
  report(3100,22);report(3200,18);assert(last==digits(11));
  report(3300,3);assert(last==digits(11));update(5200);assert(last==0);
  update(10000);assert(last==0); // Never repeat an old measurement.
  report(10001,14);assert(last==digits(9));
  std::puts("PASS: single report, inclusive threshold, nearest-mph rounding, peak hold, immediate next window and no stale replay.");
  begin(11000);
  bytes(11100,{0xF4,0xF3,0xF2,0xF1,12,0,2,0,0x80,2,1,3,255,0x80,6,0,22,255,0xF8,0xF7,0xF6,0xF5});
  assert(last==digits(14));report(11200,4);assert(last==digits(14));
  begin(12000);report(12001,18,1,0,0xFF);assert(last==digits(11));
  begin(13000);report(13001,255);assert(last==digits(99));
  begin(14000);
  bytes(14001,{0xF4,0xF3,0xF2,0xF1,7,0,1,0,0x80,13,1,22,255,0,0xF7,0xF6,0xF5});assert(last==0);
  std::puts("PASS: slow near target cannot hide faster far target; per-target quality gates removed; 99 saturation; malformed reports still rejected.");
  Serial.connected=true;command('b',15000);report(15001,22);assert(last==0);
  assert(Serial.logs.find("[SIGN SKIP] manual hold")!=std::string::npos);
  command('c',15100);report(15101,18);assert(last==digits(11));
  command('a',16000);report(16001,3);assert(last==0);report(16002,4);assert(last==digits(2));
  begin(17000);report(17001,4);assert(last==0);report(17002,13);assert(last==digits(8));
  assert(bits==0&&!pins[47]&&!pins[48]);
  std::puts("PASS: manual pause explains skipped alerts; c resumes; easy mode stays opt-in; reboot normal; 16 clock edges per latch.");
  auto enter=[](const char *text,uint32_t t){for(;*text;++text)command(*text,t++);};
  auto liveCount=[](uint32_t t){Serial.logs.clear();command('s',t);auto p=Serial.logs.find("valid_reports=");assert(p!=std::string::npos);return std::stoul(Serial.logs.substr(p+14));};
  const auto beforeSimulation=liveCount(20000);
  enter("t12\n",21000);assert(last==0);report(21100,80);assert(last==0);
  enter("t13\n",22000);assert(last==digits(8));
  report(22100,80);assert(last==digits(8));update(22303);assert(last==0);
  update(22603);assert(last==digits(8));update(24003);assert(last==0);
  enter("t14\r\n",25000);assert(last==digits(9));
  enter("t18\n",26000);assert(last==digits(11));
  enter("t22\n",27000);assert(last==digits(14));
  enter("t0\n",28000);assert(last==0);
  assert(liveCount(28010)==beforeSimulation+2); // Only the two real reports counted.
  assert(Serial.logs.find("mode=simulation")!=std::string::npos);
  assert(Serial.logs.find("simulated_reports=6")!=std::string::npos);
  enter("t-12\n",29000);assert(last==0);
  enter("t8.5\n",29100);assert(last==0);
  enter("t999\n",29200);assert(last==0);
  enter("t121\n",29300);assert(last==0);
  enter("t120\n",29400);assert(last==digits(75));
  command('b',29500);assert(last==0);report(29501,80);assert(last==0);
  command('c',29600);report(29601,18);assert(last==digits(11));
  // A synthetic packet cannot consume bytes from a partly received UART report.
  const uint8_t partial[]={0xF4,0xF3,0xF2,0xF1,7,0,1,1,0x80,10,1,22,100,0xF8,0xF7,0xF6,0xF5};
  for(unsigned i=0;i<8;++i)CheckIt::RadarDisplayAddon::observeByte(partial[i],30000);
  enter("t14\n",30001);assert(last==digits(9));
  for(unsigned i=8;i<sizeof(partial);++i)CheckIt::RadarDisplayAddon::observeByte(partial[i],30010);
  update(30010);assert(last==digits(9));
  command('c',30100);report(30101,22);assert(last==digits(14));
  enter("t18\n",31000);begin(32000);report(32001,13);assert(last==digits(8));
  assert(bits==0);
  std::puts("PASS: simulated 12/13/14/18/22/0 km/h, rounding/blink/blank, real traffic isolation, separate counters, invalid input, cancel/resume, partial UART frame preservation and normal reboot.");


  using CheckIt::RadarDisplayAddon::Snapshot;
  using CheckIt::RadarDisplayAddon::snapshot;
  using CheckIt::RadarDisplayAddon::executeCommand;
  Serial.connected=false;
  Snapshot before{}, after{}; snapshot(before,33000);
  for(const char *bad:{"", "t", "t121", "t-1", "t8.5", "n100", "n001", "ccc"})
    assert(!executeCommand(bad,33000));
  assert(!executeCommand(nullptr,33000)); snapshot(after,33000);
  assert(after.simulatedReports==before.simulatedReports);
  assert(executeCommand("t18",33100)); update(33100); assert(last==digits(11));
  snapshot(after,33100); assert(std::string(after.mode)=="simulation");
  assert(after.simulatedReports==before.simulatedReports+1);
  assert(after.stats.validFrames==before.stats.validFrames);
  report(33200,22); snapshot(after,33200);
  assert(after.latestReport.targets[0].speedKmh==22 && last==digits(11));
  assert(after.reportAgeMs==0 && after.hasDetection);
  assert(executeCommand("b",33300)); update(33300);assert(last==0);
  assert(executeCommand("n42",33400));update(33400);assert(last==digits(42));
  assert(executeCommand("c",33500));report(33501,18);assert(last==digits(11));
  for(unsigned i=0;i<70;++i)report(34000+i*10,0);
  snapshot(after,35000);assert(after.rawCount==64 && after.eventCount==32);
  for(unsigned i=1;i<after.eventCount;++i)assert(after.events[i].sequence>after.events[i-1].sequence);
  assert(after.latestReport.targetCount==0 && after.lastDetection.targets[0].speedKmh==18);
  snapshot(after,40000);assert(after.reportAgeMs==5310);
  std::puts("PASS: phone command validation, USB-independent controls, live/simulation isolation, history and bounded rings.");

  static unsigned calls=0;
  CheckIt::RadarDisplayAddon::onLiveReport([](const CheckIt::Ld2451Frame &,uint32_t){++calls;});
  CheckIt::RadarDisplayAddon::configureLimit(20);
  assert(executeCommand("t18",41000));::update(41000);assert(last==0&&calls==0);
  assert(executeCommand("t22",41100));::update(41100);assert(last==digits(14)&&calls==0);
  executeCommand("c",41200);report(41201,18);assert(last==0&&calls==1);
  report(41202,20);assert(last==digits(12)&&calls==2);
  CheckIt::RadarDisplayAddon::configureLimit(0);
  std::puts("PASS: app threshold applies inclusively; cloud hook receives real frames only, never simulations.");
  CheckIt::RadarDisplayAddon::configureLimit(240);
  executeCommand("c",42000); executeCommand("a",42001);
  report(42002,3); assert(last==0);
  report(42003,4); assert(last==digits(2));
  snapshot(after,42003); assert(std::string(after.mode)=="easy_test");
  std::puts("PASS: easy mode overrides a 240 km/h app limit; 3 stays blank, 4 flashes 02.");
  snapshot(after,43000); auto total=after.overLimitTotal;
  executeCommand("c",43000); CheckIt::RadarDisplayAddon::configureLimit(13);
  report(43001,64); snapshot(after,43001);
  assert(after.overLimitTotal==total+1);
  assert(std::string(after.overLimit[after.overLimitCount-1].text).find("FLASH requested")!=std::string::npos);
  executeCommand("b",43002); report(43003,64); snapshot(after,43003);
  assert(std::string(after.overLimit[after.overLimitCount-1].text).find("SKIPPED manual hold")!=std::string::npos);
  total=after.overLimitTotal; executeCommand("t64",43004); snapshot(after,43004); assert(after.overLimitTotal==total);
  report(43005,64); snapshot(after,43005);
  assert(std::string(after.overLimit[after.overLimitCount-1].text).find("SKIPPED simulation")!=std::string::npos);
  total=after.overLimitTotal;
  for(unsigned i=0;i<150;++i)report(44000+i,0);
  snapshot(after,45000);assert(after.overLimitTotal==total);
  for(unsigned i=0;i<150;++i)report(46000+i,64);
  snapshot(after,47000);assert(after.overLimitCount==128&&after.overLimitTotal==total+150);
  for(unsigned i=1;i<after.overLimitCount;++i)assert(after.overLimit[i].sequence==after.overLimit[i-1].sequence+1);
  std::puts("PASS: over-limit history survives empty reports, excludes simulations, records pause reasons and retains latest 128 in order.");
  for(unsigned speed=1;speed<=120;++speed){
    const uint32_t t=100000+speed*10000;
    CheckIt::RadarDisplayAddon::configureLimit(13);
    executeCommand("c",t);report(t+1,speed);
    assert(last==(speed>=13?digits(CheckIt::SpeedDisplayState::mph(speed)):0));
    CheckIt::RadarDisplayAddon::configureLimit(240);
    executeCommand("a",t+3000);report(t+3001,speed);
    assert(last==(speed>3?digits(CheckIt::SpeedDisplayState::mph(speed)):0));
  }
  std::puts("PASS: speeds 1-120 km/h match normal/easy thresholds and identical mph encoding.");
  CheckIt::RadarDisplayAddon::configureLimit(13);executeCommand("c",2000000);now=2000001;
  const uint8_t fast[]={0xF4,0xF3,0xF2,0xF1,7,0,1,0,0x80,10,1,64,100,0xF8,0xF7,0xF6,0xF5};
  for(auto b:fast)CheckIt::RadarDisplayAddon::observeByte(b,now);
  snapshot(after,now);assert(after.flashing&&last==digits(40));
  ::update(2002501);assert(last==0);
  // Cloud observers must see the already-written digits.
  CheckIt::RadarDisplayAddon::onLiveReport([](const CheckIt::Ld2451Frame &,uint32_t){
    assert(last==digits(40));
  });
  report(2003000,64);
  CheckIt::RadarDisplayAddon::onLiveReport(nullptr);
  // Unsigned timer arithmetic must work across millis() rollover.
  begin(0xFFFFFF00u); report(0xFFFFFF01u,64);
  update(uint32_t(0xFFFFFF01u+300u)); assert(last==0);
  update(uint32_t(0xFFFFFF01u+600u)); assert(last==digits(40));
  update(uint32_t(0xFFFFFF01u+2000u)); assert(last==0);
  std::puts("PASS: first digits are latched before update, even with a subsequent 2.5-second main-loop delay.");
  // Live flash history records committed writes, not synthetic/manual tests.
  CheckIt::RadarDisplayAddon::configureLimit(13);
  begin(3000000);report(3000001,12);snapshot(after,now);assert(after.liveFlashes==0);
  report(3000002,18);snapshot(after,now);assert(after.liveFlashes==1&&after.lastFlashMph==11);
  report(3000100,64);snapshot(after,now);assert(after.liveFlashes==1&&after.lastFlashMph==40);
  update(3002002);snapshot(after,now);assert(!after.flashing&&after.liveFlashes==1&&after.lastFlashMph==40);
  executeCommand("t22",now);snapshot(after,now);assert(after.liveFlashes==1&&after.lastFlashMph==40);
  executeCommand("c",now);report(3003000,13);snapshot(after,now);assert(after.liveFlashes==2&&after.lastFlashMph==8);
  std::puts("PASS: live flash count/last peak survive blanking; simulations excluded; next alert increments.");
}
