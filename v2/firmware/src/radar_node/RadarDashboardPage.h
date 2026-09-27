#pragma once

#include <Arduino.h>

static const char kRadarDashboardHtml[] PROGMEM = R"HTML(
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Check-It Radar</title>
  <style>
    :root{color-scheme:dark;--bg:#071018;--panel:#0d1b25;--line:#203746;--text:#e8f4f8;--muted:#8da7b4;--cyan:#38d9ff;--green:#42f59e;--amber:#ffca57;--red:#ff5f6d}
    *{box-sizing:border-box} body{margin:0;background:radial-gradient(circle at 50% -20%,#15384a 0,var(--bg) 45%);font:15px/1.45 system-ui,-apple-system,sans-serif;color:var(--text);min-height:100vh}
    main{width:min(1080px,calc(100% - 28px));margin:auto;padding:32px 0 48px} header{display:flex;justify-content:space-between;gap:20px;align-items:center;margin-bottom:22px}
    h1{font-size:clamp(25px,5vw,42px);letter-spacing:-.04em;margin:0} .eyebrow{color:var(--cyan);font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}
    .status{display:flex;align-items:center;gap:9px;padding:10px 14px;border:1px solid var(--line);border-radius:999px;background:#08141dcc;font-weight:750;white-space:nowrap}.dot{width:10px;height:10px;border-radius:50%;background:var(--amber);box-shadow:0 0 16px currentColor}.status.active{color:var(--green)}.status.active .dot{background:var(--green);animation:pulse 1.5s infinite}.status.offline{color:var(--red)}.status.offline .dot{background:var(--red)}
    @keyframes pulse{50%{opacity:.35;transform:scale(.8)}} .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.card,.panel{background:linear-gradient(150deg,#112532dd,#091720ee);border:1px solid var(--line);border-radius:18px;box-shadow:0 18px 50px #0005}
    .card{padding:17px}.label{color:var(--muted);font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}.value{font-size:clamp(25px,4vw,39px);font-weight:800;margin-top:5px;letter-spacing:-.04em}.unit{font-size:13px;color:var(--muted);letter-spacing:0}.panel{margin-top:12px;padding:18px;overflow:hidden}.panel-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.panel h2{font-size:17px;margin:0}.quiet{color:var(--muted)}
    table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:12px 10px;border-bottom:1px solid var(--line)}th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.08em}tr:last-child td{border:0}.direction{display:inline-block;border-radius:999px;padding:4px 9px;background:#173141;color:var(--cyan);font-size:12px;font-weight:800}.empty{text-align:center;padding:45px 12px;color:var(--muted)}
    .panel-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end}button{appearance:none;border:1px solid var(--cyan);border-radius:999px;background:#102a38;color:var(--text);font:inherit;font-weight:750;padding:8px 13px;cursor:pointer}button:disabled{cursor:wait;opacity:.6}
    footer{display:flex;justify-content:space-between;gap:16px;color:var(--muted);font-size:12px;margin-top:14px;padding:0 4px}@media(max-width:760px){header{align-items:flex-start;flex-direction:column}.grid{grid-template-columns:repeat(2,1fr)}.panel{overflow-x:auto}table{min-width:660px}}@media(max-width:420px){.grid{grid-template-columns:1fr 1fr}.card{padding:14px}}
  </style>
</head>
<body>
<main>
  <header><div><div class="eyebrow">Check-It Transportation V2</div><h1>LD2451 Radar</h1></div><div id="status" class="status"><span class="dot"></span><span>CONNECTING</span></div></header>
  <section class="grid">
    <div class="card"><div class="label">Active targets</div><div id="targets" class="value">--</div></div>
    <div class="card"><div class="label">Frames received</div><div id="frames" class="value">--</div></div>
    <div class="card"><div class="label">Last frame</div><div id="age" class="value">-- <span class="unit">ms</span></div></div>
    <div class="card"><div class="label">Radar alarm</div><div id="alarm" class="value">--</div></div>
  </section>
  <section class="panel">
    <div class="panel-head"><h2>Live targets</h2><span id="summary" class="quiet">Waiting for data</span></div>
    <div id="targetArea" class="empty">Connecting to radar node...</div>
  </section>
  <section class="panel">
    <div class="panel-head"><h2>Anonymous traffic tracks</h2><span class="quiet">Accepted paths only become official counts</span></div>
    <div class="grid">
      <div class="card"><div class="label">Active tracks</div><div id="trackActive" class="value">--</div></div>
      <div class="card"><div class="label">Motor vehicles</div><div id="trackCars" class="value">--</div></div>
      <div class="card"><div class="label">Micromobility</div><div id="trackMicro" class="value">--</div></div>
      <div class="card"><div class="label">Slow returns excluded</div><div id="slowExcluded" class="value">--</div></div>
      <div class="card"><div class="label">Weak extreme-speed rejected</div><div id="extremeRejected" class="value">--</div></div>
      <div class="card"><div class="label">Target-capacity frames</div><div id="capacityFrames" class="value">--</div></div>
      <div class="card"><div class="label">Unclassified paths</div><div id="trackUnknown" class="value">--</div></div>
    </div>
  </section>
  <section class="panel">
    <div class="panel-head"><h2>Link diagnostics</h2><div class="panel-actions"><span id="firmware" class="quiet"></span><button id="testOutput" type="button">Test local matrix</button><button id="testRemoteOutput" type="button">Test flashing node</button><button id="resetProvisioning" type="button">Reopen BLE setup</button></div></div>
    <div class="grid">
      <div class="card"><div class="label">UART bytes</div><div id="bytes" class="value">--</div></div>
      <div class="card"><div class="label">Valid frames</div><div id="valid" class="value">--</div></div>
      <div class="card"><div class="label">Frame errors</div><div id="errors" class="value">--</div></div>
      <div class="card"><div class="label">Local warning</div><div id="warning" class="value">--</div></div>
      <div class="card"><div class="label">Provisioning</div><div id="provisioning" class="value">--</div></div>
      <div class="card"><div class="label">BLE setup</div><div id="bleSetup" class="value">--</div></div>
      <div class="card"><div class="label">Speed limit</div><div id="speedLimit" class="value">--</div></div>
      <div class="card"><div class="label">Health reports</div><div id="healthReports" class="value">--</div></div>
    </div>
  </section>
  <section class="panel">
    <div class="panel-head"><h2>Supabase upload</h2><div class="panel-actions"><span id="cloudSummary" class="quiet">Not configured</span><button id="uploadNow" type="button">Send collected data now</button></div></div>
    <div class="grid">
      <div class="card"><div class="label">Internet Wi-Fi</div><div id="internet" class="value">--</div></div>
      <div class="card"><div class="label">Last HTTP</div><div id="cloudHttp" class="value">--</div></div>
      <div class="card"><div class="label">Passages uploaded</div><div id="cloudUploaded" class="value">--</div></div>
      <div class="card"><div class="label">Pending passages</div><div id="cloudQueue" class="value">--</div></div>
      <div class="card"><div class="label">Durable storage</div><div id="storageStatus" class="value">--</div></div>
      <div class="card"><div class="label">Storage free</div><div id="storageFree" class="value">--</div></div>
      <div class="card"><div class="label">Low-SNR filtered</div><div id="lowSnrFiltered" class="value">--</div></div>
      <div class="card"><div class="label">Storage errors</div><div id="storageErrors" class="value">--</div></div>
    </div>
  </section>
  <footer><span id="network">CheckIt-Radar</span><span id="updated">Not updated</span></footer>
</main>
<script>
const $=id=>document.getElementById(id);
function duration(ms){if(ms<=0)return 'due now';const minutes=Math.ceil(ms/60000);return minutes>=60?`${Math.ceil(minutes/60)} hr`:`${minutes} min`;}
function targetTable(items){
  if(!items.length)return '<div class="empty">Radar link is active. No moving targets are currently reported.</div>';
  const rows=items.map(t=>`<tr><td>${t.index}</td><td><span class="direction">${t.direction}</span></td><td>${t.angle_deg}&deg;</td><td>${t.distance_m} m</td><td><b>${t.speed_kmh} km/h</b></td><td>${t.snr}</td></tr>`).join('');
  return `<table><thead><tr><th>ID</th><th>Direction</th><th>Angle</th><th>Distance</th><th>Speed</th><th>SNR</th></tr></thead><tbody>${rows}</tbody></table>`;
}
async function refresh(){
  try{
    const response=await fetch('/api/status',{cache:'no-store'});if(!response.ok)throw new Error('HTTP '+response.status);
    const d=await response.json();
    $('status').className='status '+(d.radar_active?'active':'offline');$('status').lastElementChild.textContent=d.radar_active?'RADAR ACTIVE':'RADAR WAITING';
    $('targets').textContent=d.target_count;$('frames').textContent=d.frame_count.toLocaleString();$('age').innerHTML=d.has_frame?`${d.last_frame_age_ms} <span class="unit">ms</span>`:'--';$('alarm').textContent=d.alarm?'ON':'OFF';
    $('bytes').textContent=d.parser.bytes_seen.toLocaleString();$('valid').textContent=d.parser.valid_frames.toLocaleString();$('errors').textContent=(d.parser.invalid_lengths+d.parser.invalid_payloads+d.parser.invalid_trailers).toLocaleString();$('warning').textContent=d.local_warning_active?'ACTIVE':'IDLE';$('provisioning').textContent=d.provisioning.provisioned?'LOCKED':'REQUIRED';$('bleSetup').textContent=d.provisioning.ble_active?'ADVERTISING':'OFF';$('speedLimit').innerHTML=`${d.provisioning.speed_limit_kmh} <span class="unit">km/h</span>`;$('healthReports').textContent=d.cloud.uploaded_health_reports.toLocaleString();
    $('trackActive').textContent=d.tracking.active;$('trackCars').textContent=d.tracking.motor_vehicle.toLocaleString();$('trackMicro').textContent=d.tracking.micromobility.toLocaleString();$('slowExcluded').textContent=d.tracking.slow_returns_excluded.toLocaleString();$('extremeRejected').textContent=d.tracking.weak_extreme_speed_filtered.toLocaleString();$('capacityFrames').textContent=d.tracking.target_capacity_frames.toLocaleString();$('trackUnknown').textContent=d.tracking.unknown.toLocaleString();
    $('internet').textContent=d.internet_wifi_connected?'ONLINE':'OFFLINE';$('cloudHttp').textContent=d.cloud.last_http_status||'--';$('cloudUploaded').textContent=d.cloud.uploaded_passages.toLocaleString();$('cloudQueue').textContent=d.cloud.pending_passages;$('storageStatus').textContent=d.cloud.storage_ready?'SAFE':'FAULT';$('storageFree').textContent=(d.cloud.storage_free_bytes/1048576).toFixed(1)+' MB';$('lowSnrFiltered').textContent=d.tracking.low_snr_filtered.toLocaleString();$('storageErrors').textContent=(d.cloud.persist_failures+d.cloud.corrupt_passages).toLocaleString();$('uploadNow').disabled=!d.cloud.enabled;$('cloudSummary').textContent=!d.cloud.storage_ready?'Storage unavailable':!d.cloud.enabled?`${d.cloud.queue_depth} tracks stored locally; add CheckItSecrets.h`:`${d.cloud.queue_depth} durable tracks queued | next hourly send ${duration(d.cloud.next_automatic_upload_ms)}${d.cloud.retry_pending?' | retrying':''}`;
    $('firmware').textContent='Firmware '+d.firmware_version;$('network').textContent=d.ap_ssid+'  |  '+d.ap_ip;$('summary').textContent=d.target_count?`${d.target_count} target${d.target_count===1?'':'s'} in latest frame`:'Live UART heartbeat';$('targetArea').className='';$('targetArea').innerHTML=targetTable(d.targets);$('updated').textContent='Updated '+new Date().toLocaleTimeString();
  }catch(e){$('status').className='status offline';$('status').lastElementChild.textContent='WEB LINK LOST';$('targetArea').className='empty';$('targetArea').textContent=e.message;}
}
$('testOutput').addEventListener('click',async()=>{
  const button=$('testOutput');button.disabled=true;button.textContent='Flashing for 6 seconds...';
  try{const response=await fetch('/api/test-output',{method:'POST'});if(!response.ok)throw new Error('HTTP '+response.status);}
  catch(e){button.textContent='Test failed';}
  setTimeout(()=>{button.disabled=false;button.textContent='Test local matrix';},6000);
});
$('testRemoteOutput').addEventListener('click',async()=>{
  const button=$('testRemoteOutput');button.disabled=true;button.textContent='Sending radio test...';
  try{const response=await fetch('/api/test-remote-output',{method:'POST'});if(!response.ok)throw new Error('HTTP '+response.status);button.textContent='Flashing for 6 seconds...';}
  catch(e){button.textContent='Remote test failed';}
  setTimeout(()=>{button.disabled=false;button.textContent='Test flashing node';},6000);
});
$('uploadNow').addEventListener('click',async()=>{
  const button=$('uploadNow');button.disabled=true;button.textContent='Upload requested...';
  try{const response=await fetch('/api/upload-now',{method:'POST'});if(!response.ok)throw new Error('HTTP '+response.status);button.textContent='Request accepted';}
  catch(e){button.textContent='Upload request failed';}
  setTimeout(()=>{button.disabled=false;button.textContent='Send collected data now';refresh();},3000);
});
$('resetProvisioning').addEventListener('click',async()=>{
  const token=prompt('Administrative reset token');if(!token)return;
  if(!confirm('Erase the locked setup and restart BLE provisioning? Stored traffic passages are preserved.'))return;
  const button=$('resetProvisioning');button.disabled=true;button.textContent='Authorizing...';
  try{const response=await fetch('/api/admin/reset-provisioning',{method:'POST',headers:{'X-CheckIt-Admin-Token':token}});if(!response.ok)throw new Error('HTTP '+response.status);button.textContent='Restarting into BLE setup...';}
  catch(e){button.disabled=false;button.textContent='Reset rejected';}
});
refresh();setInterval(refresh,500);
</script>
</body>
</html>
)HTML";
