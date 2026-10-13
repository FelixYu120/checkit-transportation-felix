#include "LogisticsSetupProtocol.h"
#include <string.h>
#include <stdlib.h>
#include <math.h>
namespace CheckIt {
const char *setupFieldName(SetupField field) {
 static const char *keys[]={"device_name","sensor_id","wifi_ssid","wifi_password","supabase_url","supabase_key","speed_limit_kmh","danger_speed_kmh","emergency_speed_kmh","latitude","longitude","radar_heading_deg"};
 return field<SETUP_FIELD_COUNT?keys[field]:"unknown";
}
bool parseSetupCommand(const char *data,size_t size,SetupCommand &out) {
 out={};
 if(!data || size>360 || memchr(data,0,size) || memchr(data,'\r',size) || memchr(data,'\n',size))return false;
 if(size==6 && memcmp(data,"COMMIT",6)==0){out.commit=true;return true;}
 if(size<6 || memcmp(data,"SET ",4))return false;
 const char *eq=static_cast<const char*>(memchr(data+4,'=',size-4));if(!eq)return false;
 int index=-1;
 for(int i=0;i<SETUP_FIELD_COUNT;++i)if(size_t(eq-data-4)==strlen(setupFieldName(SetupField(i)))&&!memcmp(data+4,setupFieldName(SetupField(i)),eq-data-4))index=i;
 if(index<0)return false;
 out.field=SetupField(index);size_t n=size-(eq-data)-1;
 const unsigned limits[]={31,47,32,64,159,319,3,3,3,24,24,24};
 if(n>limits[index] || (!n&&index!=WIFI_PASSWORD))return false;
 if(n&&(eq[1]==' '||eq[n]==' '))return false;
 memcpy(out.value,eq+1,n);out.value[n]=0;
 if(index==SENSOR_ID)for(size_t i=0;i<n;++i){char c=out.value[i];if(!((c>='a'&&c<='z')||(c>='A'&&c<='Z')||(c>='0'&&c<='9')||c=='_'||c=='-'))return false;}
 if(index==SUPABASE_URL && (strncmp(out.value,"https://",8)||n<=8))return false;
 if(index==SUPABASE_KEY && strncmp(out.value,"sb_publishable_",15) && strncmp(out.value,"eyJ",3))return false;
 if(index>=SPEED_LIMIT){
  char *end=nullptr;out.number=strtod(out.value,&end);
  if(end==out.value||*end||!isfinite(out.number))return false;
  if(index<=EMERGENCY_SPEED && (out.number<1||out.number>240||floor(out.number)!=out.number))return false;
  if(index==LATITUDE&&(out.number<-90||out.number>90))return false;
  if(index==LONGITUDE&&(out.number<-180||out.number>180))return false;
  if(index==HEADING&&(out.number<0||out.number>=360))return false;
 }
 return true;
}
}
