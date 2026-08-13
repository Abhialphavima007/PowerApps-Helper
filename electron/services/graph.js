'use strict';
// Microsoft Graph — OneDrive for Business upload for the signed-in account.
// Uses the same MSAL public client (delegated Files.ReadWrite), so "connecting
// OneDrive" is just a consent on first use; no extra registration.

const auth = require('./auth');

const GRAPH = 'https://graph.microsoft.com/v1.0';
// Graph delegated scopes. The Graph CLI public client (used by auth.getGraphToken)
// is designed to call Graph, so normal user consent applies — no preauthorization.
const SCOPES = ['Files.ReadWrite', 'User.Read'];
const UPLOAD_CHUNK = 5242880; // 5 MiB — a multiple of 320 KiB as Graph requires

async function token() {
  return auth.getGraphToken(SCOPES);
}

async function gfetch(pathOrUrl, { method = 'GET', body, headers = {}, absolute } = {}) {
  const t = await token();
  const url = absolute ? pathOrUrl : GRAPH + pathOrUrl;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${t}`, ...headers },
    body
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { msg = JSON.parse(text)?.error?.message || text; } catch {}
    throw new Error(`Graph ${res.status}: ${msg}`);
  }
  return text ? JSON.parse(text) : {};
}

// Confirm connectivity + return the drive owner (used by the "Connect OneDrive" button).
async function connect() {
  const me = await gfetch('/me');
  let drive = null;
  try { drive = await gfetch('/me/drive'); } catch {}
  return {
    ok: true,
    user: { displayName: me.displayName, upn: me.userPrincipalName, mail: me.mail },
    drive: drive ? { driveType: drive.driveType, name: drive.name, owner: drive.owner?.user?.displayName } : null
  };
}

function encodePath(p) {
  return p.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

// Upload a Buffer to /me/drive/root:/<remotePath> using an upload session
// (works for large solution files). Reports percent via onProgress.
async function uploadBuffer(remotePath, buffer, onProgress) {
  const t = await token();
  const sessRes = await fetch(
    `${GRAPH}/me/drive/root:/${encodePath(remotePath)}:/createUploadSession`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } })
    }
  );
  if (!sessRes.ok) throw new Error('OneDrive session: ' + (await sessRes.text()));
  const { uploadUrl } = await sessRes.json();

  const total = buffer.length;
  let start = 0;
  let result = null;
  while (start < total) {
    const end = Math.min(start + UPLOAD_CHUNK, total);
    const slice = buffer.subarray(start, end);
    const r = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': String(slice.length),
        'Content-Range': `bytes ${start}-${end - 1}/${total}`
      },
      body: slice
    });
    if (r.status === 202) {
      if (onProgress) onProgress(Math.round((end / total) * 100));
    } else if (r.status === 200 || r.status === 201) {
      result = await r.json();
      if (onProgress) onProgress(100);
    } else {
      const txt = await r.text();
      try { await fetch(uploadUrl, { method: 'DELETE' }); } catch {}
      throw new Error('OneDrive upload failed: ' + r.status + ' ' + txt);
    }
    start = end;
  }
  return { ok: true, webUrl: result?.webUrl, id: result?.id, name: result?.name };
}

module.exports = { connect, uploadBuffer };
