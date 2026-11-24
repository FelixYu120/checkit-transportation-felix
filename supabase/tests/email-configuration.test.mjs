import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEmailConfiguration} from '../scripts/configure-email-links.mjs';
const base = {site_url:'https://platform.example',uri_allow_list:'https://platform.example/create-account',disable_signup:true,mailer_otp_exp:900};
for (const name of ['invite','magic_link','recovery']) base[`mailer_templates_${name}_content`] = '<h2>Existing title</h2><a href="{{ .ConfirmationURL }}">Existing button</a>';
test('email setup preserves wording and avoids consuming confirmation URLs', () => {
  const update=buildEmailConfiguration(base);
  for (const name of ['invite','magic_link','recovery']) {
    const html=update[`mailer_templates_${name}_content`];
    assert.ok(html.includes('Existing title') && html.includes('Existing button'));
    assert.equal(html.includes('.ConfirmationURL'),false);
    assert.ok(html.includes('#token_hash={{ .TokenHash }}&amp;type='));
    assert.ok(html.includes(name==='recovery'?'/reset-password':'/signup'));
  }
  assert.equal(update.disable_signup,true);
  assert.equal(update.mailer_otp_exp,900);
  assert.equal(update.uri_allow_list.split(',').length,4);
});
test('email configuration is idempotent',()=>{
  const once=buildEmailConfiguration(base);
  assert.deepEqual(buildEmailConfiguration({...base,...once}),once);
});
test('unrecognized custom templates stop for review instead of being overwritten',()=>{
  assert.throws(()=>buildEmailConfiguration({...base,mailer_templates_invite_content:'Custom content'}),/needs review/);
});


test('legacy signup and reset aliases use the app confirmation page rather than consuming the email link on GET',()=>{
 const update=buildEmailConfiguration(base);
 assert.ok(update.uri_allow_list.includes('https://platform.example/create-account'));
 assert.ok(update.mailer_templates_magic_link_content.includes('https://platform.example/signup#token_hash='));
 assert.ok(update.uri_allow_list.includes('https://platform.example/set-password'));
 assert.ok(update.mailer_templates_recovery_content.includes('https://platform.example/reset-password#token_hash='));
});

test('version two templates upgrade once without changing their email wording',()=>{
 const previous={...base};
 for(const [name,path,type] of [['invite','/signup','invite'],['magic_link','/signup','magiclink'],['recovery','/reset-password','recovery']]) {
  const target='https://platform.example'+path;
  previous[`mailer_templates_${name}_content`]='<!-- checkit-email-flow-v2 -->\n<h2>Existing title</h2><a href="'+`{{ if eq .RedirectTo "${target}" }}${target}#token_hash={{ .TokenHash }}&amp;type=${type}{{ else }}{{ .ConfirmationURL }}{{ end }}`+'">Existing button</a>';
 }
 const update=buildEmailConfiguration(previous);
 assert.ok(update.mailer_templates_invite_content.includes('checkit-email-flow-v3'));
 assert.equal(update.mailer_templates_invite_content.includes('checkit-email-flow-v2'),false);
 assert.deepEqual(buildEmailConfiguration({...previous,...update}),update);
});
