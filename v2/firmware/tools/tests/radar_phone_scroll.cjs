const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const page = fs.readFileSync(path.join(__dirname, '../../lib/RadarPhoneDashboard/RadarPhonePage.h'), 'utf8');
const script = page.split('<script>')[1].split('let limitKmh=0;')[0];
const nodes = new Map();
function node(id) {
  if (!nodes.has(id)) nodes.set(id, { checked: true, textContent: '', scrollTop: 0, scrollHeight: 500,
    clientHeight: 100, handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; } });
  return nodes.get(id);
}
const context = vm.createContext({ document: { getElementById: node }, Blob, URL, setTimeout });
vm.runInContext(script, context);
vm.runInContext("history=[{at:1000,text:'first'}];overHistory=[{at:1000,text:'FLASH requested'}];showEvents()", context);
assert.equal(node('events').scrollTop, 500);
node('events').scrollTop = 80; node('events').handlers.scroll();
assert.equal(node('followEvents').checked, false);
vm.runInContext("history.push({at:2000,text:'second'});showEvents()", context);
assert.equal(node('events').scrollTop, 80);
assert.equal(node('events').textContent, '[1.0s] first');
node('followEvents').checked = true; node('followEvents').handlers.change();
assert.match(node('events').textContent, /second/);
assert.equal(node('events').scrollTop, 500);
node('overEvents').scrollTop = 40; node('overEvents').handlers.scroll();
vm.runInContext("overHistory.push({at:3000,text:'SKIPPED manual hold'});showEvents()", context);
assert.equal(node('overEvents').scrollTop, 40);
assert.doesNotMatch(node('overEvents').textContent, /SKIPPED/);
node('followOver').checked = true; node('followOver').handlers.change();
assert.match(node('overEvents').textContent, /SKIPPED/);
console.log('PASS: both logs freeze while reading older entries; following latest resumes explicitly.');

assert.equal(vm.runInContext("flashSummary({liveFlashes:0})",context),'No live radar flash sent since restart.');
assert.match(vm.runInContext("flashSummary({liveFlashes:2,lastFlashMph:40,lastFlashAge:1200})",context),/2.*40 mph.*1.2s/);
console.log('PASS: last-flash summary survives the blank phase and handles no live alerts.');
