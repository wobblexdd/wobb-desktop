const PROFILE_MODES = ['vpn', 'proxy'];

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

export function isPlaceholderValue(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes('example.com') ||
    normalized.includes('replace-with-') ||
    normalized.includes('your-') ||
    normalized === 'change-me'
  );
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
    uuid: '',
    publicKey: '',
    shortId: '',
    remarks: '',
  };
}

export function validateProfile(profile) {
  const errors = [];
  const name = String(profile?.name || '').trim();
  const serverAddress = String(profile?.serverAddress || '').trim();
  const serverName = String(profile?.serverName || '').trim();
  const publicKey = String(profile?.publicKey || '').trim();
  const shortId = String(profile?.shortId || '').trim();
  const uuid = String(profile?.uuid || '').trim();
  const fingerprint = String(profile?.fingerprint || '').trim();
  const serverPort = Number(profile?.serverPort);

  if (!name) {
    errors.push('Profile name is required.');
  }
  if (!serverAddress || isPlaceholderValue(serverAddress)) {
    errors.push('Server address is required.');
  }
  if (!Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65535) {
    errors.push('Server port must be between 1 and 65535.');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)) {
    errors.push('UUID must be a valid v4 UUID.');
  }
  if (!serverName || isPlaceholderValue(serverName)) {
    errors.push('Server name is required.');
  }
  if (!publicKey || isPlaceholderValue(publicKey)) {
    errors.push('REALITY public key is required.');
  }
  if (!shortId || isPlaceholderValue(shortId)) {
    errors.push('REALITY short ID is required.');
  }
  if (!fingerprint) {
    errors.push('Fingerprint is required.');
  }

  return {
    valid: errors.length === 0,
    errors,
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
    updatedAt: nowIso(),
  });

  const validation = validateProfile(next);
  if (!validation.valid) {
    throw new Error(validation.errors[0]);
  }

  return next;
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
    ['flow', normalized.flow],
  ]
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

  return `vless://${normalized.uuid}@${normalized.serverAddress}:${normalized.serverPort}?${params}#${encodeURIComponent(normalized.name)}`;
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
  });
}
