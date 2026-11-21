#pragma once
#include <WiFi.h>
#include <WebServer.h>
#include "Protocol.h"

WebServer web(80);
kmd7::Target pendingTargets[8], liveTargets[8];
uint8_t pendingCount = 0, liveCount = 0;
bool radarConnected = false, haveFrame = false;
uint32_t lastFrameMs = 0, frameCount = 0, detectionFrames = 0;

const char dashboardHtml[] PROGMEM = R"HTML(<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CheckIt · Radar live</title><style>
*{box-sizing:border-box}body{margin:0;background:#091521;color:#edf5fa;font:16px system-ui,sans-serif}main{max-width:1000px;margin:auto;padding:32px 20px}header{display:flex;justify-content:space-between;align-items:center;gap:15px}small,.muted{color:#9db1c4}h1{font-size:clamp(30px,6vw,48px);margin:28px 0 10px}h2{font-size:20px}.tag{border:1px solid #405367;border-radius:30px;padding:8px 14px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:28px 0}.card,section{background:#132435;border:1px solid #2b4055;border-radius:16px;padding:22px}.value{font-size:36px;margin:10px 0;color:#5ce4c4}.status{padding:16px;border-radius:12px;background:#253748;margin-top:20px}.good{background:#13453d}.bad{background:#59382c}table{width:100%;border-collapse:collapse;text-align:left}td,th{padding:14px 8px;border-bottom:1px solid #2b4055;white-space:nowrap}th{color:#9db1c4;font-weight:500}.scroll{overflow:auto}footer{margin-top:24px;color:#9db1c4;font-size:14px}@media(max-width:600px){.cards{grid-template-columns:1fr}.card{padding:16px}.value{font-size:30px}header{align-items:flex-start}.tag{font-size:12px}}
</style><main><header><strong>CHECKIT / TRANSPORTATION</strong><span class="tag">K-MD7 · LIVE</span></header>
<h1>Your radar, in real time.</h1><p class="muted">Live readings from the connected RFbeam sensor.</p>
<div id="status" class="status" role="status" aria-live="polite">Connecting to the board…</div>
<div class="cards"><div class="card"><small>Targets now</small><div class="value" id="count">—</div><small>Moving objects tracked</small></div><div class="card"><small>Latest radar reply</small><div class="value" id="age">—</div><small>Age of last complete frame</small></div><div class="card"><small>Frames with detections</small><div class="value" id="detections">—</div><small>Since restart · not unique vehicles</small></div></div>
<section><h2>Live detections</h2><div class="scroll"><table><thead><tr><th>ID</th><th>Speed</th><th>Direction</th><th>Distance</th><th>Angle</th></tr></thead><tbody id="rows"></tbody></table></div><p id="empty" class="muted">Waiting for a radar reply.</p></section>
<footer>Stay connected to CheckIt-KMD7 Wi-Fi. This page works without internet.<br>“Radar responding” confirms serial communication; it does not measure supply voltage.<br>For a walking test, enter w in the USB serial monitor to lower the minimum-speed filter.</footer></main>
<script>
const $=id=>document.getElementById(id);
async function refresh(){try{const r=await fetch('/api/status',{cache:'no-store',signal:AbortSignal.timeout(3000)});if(!r.ok)throw Error();const s=await r.json();$('status').className='status '+(s.online?'good':'bad');$('status').textContent=s.online?(s.targets.length?'Radar responding · movement detected':'Radar responding · no targets detected'):'No recent radar reply · check power and RX/TX wiring';$('count').textContent=s.online?s.targets.length:'—';$('age').textContent=s.age_ms===null?'—':(s.age_ms/1000).toFixed(1)+' s';$('detections').textContent=s.detection_frames;$('rows').replaceChildren();for(const t of s.targets){const tr=document.createElement('tr');for(const v of [t.id,Math.abs(t.speed_kmh*0.621371).toFixed(1)+' mph',t.speed_kmh<0?'Approaching':t.speed_kmh>0?'Receding':'Zero',t.distance_m.toFixed(2)+' m',t.angle_deg.toFixed(1)+'°']){const td=document.createElement('td');td.textContent=v;tr.appendChild(td)}$('rows').appendChild(tr)}$('empty').hidden=s.targets.length>0;$('empty').textContent=s.online?'Radar is replying. No moving targets in the latest frame.':'Waiting for a complete radar frame.';}catch(e){$('status').className='status bad';$('status').textContent='Board connection lost · reconnect to CheckIt-KMD7 Wi-Fi';$('count').textContent='—';$('age').textContent='—';$('rows').replaceChildren();$('empty').hidden=false;$('empty').textContent='Live readings unavailable.'}setTimeout(refresh,500)}refresh();
</script></html>)HTML";

void startDashboard() {
  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(IPAddress(192,168,4,1), IPAddress(192,168,4,1), IPAddress(255,255,255,0));
  bool started = WiFi.softAP("CheckIt-KMD7", "RadarTest7");
  web.on("/", HTTP_GET, [](){ web.send_P(200,"text/html",dashboardHtml); });
  web.on("/api/status", HTTP_GET, [](){
    uint32_t age = millis() - lastFrameMs;
    bool online = radarConnected && haveFrame && age < 2500;
    String json = "{\"online\":";
    json += online ? "true" : "false";
    json += ",\"age_ms\":";
    json += haveFrame ? String(age) : String("null");
    json += ",\"frames\":" + String(frameCount);
    json += ",\"detection_frames\":" + String(detectionFrames);
    json += ",\"targets\":[";
    if (online) for (uint8_t i=0; i<liveCount; ++i) {
      if (i) json += ',';
      const auto& t=liveTargets[i];
      json += "{\"id\":" + String(t.id) + ",\"speed_kmh\":" + String(t.speedKmh,2);
      json += ",\"distance_m\":" + String(t.distanceM,2) + ",\"angle_deg\":" + String(t.angleDeg,2) + "}";
    }
    json += "]}";
    web.sendHeader("Cache-Control","no-store");
    web.send(200,"application/json",json);
  });
  web.begin();
  Serial.println(started ? "[WEB] Wi-Fi: CheckIt-KMD7 | password: RadarTest7 | http://192.168.4.1" : "[WEB ERROR] Wi-Fi AP failed");
}
void serviceWait(uint32_t duration) {
  uint32_t start=millis();
  while (millis()-start<duration) { web.handleClient(); delay(1); }
}
