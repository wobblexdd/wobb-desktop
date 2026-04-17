const PROFILE_MODES = ['vpn', 'proxy'];
const BOOTSTRAP_AUTH_METHODS = ['private_key', 'password'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IPV4_PATTERN = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6_PATTERN = /^[0-9a-f:]+$/i;
const DOMAIN_PATTERN = /^(?=.{1,253}$)(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/i;
const SERVER_NAME_PATTERN = /^[a-z0-9.-]+$/i;
const PUBLIC_KEY_PATTERN = /^[A-Za-z0-9_-]{16,}$/;
const SHORT_ID_PATTERN = /^(?:[0-9a-fA-F]{2}){1,16}$/;
const FINGERPRINT_PATTERN = /^[a-z0-9_-]{2,32}$/i;

function nowIso() {
  return new Date().toISOString();
}

export function generateUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const next = character === 'x' ? random : (random & 0x3) | 0x8;
    return next.toString(16);
  });
}

export function normalizeMode(value) {
  return value === 'vpn' ? 'vpn' : 'proxy';
}

export function normalizeBootstrapAuthMethod(value) {
  return value === 'password' ? 'password' : 'private_key';
}

export function isPlaceholderValue(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes('example.com') ||
    normalized.includes('replace-with-') ||
    normalized.includes('your-') ||
    normalized === 'change-me' ||
    normalized === 'test-public-key' ||
    normalized === 'test-short-id'
  );
}

function looksLikeHost(value) {
  if (!value || value.includes('://') || /[\s/?#]/.test(value)) {
    return false;
  }

  return DOMAIN_PATTERN.test(value) || IPV4_PATTERN.test(value) || IPV6_PATTERN.test(value) || value === 'localhost';
}

function looksLikeServerName(value) {
  return Boolean(value) && !value.includes('://') && !/[\s/?#]/.test(value) && SERVER_NAME_PATTERN.test(value);
}

function looksLikePublicKey(value) {
  return PUBLIC_KEY_PATTERN.test(value);
}

function looksLikeShortId(value) {
  return SHORT_ID_PATTERN.test(value);
}

export function createEmptyProfile(overrides = {}) {
  const timestamp = nowIso();
  return {
    id: overrides.id || generateUuid(),
    name: overrides.name || '',
    serverAddress: overrides.serverAddress || '',
    serverPort: String(overrides.serverPort || '8443'),
    uuid: overrides.uuid || generateUuid(),
    security: 'reality',
    serverName: overrides.serverName || 'www.google.com',
    publicKey: overrides.publicKey || '',
    shortId: overrides.shortId || '',
    fingerprint: overrides.fingerprint || 'chrome',
    spiderX: overrides.spiderX || '/',
    flow: overrides.flow || 'xtls-rprx-vision',
    remarks: overrides.remarks || '',
    mode: PROFILE_MODES.includes(overrides.mode) ? overrides.mode : 'proxy',
    isFavorite: Boolean(overrides.isFavorite),
    lastUsedAt: overrides.lastUsedAt || null,
    lastConnectionResult: overrides.lastConnectionResult || null,
    createdAt: overrides.createdAt || timestamp,
    updatedAt: overrides.updatedAt || timestamp,
  };
}

export function createEmptyBootstrapDraft() {
  return {
    profileName: 'My VPS',
    publicHost: '',
    publicPort: '8443',
    serverName: 'www.google.com',
    realityDest: 'www.google.com:443',
    fingerprint: 'chrome',
    spiderX: '/',
    flow: 'xtls-rprx-vision',
    mode: 'proxy',
    sshHost: '',
    sshPort: '22',
    sshUser: 'root',
    authMethod: 'private_key',
    uuid: '',
    publicKey: '',
    shortId: '',
    remarks: '',
  };
}

export function validateProfile(profile) {
  const errors = [];
  const fieldErrors = {};
  const name = String(profile?.name || '').trim();
  const serverAddress = String(profile?.serverAddress || '').trim();
  const serverName = String(profile?.serverName || '').trim();
  const publicKey = String(profile?.publicKey || '').trim();
  const shortId = String(profile?.shortId || '').trim();
  const uuid = String(profile?.uuid || '').trim();
  const fingerprint = String(profile?.fingerprint || '').trim();
  const serverPort = Number(profile?.serverPort);

  function push(field, message) {
    errors.push(message);
    fieldErrors[field] = message;
  }

  if (!name) {
    push('name', 'Profile name is required.');
  }
  if (!serverAddress || isPlaceholderValue(serverAddress)) {
    push('serverAddress', 'Server address is required.');
  } else if (!looksLikeHost(serverAddress)) {
    push('serverAddress', 'Server address must be a domain, IPv4, IPv6, or localhost.');
  }
  if (!Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65535) {
    push('serverPort', 'Server port must be between 1 and 65535.');
  }
  if (!UUID_PATTERN.test(uuid)) {
    push('uuid', 'UUID must be a valid UUID.');
  }
  if (!serverName || isPlaceholderValue(serverName)) {
    push('serverName', 'Server name is required.');
  } else if (!looksLikeServerName(serverName)) {
    push('serverName', 'Server name must be a hostname without scheme or path.');
  }
  if (!publicKey || isPlaceholderValue(publicKey)) {
    push('publicKey', 'REALITY public key is required.');
  } else if (!looksLikePublicKey(publicKey)) {
    push('publicKey', 'REALITY public key format looks invalid.');
  }
  if (!shortId || isPlaceholderValue(shortId)) {
    push('shortId', 'REALITY short ID is required.');
  } else if (!looksLikeShortId(shortId)) {
    push('shortId', 'REALITY short ID must be 2-32 hex characters.');
  }
  if (!fingerprint) {
    push('fingerprint', 'Fingerprint is required.');
  } else if (!FINGERPRINT_PATTERN.test(fingerprint)) {
    push('fingerprint', 'Fingerprint format looks invalid.');
  }

  return {
    valid: errors.length === 0,
    errors,
    fieldErrors,
  };
}

export function normalizeProfile(input) {
  const next = createEmptyProfile({
    ...input,
    id: input.id || generateUuid(),
    name: String(input.name || '').trim(),
    serverAddress: String(input.serverAddress || '').trim(),
    serverPort: String(input.serverPort || '').trim(),
    uuid: String(input.uuid || '').trim(),
    serverName: String(input.serverName || '').trim(),
    publicKey: String(input.publicKey || '').trim(),
    shortId: String(input.shortId || '').trim(),
    fingerprint: String(input.fingerprint || '').trim() || 'chrome',
    spiderX: String(input.spiderX || '').trim() || '/',
    flow: String(input.flow || '').trim() || 'xtls-rprx-vision',
    remarks: String(input.remarks || '').trim(),
    mode: PROFILE_MODES.includes(input.mode) ? input.mode : 'proxy',
    isFavorite: Boolean(input.isFavorite),
    lastUsedAt: input.lastUsedAt || null,
    lastConnectionResult: input.lastConnectionResult || null,
    createdAt: input.createdAt || nowIso(),
    updatedAt: nowIso(),
  });

  const validation = validateProfile(next);
  if (!validation.valid) {
    throw new Error(validation.errors[0]);
  }

  return next;
}

export function duplicateProfile(profile) {
  return createEmptyProfile({
    ...profile,
    id: generateUuid(),
    name: `${profile.name} Copy`.trim(),
    isFavorite: false,
    lastUsedAt: null,
    lastConnectionResult: null,
  });
}

export function touchProfileUsage(profile, result) {
  return createEmptyProfile({
    ...profile,
    lastUsedAt: nowIso(),
    lastConnectionResult: result,
    updatedAt: nowIso(),
  });
}

export function sortProfiles(profiles) {
  return [...profiles].sort((left, right) => {
    if (left.isFavorite !== right.isFavorite) {
      return left.isFavorite ? -1 : 1;
    }

    const leftLastUsed = left.lastUsedAt ? Date.parse(left.lastUsedAt) : 0;
    const rightLastUsed = right.lastUsedAt ? Date.parse(right.lastUsedAt) : 0;
    if (leftLastUsed !== rightLastUsed) {
      return rightLastUsed - leftLastUsed;
    }

    const leftUpdated = left.updatedAt ? Date.parse(left.updatedAt) : 0;
    const rightUpdated = right.updatedAt ? Date.parse(right.updatedAt) : 0;
    if (leftUpdated !== rightUpdated) {
      return rightUpdated - leftUpdated;
    }

    return String(left.name || '').localeCompare(String(right.name || ''));
  });
}

export function createShareLink(profile) {
  const normalized = normalizeProfile(profile);
  const params = [
    ['type', 'tcp'],
    ['security', 'reality'],
    ['pbk', normalized.publicKey],
    ['sid', normalized.shortId],
    ['fp', normalized.fingerprint],
    ['sni', normalized.serverName],
    ['spx', normalized.spiderX],
  ];

  if (normalized.flow) {
    params.push(['flow', normalized.flow]);
  }

  const query = params
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

  return `vless://${normalized.uuid}@${normalized.serverAddress}:${normalized.serverPort}?${query}#${encodeURIComponent(normalized.name)}`;
}

export function createProfileSummary(profile) {
  const normalized = normalizeProfile(profile);
  return [
    `Name: ${normalized.name}`,
    `Endpoint: ${normalized.serverAddress}:${normalized.serverPort}`,
    `Mode: ${normalized.mode === 'vpn' ? 'VPN' : 'Proxy'}`,
    `Server Name: ${normalized.serverName}`,
    `Public Key: ${normalized.publicKey}`,
    `Short ID: ${normalized.shortId}`,
    `Fingerprint: ${normalized.fingerprint}`,
    normalized.flow ? `Flow: ${normalized.flow}` : null,
    normalized.remarks ? `Remarks: ${normalized.remarks}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

export function parseVlessUri(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed.toLowerCase().startsWith('vless://')) {
    throw new Error('Import supports VLESS URIs only.');
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('The VLESS URI is invalid.');
  }

  const security = parsed.searchParams.get('security');
  if (security && security.toLowerCase() !== 'reality') {
    throw new Error('Only VLESS REALITY profiles are supported.');
  }

  if (!parsed.username || !parsed.hostname) {
    throw new Error('The VLESS URI must include a UUID and host.');
  }

  return normalizeProfile({
    name: decodeURIComponent(parsed.hash.replace(/^#/, '') || 'Imported profile'),
    serverAddress: parsed.hostname,
    serverPort: parsed.port || '443',
    uuid: decodeURIComponent(parsed.username || '').trim(),
    serverName: parsed.searchParams.get('sni') || parsed.searchParams.get('serverName') || '',
    publicKey: parsed.searchParams.get('pbk') || parsed.searchParams.get('publicKey') || '',
    shortId: parsed.searchParams.get('sid') || parsed.searchParams.get('shortId') || '',
    fingerprint: parsed.searchParams.get('fp') || 'chrome',
    spiderX: parsed.searchParams.get('spx') || '/',
    flow: parsed.searchParams.get('flow') || 'xtls-rprx-vision',
    remarks: 'Imported from VLESS URI',
    mode: 'proxy',
  });
}

function parseJsonProfile(input) {
  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error('Import text is neither valid VLESS URI nor JSON.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Imported JSON must describe a profile object.');
  }

  if (parsed.profile && typeof parsed.profile === 'object') {
    return normalizeProfile(parsed.profile);
  }

  if (Array.isArray(parsed.outbounds)) {
    const outbound = parsed.outbounds.find((entry) => entry && typeof entry === 'object' && entry.protocol === 'vless');
    if (!outbound) {
      throw new Error('No VLESS outbound was found in the imported JSON.');
    }

    const vnext = Array.isArray(outbound.settings?.vnext) ? outbound.settings.vnext[0] : null;
    const user = Array.isArray(vnext?.users) ? vnext.users[0] : null;
    const realitySettings = outbound.streamSettings?.realitySettings || {};

    return normalizeProfile({
      name: String(parsed.remarks || 'Imported profile').trim(),
      serverAddress: String(vnext?.address || '').trim(),
      serverPort: String(vnext?.port || '').trim(),
      uuid: String(user?.id || '').trim(),
      serverName: String(realitySettings.serverName || '').trim(),
      publicKey: String(realitySettings.publicKey || '').trim(),
      shortId: String(realitySettings.shortId || '').trim(),
      fingerprint: String(realitySettings.fingerprint || 'chrome').trim() || 'chrome',
      spiderX: String(realitySettings.spiderX || '/').trim() || '/',
      flow: String(user?.flow || 'xtls-rprx-vision').trim() || 'xtls-rprx-vision',
      remarks: 'Imported from Xray JSON',
      mode: 'proxy',
    });
  }

  return normalizeProfile(parsed);
}

export function parseProfileImport(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed) {
    throw new Error('Paste a VLESS URI or JSON profile first.');
  }

  if (trimmed.toLowerCase().startsWith('vless://')) {
    return parseVlessUri(trimmed);
  }

  return parseJsonProfile(trimmed);
}

export function endpointLabel(profile) {
  return `${profile.serverAddress}:${profile.serverPort}`;
}

export function bootstrapDraftToProfile(draft = {}) {
  return createEmptyProfile({
    name: String(draft.profileName || draft.name || '').trim() || 'My VPS',
    serverAddress: String(draft.publicHost || draft.host || '').trim(),
    serverPort: String(draft.publicPort || draft.port || '8443').trim(),
    uuid: String(draft.uuid || generateUuid()).trim(),
    serverName: String(draft.serverName || '').trim() || 'www.google.com',
    publicKey: String(draft.publicKey || '').trim(),
    shortId: String(draft.shortId || '').trim(),
    fingerprint: String(draft.fingerprint || 'chrome').trim() || 'chrome',
    spiderX: String(draft.spiderX || '/').trim() || '/',
    flow: String(draft.flow || 'xtls-rprx-vision').trim() || 'xtls-rprx-vision',
    remarks: String(draft.remarks || '').trim(),
    mode: PROFILE_MODES.includes(draft.mode) ? draft.mode : 'proxy',
    isFavorite: Boolean(draft.isFavorite),
    lastUsedAt: draft.lastUsedAt || null,
    lastConnectionResult: draft.lastConnectionResult || null,
  });
}

export { BOOTSTRAP_AUTH_METHODS, PROFILE_MODES };
