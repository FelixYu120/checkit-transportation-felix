#pragma once

#include <Arduino.h>

static const char kFlashDashboardHtml[] PROGMEM = R"HTML(
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Check-It Flashing Node</title>
<style>
:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#08111f;color:#eaf2ff}body{margin:0;padding:24px}.wrap{max-width:760px;margin:auto}.hero,.panel{background:#111d30;border:1px solid #294263;border-radius:18px;padding:22px;margin-bottom:16px;box-shadow:0 14px 36px #0006}h1{margin:0 0 8px;font-size:clamp(1.7rem,5vw,2.7rem)}h2{font-size:1.1rem;margin:0 0 14px;color:#9cb7d9}.quiet{color:#9cb0c9;line-height:1.5}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.card{background:#0b1627;border-radius:12px;padding:15px}.label{color:#8da6c5;font-size:.8rem;text-transform:uppercase;letter-spacing:.08em}.value{font-size:1.35rem;font-weight:750;margin-top:6px}.ready{color:#6ee7a8}.waiting{color:#ffd166}button{width:100%;border:0;border-radius:12px;padding:15px;background:#ffbf36;color:#1d1400;font-size:1rem;font-weight:800;cursor:pointer}button:disabled{opacity:.55;cursor:wait}.note{font-size:.9rem;margin-top:14px}
</style></head><body><main class="wrap">
<section class="hero"><h1>Check-It Flashing Node</h1><div class="quiet">Local hardware and ESP-NOW link diagnostics for node 101.</div></section>
<section class="panel"><h2>Node status</h2><div class="grid">
<div class="card"><div class="label">ESP-NOW</div><div id="radio" class="value">--</div></div>
<div class="card"><div class="label">Radar link</div><div id="radar" class="value">--</div></div>
<div class="card"><div class="label">Matrix output</div><div id="output" class="value">--</div></div>
<div class="card"><div class="label">Channel</div><div id="channel" class="value">--</div></div>
</div></section>
<section class="panel"><h2>Standalone matrix test</h2><button id="test" type="button">Flash this node for 6 seconds</button><div class="quiet note">This checks the matrix wiring directly. To test the radio path, connect to the radar dashboard and press <b>Test flashing node</b>.</div></section>
<div id="updated" class="quiet"></div>
</main><script>
const $=id=>document.getElementById(id);
async function refresh(){try{const response=await fetch('/api/status',{cache:'no-store'});if(!response.ok)throw new Error('HTTP '+response.status);const d=await response.json();$('radio').textContent=d.espnow_ready?'READY':'ERROR';$('radio').className='value '+(d.espnow_ready?'ready':'waiting');$('radar').textContent=d.radar_link_active?'CONNECTED':'WAITING';$('radar').className='value '+(d.radar_link_active?'ready':'waiting');$('output').textContent=d.output_active?'FLASHING':'IDLE';$('channel').textContent=d.channel;$('updated').textContent='Updated '+new Date().toLocaleTimeString();}catch(e){$('updated').textContent='Dashboard link error: '+e.message;}}
$('test').addEventListener('click',async()=>{const button=$('test');button.disabled=true;button.textContent='Flashing for 6 seconds...';try{const response=await fetch('/api/test-output',{method:'POST'});if(!response.ok)throw new Error('HTTP '+response.status);}catch(e){button.textContent='Test failed';}setTimeout(()=>{button.disabled=false;button.textContent='Flash this node for 6 seconds';refresh();},6000);});
refresh();setInterval(refresh,1000);
</script></body></html>
)HTML";
