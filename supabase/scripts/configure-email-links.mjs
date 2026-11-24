import {pathToFileURL} from 'node:url';

// Authentication email links always enter our confirmation page; GET never exchanges a token.
const marker = '<!-- checkit-email-flow-v3 -->';
const oldMarker = '<!-- checkit-email-flow-v2 -->';
function upgradeTemplate(content, target, type) {
  if (content?.includes(marker)) return content;
  let original = String(content || '');
  if (original.includes(oldMarker)) {
    const previous = `{{ if eq .RedirectTo "${target}" }}${target}#token_hash={{ .TokenHash }}&amp;type=${type}{{ else }}{{ .ConfirmationURL }}{{ end }}`;
    if (!original.includes(previous)) throw new Error('Email template needs review: previous callback branch differs.');
    original = original.replaceAll(previous, '{{ .ConfirmationURL }}').replace(oldMarker, '').trimStart();
  }
  let changed = false;
  const next = original.replace(/(href=["']){{\s*\.ConfirmationURL\s*}}(["'])/g, (_match, before, after) => {
    changed = true;
    return `${before}${target}#token_hash={{ .TokenHash }}&amp;type=${type}${after}`;
  });
  if (!changed) throw new Error('Email template needs review: standard confirmation link not found.');
  return marker + '\n' + next;
}

export function buildEmailConfiguration(config) {
  const signup = new URL('/signup', config.site_url).href;
  const reset = new URL('/reset-password', config.site_url).href;
  const signupAliases = ['/signup','/create-account'].map(path => new URL(path,config.site_url).href);
  const resetAliases = ['/reset-password','/set-password'].map(path => new URL(path,config.site_url).href);
  const allowed = new Set(String(config.uri_allow_list || '').split(',').map(value => value.trim()).filter(Boolean));
  for (const path of [...signupAliases,...resetAliases]) allowed.add(path);
  return {
    disable_signup: true,
    mailer_otp_exp: 900,
    uri_allow_list: [...allowed].join(','),
    mailer_templates_invite_content: upgradeTemplate(config.mailer_templates_invite_content, signup, 'invite'),
    mailer_templates_magic_link_content: upgradeTemplate(config.mailer_templates_magic_link_content, signup, 'magiclink'),
    mailer_templates_recovery_content: upgradeTemplate(config.mailer_templates_recovery_content, reset, 'recovery'),
  };
}

export async function configureEmailLinks({projectRef, token, apply = false}) {
  if (!projectRef || !token) throw new Error('Project reference and Supabase access token are required.');
  const url = `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/config/auth`;
  const headers = {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'};
  async function call(options = {}) {
    const response = await fetch(url, {...options, headers, signal: AbortSignal.timeout(30000)});
    if (!response.ok) throw new Error(`Auth configuration HTTP ${response.status}`);
    return response.json();
  }
  const before = await call();
  const update = buildEmailConfiguration(before);
  const changed = Object.keys(update).filter(key => update[key] !== before[key]);
  if (apply && changed.length) await call({method:'PATCH',body:JSON.stringify(update)});
  if (apply) {
    const after = await call();
    if (Object.keys(update).some(key=>after[key] !== update[key])) throw new Error('Email configuration verification failed.');
  }
  return {project:projectRef, applied:apply, changed_fields:changed, signup_expiry_seconds:900};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const projectRef = process.argv[process.argv.indexOf('--project-ref')+1];
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!process.argv.includes('--project-ref')) throw new Error('Use --project-ref <project>.');
  console.log(JSON.stringify(await configureEmailLinks({projectRef, token, apply:process.argv.includes('--apply')})));
}
