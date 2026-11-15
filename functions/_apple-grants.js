// The refresh token Apple hands back at sign-in, kept so the grant can be
// revoked when the account is deleted. One per account: a newer sign-in
// replaces it.

import { openGrant, sealRefreshToken } from './_apple.js';

// clientId is the client Apple gave the token to: the app or the website.
export async function saveAppleGrant(env, userId, refreshToken, clientId) {
  await env.lyricalmiracle_db.prepare(
    'INSERT OR REPLACE INTO apple_grants (user_id, refresh_token, created_at) VALUES (?, ?, ?)'
  ).bind(userId, await sealRefreshToken(env, refreshToken, clientId), Date.now()).run();
}

// { refreshToken, clientId } for the account, or null when it holds none.
export async function readAppleGrant(env, userId) {
  const row = await env.lyricalmiracle_db.prepare(
    'SELECT refresh_token FROM apple_grants WHERE user_id = ?'
  ).bind(userId).first();
  return row ? openGrant(env, row.refresh_token) : null;
}
