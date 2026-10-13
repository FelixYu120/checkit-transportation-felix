#include <unity.h>
#include <string.h>
#include <string>
#include "LogisticsSetupProtocol.h"
using namespace CheckIt;
void setUp(){} void tearDown(){}
bool parse(const char *s,SetupCommand &c){return parseSetupCommand(s,strlen(s),c);}
void app_contract(){
 SetupCommand c{};
 const char *commands[]={"SET device_name=Road Radar","SET sensor_id=radar_5050","SET wifi_ssid=Phone","SET wifi_password=","SET supabase_url=https://example.supabase.co","SET supabase_key=sb_publishable_example","SET speed_limit_kmh=13","SET danger_speed_kmh=25","SET emergency_speed_kmh=35","SET latitude=-32.1234","SET longitude=117.12","SET radar_heading_deg=359.99"};
 for(int i=0;i<SETUP_FIELD_COUNT;++i){TEST_ASSERT_TRUE(parse(commands[i],c));TEST_ASSERT_EQUAL(i,c.field);TEST_ASSERT_FALSE(c.commit);}
 TEST_ASSERT_TRUE(parse("COMMIT",c));TEST_ASSERT_TRUE(c.commit);
}
void invalid_input(){
 SetupCommand c{};const char *bad[]={"SET admin_reset_token=secret","SET sensor_id=with space","SET device_name= bad","SET wifi_ssid=","SET speed_limit_kmh=0","SET speed_limit_kmh=241","SET speed_limit_kmh=13.5","SET latitude=nan","SET latitude=91","SET longitude=-181","SET radar_heading_deg=360","SET supabase_url=http://example.com","SET supabase_key=sb_secret_bad","SET wifi_password=a\nCOMMIT","COMMIT\n","SET latitude=1garbage"};
 for(auto s:bad)TEST_ASSERT_FALSE_MESSAGE(parse(s,c),s);
 const char embedded[]="SET sensor_id=ok\0bad";TEST_ASSERT_FALSE(parseSetupCommand(embedded,sizeof(embedded)-1,c));
 TEST_ASSERT_FALSE(parseSetupCommand(nullptr,0,c));
}
void byte_limits(){
 SetupCommand c{};std::string s="SET device_name="+std::string(31,'x');TEST_ASSERT_TRUE(parse(s.c_str(),c));s+='x';TEST_ASSERT_FALSE(parse(s.c_str(),c));
 s="SET wifi_ssid="+std::string(32,'x');TEST_ASSERT_TRUE(parse(s.c_str(),c));s+='x';TEST_ASSERT_FALSE(parse(s.c_str(),c));
 s="SET wifi_password="+std::string(64,'x');TEST_ASSERT_TRUE(parse(s.c_str(),c));s+='x';TEST_ASSERT_FALSE(parse(s.c_str(),c));
}
int main(){UNITY_BEGIN();RUN_TEST(app_contract);RUN_TEST(invalid_input);RUN_TEST(byte_limits);return UNITY_END();}
