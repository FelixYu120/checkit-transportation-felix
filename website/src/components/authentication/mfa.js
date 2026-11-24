export async function readMfaStatus(client) {
  const {data,error}=await client.rpc('mfa_access_status');
  if(error) throw error;
  if(!data?.user_id || typeof data.ready!=='boolean' || typeof data.required!=='boolean' || typeof data.verified!=='boolean' || typeof data.enrolled!=='boolean') throw new Error('Account verification unavailable.');
  return data;
}
export const needsMfa = status => status.required && !status.verified;

export async function verifyAuthenticator(client, factorId, code, userId) {
  if(!/^\d{6}$/.test(code)) throw new Error('Enter the 6-digit code.');
  const {error}=await client.auth.mfa.challengeAndVerify({factorId,code});
  if(error) throw error;
  const status=await readMfaStatus(client);
  if(status.user_id!==userId || !status.ready || !status.verified) throw new Error('Authenticator verification could not be confirmed.');
  const confirmed=await client.rpc('confirm_my_mfa_enrollment');
  if(confirmed.error) throw confirmed.error;
  return status;
}
export function qrImage(svg) {
  if(typeof svg!=='string') throw new Error('Authenticator setup unavailable.');
  if(svg.startsWith('data:image/svg+xml')) return svg;
  if(/^<svg[\s>]/.test(svg)) return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  throw new Error('Authenticator setup unavailable.');
}
