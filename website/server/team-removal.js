const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body) > 2048) throw Object.assign(new Error('Request too large.'), { status: 413 });
    return JSON.parse(req.body);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > 2048) throw Object.assign(new Error('Request too large.'), { status: 413 });
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

// Both deployments use the same protocol. The database rechecks the actor's
// current authority at both stages; neither target nor actor claims are trusted.
export function createTeamRemovalHandler(callSupabase) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
    const token = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1];
    if (!token) return res.status(401).json({ error: 'Sign in before removing a member.' });
    let started = false;
    try {
      const body = await readBody(req);
      const memberId = typeof body?.memberId === 'string' ? body.memberId.toLowerCase() : '';
      if (!UUID.test(memberId)) return res.status(400).json({ error: 'Choose a valid member to remove.' });
      const user = await callSupabase('/auth/v1/user', { token });
      if (!UUID.test(user?.id || '')) return res.status(401).json({ error: 'Your session could not be verified.' });
      const prepared = await callSupabase('/rest/v1/rpc/prepare_team_account_removal', {
        method: 'POST', token, body: { target_profile_id: memberId },
      });
      if (prepared?.target_id !== memberId || !Array.isArray(prepared.personal_objects)) {
        throw new Error('Account removal could not be prepared.');
      }
      started = true;
      // Storage API deletion removes the physical files. SQL deletion would orphan them.
      for (let index = 0; index < prepared.personal_objects.length; index += 100) {
        const objects = prepared.personal_objects.slice(index, index + 100);
        if (objects.some(file => file.bucket_id !== 'profile-photos' || typeof file.name !== 'string')) {
          throw new Error('Unexpected personal files. Contact CheckIt support.');
        }
        await callSupabase('/storage/v1/object/profile-photos', {
          method: 'DELETE', body: { prefixes: objects.map(file => file.name) },
        });
      }
      const removed = await callSupabase('/rest/v1/rpc/finish_team_account_removal', {
        method: 'POST', body: { actor_profile_id: user.id, target_profile_id: memberId },
      });
      if (removed !== true) throw new Error('Removal could not be confirmed.');
      return res.status(200).json({ ok: true, removed: true, memberId: memberId });
    } catch (error) {
      const status = error instanceof SyntaxError ? 400 : [400, 401, 403, 404, 409, 413, 429, 503].includes(error?.status) ? error.status : 500;
      return res.status(status).json({
        error: started ? 'Could not remove user. Try again.'
          : error instanceof SyntaxError ? 'Send a valid JSON request.' : error.message || 'Account removal failed.',
        ...(started ? { retryable: true } : {}),
      });
    }
  };
}
