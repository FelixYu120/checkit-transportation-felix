import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEmailConfiguration} from '../scripts/configure-email-links.mjs';
const base = {site_url:'https://platform.example',uri_allow_list:'https://platform.example/create-account',disable_signup:true,mailer_otp_exp:900};
for (const name of ['invite','magic_link','recovery']) base[`mailer_templates_${name}_content`] = '<h2>Existing title</h2><a href="{{ .ConfirmationURL }}">Existing button</a>';
test('email setup changes destinations without changing wording or losing legacy links', () => {
  const update=buildEmailConfiguration(base);
  for (const name of ['invite','magic_link','recovery']) {
    const html=update[`mailer_templates_${name}_content`];
    assert.ok(html.includes('Existing title') && html.includes('Existing button'));
    assert.ok(html.includes('{{ else }}{{ .ConfirmationURL }}{{ end }}'));
    assert.ok(html.includes('#token_hash={{ .TokenHash }}&amp;type='));
    assert.ok(html.includes(name==='recovery'?'/reset-password':'/signup'));
  }
  assert.equal(update.disable_signup,true);
  assert.equal(update.mailer_otp_exp,900);
  assert.equal(update.uri_allow_list.split(',').length,3);
});
test('email configuration is idempotent',()=>{
  const once=buildEmailConfiguration(base);
  assert.deepEqual(buildEmailConfiguration({...base,...once}),once);
});
test('unrecognized custom templates stop for review instead of being overwritten',()=>{
  assert.throws(()=>buildEmailConfiguration({...base,mailer_templates_invite_content:'Custom content'}),/needs review/);
});
