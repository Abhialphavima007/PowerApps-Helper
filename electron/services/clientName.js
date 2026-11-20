'use strict';

const auth = require('./auth');
const store = require('./store');

const tenantNames = new Map();
const LOOKUP_TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 10 * 60 * 1000;

function tenantKey(account) {
  return account.tenantId?.toLowerCase() || `account:${account.homeAccountId}`;
}

function sameAccount(actual, expected) {
  return actual?.homeAccountId === expected.homeAccountId && tenantKey(actual) === tenantKey(expected);
}

function domainFallback(account) {
  // A guest's home email domain does not identify the tenant they signed into.
  const homeTenant = account.homeAccountId?.split('.').pop();
  const guest = homeTenant && /^[0-9a-f-]{36}$/i.test(homeTenant) && homeTenant.toLowerCase() !== account.tenantId?.toLowerCase();
  const domain = account.username?.split('@').pop()?.toLowerCase();
  if (!guest && account.username?.includes('@') && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(domain || '')) {
    return { name: domain, source: 'domain' };
  }
  return { name: account.tenantId || 'Microsoft tenant', source: 'tenant-id' };
}

async function lookupTenantName(account) {
  const key = `${account.homeAccountId}:${tenantKey(account)}`;
  const cached = tenantNames.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = (async () => {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => { controller.abort(); resolve(null); }, LOOKUP_TIMEOUT_MS);
    });
    try {
      const profile = await Promise.race([timeout, (async () => {
        const token = await auth.getTenantTokenSilent(account);
        if (!token || controller.signal.aborted) return null;
        let url = 'https://management.azure.com/tenants?api-version=2022-12-01';
        for (let page = 0; page < 10 && url; page++) {
          const response = await fetch(url, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
            signal: controller.signal, redirect: 'error'
          });
          if (!response.ok) return null;
          const data = await response.json();
          const matches = Array.isArray(data.value) ? data.value.filter((item) => item.tenantId?.toLowerCase() === account.tenantId?.toLowerCase()) : [];
          if (matches.length > 1) return null;
          if (matches.length === 1) {
            const displayName = matches[0].displayName;
            return typeof displayName === 'string' && displayName.trim() ? { name: displayName.trim(), source: 'tenant' } : null;
          }
          if (!data.nextLink) return null;
          const next = new URL(data.nextLink);
          if (next.protocol !== 'https:' || next.host !== 'management.azure.com' || next.username || next.password || !/^\/tenants\/?$/i.test(next.pathname)) return null;
          url = next.href;
        }
        return null;
      })()]);
      return profile || domainFallback(account);
    } catch {
      return domainFallback(account);
    } finally {
      clearTimeout(timer);
    }
  })();
  tenantNames.set(key, { promise, expiresAt: Date.now() + CACHE_TTL_MS });
  return promise;
}

async function activeAccount(expected, accountUsername) {
  const { account } = await auth.status();
  if (!account) throw new Error('Sign in before choosing a client name.');
  if ((expected && !sameAccount(account, expected)) ||
      (accountUsername && account.username?.toLowerCase() !== accountUsername.toLowerCase())) {
    throw new Error('The active account changed. Open Settings again for the current tenant.');
  }
  return account;
}

async function get({ expectedAccount, accountUsername } = {}) {
  const account = await activeAccount(expectedAccount, accountUsername);
  let name = store.getClientNamePreference(tenantKey(account));
  const automatic = name ? null : await lookupTenantName(account);
  await activeAccount(account);
  // An edit may have been saved while the optional lookup was running.
  name = store.getClientNamePreference(tenantKey(account));
  return {
    clientName: name || automatic?.name || domainFallback(account).name,
    source: name ? 'custom' : (automatic || domainFallback(account)).source,
    tenantId: account.tenantId || '', homeAccountId: account.homeAccountId
  };
}

async function save(value, expectedAccount) {
  if (!expectedAccount?.homeAccountId) throw new Error('Reload Settings before saving the client name.');
  const account = await activeAccount(expectedAccount);
  store.saveClientNamePreference(tenantKey(account), value);
  return get({ expectedAccount: account });
}

module.exports = { get, save };
