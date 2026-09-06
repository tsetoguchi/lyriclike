import { randomHex } from '../../../_shared.js';

export async function onRequestGet({ request, env }) {
  const state = randomHex(16);

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.OAUTH_REDIRECT_URL,
    response_type: 'code',
    scope: 'openid email profile',
    state,
  });

  const headers = new Headers({
    Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
  });
  headers.append('Set-Cookie',
    `oauth_state=${state}; HttpOnly; SameSite=Lax; Max-Age=600; Path=/`
  );

  return new Response(null, { status: 302, headers });
}
