#include <Arduino.h>
#include <cassert>
#include <cstring>
#include "RadarDisplayAddon.h"
FakeSerial Serial;
uint32_t millis(){return 1000;}
void pinMode(int,int){assert(false && "Roadside firmware must not configure display pins");}
void digitalWrite(int,int){assert(false && "Roadside firmware must not drive display pins");}
void delayMicroseconds(unsigned int){assert(false && "Roadside firmware must not clock a display");}
unsigned reports=0, commands=0;
void report(const CheckIt::Ld2451Frame &,uint32_t){++reports;}
bool control(char c){if(c=='u'){++commands;return true;}return false;}
int main(){
 using namespace CheckIt::RadarDisplayAddon;
 begin();onLiveReport(report);onSerialCommand(control);
 const uint8_t empty[]={0xF4,0xF3,0xF2,0xF1,0,0,0xF8,0xF7,0xF6,0xF5};
 const uint8_t fast[]={0xF4,0xF3,0xF2,0xF1,7,0,1,0,0x80,13,1,64,255,0xF8,0xF7,0xF6,0xF5};
 for(auto b:empty)observeByte(b,100);
 for(auto b:fast)observeByte(b,200);
 for(const char *c:{"a","c","b","8","n42","t64"})assert(!executeCommand(c,300));
 for(char c:std::string("acb86n42\nt64\nu")){Serial.pending=c;update(300);}
 update(10000);
 Snapshot s{};snapshot(s,10000);
 assert(std::strcmp(s.mode,"roadside_observation")==0);
 assert(s.stats.validFrames==2 && s.stats.emptyFrames==1 && reports==2 && commands==1);
 assert(s.lastDetection.targets[0].speedKmh==64 && s.hasDetection);
 assert(s.displayWrites==0 && s.liveFlashes==0 && !s.flashing && s.simulatedReports==0);
 assert(s.overLimitCount==0 && s.left==-1 && s.right==-1);
 assert(executeCommand("r",10000) && rawOutputEnabled());
 assert(executeCommand("e",10000));
 std::puts("PASS: roadside radar decodes live reports and preserves cloud hooks, with no display GPIO access, simulation, or flash commands.");
}
