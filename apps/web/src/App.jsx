import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  bootstrapDraftToProfile,
  createEmptyBootstrapDraft,
  createEmptyProfile,
  createProfileSummary,
  createShareLink,
  duplicateProfile,
  endpointLabel,
  generateUuid,
  normalizeBootstrapAuthMethod,
  normalizeProfile,
  parseProfileImport,
  sortProfiles,
  touchProfileUsage,
  validateProfile,
} from './profileUtils';

const HELPER_API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3000';
const PROFILES_KEY = 'vpn-client.desktop.selfhosted.profiles.v2';
const ACTIVE_PROFILE_KEY = 'vpn-client.desktop.selfhosted.active-profile.v2';

const INITIAL_STATUS = {
  state: 'idle',
  pid: null,
  binaryPath: null,
  configPath: null,
  xrayConfigPath: null,
  socksPort: 10808,
  httpPort: 10809,
  stealthMode: false,
  error: null,
};

function statusLabel(state) {
  switch (state) {
    case 'connecting':
      return 'Connecting';
    case 'connected':
      return 'Connected';
    case 'disconnecting':
      return 'Disconnecting';
    case 'error':
      return 'Error';
    default:
      return 'Disconnected';
  }
}

function statusBadgeClass(state) {
  if (state === 'connected') {
    return 'border-blue-500/30 bg-blue-500/10 text-blue-100';
  }
  if (state === 'error') {
    return 'border-rose-500/30 bg-rose-500/10 text-rose-200';
  }
  if (state === 'connecting' || state === 'disconnecting') {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-100';
  }
  return 'border-slate-700 bg-slate-900 text-slate-300';
}

function readProfiles() {
  try {
    const raw = window.localStorage.getItem(PROFILES_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? sortProfiles(parsed.map((entry) => createEmptyProfile(entry))) : [];
  } catch {
    return [];
  }
}

function writeProfiles(profiles) {
  window.localStorage.setItem(PROFILES_KEY, JSON.stringify(sortProfiles(profiles)));
}

function readActiveProfileId() {
  return window.localStorage.getItem(ACTIVE_PROFILE_KEY);
}

function writeActiveProfileId(profileId) {
  if (profileId) {
    window.localStorage.setItem(ACTIVE_PROFILE_KEY, profileId);
    return;
  }

  window.localStorage.removeItem(ACTIVE_PROFILE_KEY);
}

async function copyText(text) {
  if (window.vpnClient?.copyText) {
    await window.vpnClient.copyText(text);
    return true;
  }

  if (window.navigator?.clipboard?.writeText) {
    await window.navigator.clipboard.writeText(text);
    return true;
  }

  return false;
}

async function readClipboardText() {
  if (window.vpnClient?.readText) {
    return window.vpnClient.readText();
  }

  if (window.navigator?.clipboard?.readText) {
    return window.navigator.clipboard.readText();
  }

  return '';
}

async function helperRequest(path, init) {
  const response = await fetch(`${HELPER_API_URL}${path}`, init);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.message || `Helper request failed with status ${response.status}`);
  }

  return payload;
}

function formatRelativeTime(timestamp) {
  if (!timestamp) {
    return 'Never used';
  }

  const delta = Date.now() - Date.parse(timestamp);
  if (Number.isNaN(delta) || delta < 0) {
    return 'Updated';
  }

  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) {
    return 'Used just now';
  }
  if (minutes < 60) {
    return `Used ${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `Used ${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `Used ${days}d ago`;
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-slate-800 py-3 first:border-t-0 first:pt-0 last:pb-0">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="max-w-[62%] text-right text-sm text-slate-100">{value}</span>
    </div>
  );
}

function NavButton({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-lg px-3 py-3 text-left text-sm font-medium transition ${
        active ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
      }`}
    >
      {label}
    </button>
  );
}

function Field({ label, value, onChange, placeholder, multiline = false }) {
  const shared =
    'mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-blue-500';

  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      {multiline ? (
        <textarea value={value} onChange={onChange} placeholder={placeholder} rows={4} className={shared} />
      ) : (
        <input value={value} onChange={onChange} placeholder={placeholder} className={shared} />
      )}
    </label>
  );
}

function SegmentedToggle({ value, onChange, options }) {
  return (
    <div className="flex rounded-lg border border-slate-800 bg-slate-900 p-1">
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`flex-1 rounded-md px-3 py-2 text-sm transition ${
              selected ? 'bg-blue-600 font-medium text-white' : 'text-slate-400'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export default function App() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeNav, setActiveNav] = useState('connect');
  const [status, setStatus] = useState(INITIAL_STATUS);
  const [logs, setLogs] = useState([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [profiles, setProfiles] = useState([]);
  const [activeProfileId, setActiveProfileId] = useState(null);
  const [draftProfile, setDraftProfile] = useState(createEmptyProfile());
  const [editingProfileId, setEditingProfileId] = useState(null);
  const [importText, setImportText] = useState('');
  const [bootstrapDraft, setBootstrapDraft] = useState(createEmptyBootstrapDraft());
  const [bootstrapPlan, setBootstrapPlan] = useState(null);
  const [bootstrapBusy, setBootstrapBusy] = useState(false);
  const activeProfileIdRef = useRef(null);

  useEffect(() => {
    activeProfileIdRef.current = activeProfileId;
  }, [activeProfileId]);

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeProfileId) || null,
    [profiles, activeProfileId]
  );
  const activeValidation = useMemo(
    () => (activeProfile ? validateProfile(activeProfile) : { valid: false, errors: ['Create a profile first.'] }),
    [activeProfile]
  );
  const filteredProfiles = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return sortProfiles(profiles);
    }

    return sortProfiles(profiles).filter((profile) => {
      const haystack = [profile.name, profile.serverAddress, profile.serverName, profile.remarks]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [profiles, searchQuery]);

  const connectionLabel = statusLabel(status.state);
  const isConnected = status.state === 'connected';
  const isBusy = status.state === 'connecting' || status.state === 'disconnecting';
  const connectLabel = isConnected ? 'Disconnect' : isBusy ? connectionLabel : 'Connect';

  function persistProfiles(nextProfiles, nextActiveProfileId) {
    const sorted = sortProfiles(nextProfiles.map((profile) => createEmptyProfile(profile)));
    setProfiles(sorted);
    setActiveProfileId(nextActiveProfileId);
    writeProfiles(sorted);
    writeActiveProfileId(nextActiveProfileId);
  }

  function markActiveProfile(result) {
    const targetId = activeProfileIdRef.current;
    if (!targetId) {
      return;
    }

    setProfiles((current) => {
      const next = sortProfiles(current.map((profile) => (profile.id === targetId ? touchProfileUsage(profile, result) : profile)));
      writeProfiles(next);
      return next;
    });
  }

  useEffect(() => {
    const storedProfiles = readProfiles();
    const storedActiveProfileId = readActiveProfileId();
    const nextActiveId = storedProfiles.some((profile) => profile.id === storedActiveProfileId)
      ? storedActiveProfileId
      : storedProfiles[0]?.id || null;

    setProfiles(storedProfiles);
    setActiveProfileId(nextActiveId);
  }, []);

  useEffect(() => {
    if (!window.vpnClient) {
      setMessage('Electron bridge is unavailable.');
      return;
    }

    let removeStatus = () => {};
    let removeLog = () => {};

    async function bootstrapRuntime() {
      const currentStatus = await window.vpnClient.getStatus();
      setStatus(currentStatus);

      removeStatus = window.vpnClient.onStatusChange((nextStatus) => {
        setStatus(nextStatus);
        if (nextStatus.state === 'connected') {
          markActiveProfile('connected');
        }
        if (nextStatus.state === 'error') {
          markActiveProfile('error');
        }
      });

      removeLog = window.vpnClient.onLog((entry) => {
        setLogs((current) => [...current, entry].slice(-250));
      });
    }

    bootstrapRuntime().catch((error) => {
      setMessage(error.message);
    });

    return () => {
      removeStatus();
      removeLog();
    };
  }, []);

  useEffect(() => {
    if (status.error) {
      setMessage(status.error);
    }
  }, [status.error]);

  function openCreateProfile() {
    setEditingProfileId(null);
    setDraftProfile(createEmptyProfile());
    setActiveNav('profiles');
    setMessage('');
  }

  function openEditProfile(profile) {
    setEditingProfileId(profile.id);
    setDraftProfile(createEmptyProfile(profile));
    setActiveNav('profiles');
    setMessage('');
  }

  function handleSaveProfile() {
    try {
      const savedProfile = normalizeProfile(draftProfile);
      const nextProfiles = editingProfileId
        ? profiles.map((profile) => (profile.id === editingProfileId ? savedProfile : profile))
        : [savedProfile, ...profiles];
      const nextActiveProfileId = editingProfileId === activeProfileId ? savedProfile.id : activeProfileId || savedProfile.id;

      persistProfiles(nextProfiles, nextActiveProfileId);
      setEditingProfileId(null);
      setMessage(`Saved profile ${savedProfile.name}.`);
      setActiveNav('connect');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save profile.');
    }
  }

  function handleDeleteProfile(profile) {
    const confirmed = window.confirm(`Remove ${profile.name}?`);
    if (!confirmed) {
      return;
    }

    const nextProfiles = profiles.filter((entry) => entry.id !== profile.id);
    const nextActiveProfileId = activeProfileId === profile.id ? nextProfiles[0]?.id || null : activeProfileId;
    persistProfiles(nextProfiles, nextActiveProfileId);
    setMessage(`Deleted profile ${profile.name}.`);
  }

  function handleSelectProfile(profile) {
    setActiveProfileId(profile.id);
    activeProfileIdRef.current = profile.id;
    writeActiveProfileId(profile.id);
    setMessage(`Selected profile ${profile.name}.`);
    setActiveNav('connect');
  }

  function handleDuplicateProfile(profile) {
    const nextProfile = duplicateProfile(profile);
    persistProfiles([nextProfile, ...profiles], nextProfile.id);
    setMessage(`Duplicated profile ${profile.name}.`);
  }

  function handleToggleFavorite(profile) {
    const nextProfiles = profiles.map((entry) =>
      entry.id === profile.id ? createEmptyProfile({ ...entry, isFavorite: !entry.isFavorite, updatedAt: new Date().toISOString() }) : entry
    );
    persistProfiles(nextProfiles, activeProfileId);
  }

  async function handleCopyShareLink(profile = activeProfile) {
    if (!profile) {
      setMessage('Select a profile first.');
      return;
    }

    try {
      const shareLink = createShareLink(profile);
      await copyText(shareLink);
      setMessage('Profile URI copied.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to copy profile link.');
    }
  }

  async function handleCopyProfileSummary(profile = activeProfile) {
    if (!profile) {
      setMessage('Select a profile first.');
      return;
    }

    try {
      await copyText(`${createProfileSummary(profile)}\n\n${createShareLink(profile)}`);
      setMessage('Profile summary copied.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to copy profile summary.');
    }
  }

  async function handleImportClipboard() {
    try {
      const clipboard = await readClipboardText();
      if (!clipboard) {
        throw new Error('Clipboard is empty.');
      }
      setImportText(clipboard);
      setMessage('Pasted profile input from clipboard.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to read clipboard.');
    }
  }

  function handleImportText() {
    try {
      const imported = parseProfileImport(importText);
      setEditingProfileId(null);
      setDraftProfile(imported);
      setActiveNav('profiles');
      setMessage(`Imported draft for ${imported.name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to import profile.');
    }
  }

  async function handleToggleConnection() {
    if (!window.vpnClient) {
      setMessage('Electron bridge is unavailable.');
      return;
    }

    setLoading(true);
    setMessage('');

    try {
      if (isConnected || status.state === 'connecting') {
        await window.vpnClient.stop();
        setMessage('Disconnected.');
        return;
      }

      if (!activeProfile) {
        throw new Error('Create and select a profile before connecting.');
      }

      const validation = validateProfile(activeProfile);
      if (!validation.valid) {
        throw new Error(validation.errors[0]);
      }

      await window.vpnClient.start({
        profile: {
          ...activeProfile,
          serverPort: Number(activeProfile.serverPort),
        },
        stealthMode: activeProfile.mode === 'proxy',
      });

      setMessage(`Connecting to ${endpointLabel(activeProfile)}.`);
    } catch (error) {
      markActiveProfile('error');
      setMessage(error instanceof Error ? error.message : 'Connection failed.');
    } finally {
      setLoading(false);
    }
  }

  async function handleGeneratePlan() {
    setBootstrapBusy(true);
    setMessage('');
    setBootstrapPlan(null);

    try {
      const response = await helperRequest('/api/v1/bootstrap/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profileName: bootstrapDraft.profileName,
          publicHost: bootstrapDraft.publicHost,
          publicPort: bootstrapDraft.publicPort,
          serverName: bootstrapDraft.serverName,
          realityDest: bootstrapDraft.realityDest,
          fingerprint: bootstrapDraft.fingerprint,
          spiderX: bootstrapDraft.spiderX,
          flow: bootstrapDraft.flow,
          mode: bootstrapDraft.mode,
          sshHost: bootstrapDraft.sshHost,
          sshPort: bootstrapDraft.sshPort,
          sshUser: bootstrapDraft.sshUser,
          authMethod: bootstrapDraft.authMethod,
          uuid: bootstrapDraft.uuid || undefined,
          publicKey: bootstrapDraft.publicKey || undefined,
          shortId: bootstrapDraft.shortId || undefined,
          remarks: bootstrapDraft.remarks || undefined,
        }),
      });

      setBootstrapPlan(response.data);
      setMessage('Bootstrap plan generated.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to generate setup plan.');
    } finally {
      setBootstrapBusy(false);
    }
  }

  function handleUseBootstrapDraft() {
    if (!bootstrapPlan) {
      return;
    }

    const source = bootstrapPlan.profileReady && bootstrapPlan.profile ? bootstrapPlan.profile : bootstrapPlan.draftProfile;
    const nextProfile = bootstrapDraftToProfile({
      ...bootstrapDraft,
      ...(source || {}),
      profileName: source?.name || bootstrapDraft.profileName,
      publicHost: source?.host || bootstrapDraft.publicHost,
      publicPort: String(source?.port || bootstrapDraft.publicPort),
    });

    setEditingProfileId(null);
    setDraftProfile(nextProfile);
    setActiveNav('profiles');
  }

  async function handleCopyBootstrapCommands() {
    if (!bootstrapPlan?.commandSnippets?.length) {
      setMessage('No bootstrap commands are available yet.');
      return;
    }

    await copyText(bootstrapPlan.commandSnippets.join('\n'));
    setMessage('Bootstrap commands copied.');
  }

  async function handleCopyBootstrapSummary() {
    if (!bootstrapPlan?.summary) {
      setMessage('No ready profile summary is available yet.');
      return;
    }

    await copyText([bootstrapPlan.summary, bootstrapPlan.shareLink || ''].filter(Boolean).join('\n\n'));
    setMessage('Bootstrap profile summary copied.');
  }

  async function handleCopyLogs() {
    if (!logs.length) {
      setMessage('No logs to copy.');
      return;
    }

    const payload = logs.map((entry) => `[${entry.timestamp}] ${entry.stream} ${entry.level.toUpperCase()} ${entry.message}`).join('\n');
    await copyText(payload);
    setMessage('Logs copied.');
  }

  function handleClearLogs() {
    setLogs([]);
    setMessage('Logs cleared.');
  }

  const renderConnect = () => (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-blue-400">VPN Client</p>
          <h2 className="mt-2 text-3xl font-semibold text-slate-50">Self-hosted desktop client</h2>
          <p className="mt-2 max-w-xl text-sm text-slate-400">
            Save profiles locally, validate them before connect, and keep runtime status readable while you test your own server.
          </p>
        </div>
        <div className={`rounded-md border px-3 py-1.5 text-sm ${statusBadgeClass(status.state)}`}>{connectionLabel}</div>
      </header>

      <section className="rounded-lg border border-slate-800 bg-slate-900/88 p-5">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_240px]">
          <div className="space-y-5">
            <div className="rounded-lg border border-slate-800 bg-slate-950/45 p-5">
              <div className="text-xs uppercase tracking-wide text-slate-500">Selected profile</div>
              <div className="mt-3 text-2xl font-semibold text-slate-50">{activeProfile?.name || 'No profile selected'}</div>
              <div className="mt-2 text-sm text-slate-400">
                {activeProfile ? `${endpointLabel(activeProfile)} | ${activeProfile.serverName}` : 'Create or import a local profile to start.'}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">Mode</div>
                <div className="mt-2 text-sm text-slate-100">{activeProfile ? (activeProfile.mode === 'vpn' ? 'VPN' : 'Proxy') : 'Not loaded'}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">Endpoint</div>
                <div className="mt-2 text-sm text-slate-100">{activeProfile ? endpointLabel(activeProfile) : 'Not loaded'}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">Last result</div>
                <div className="mt-2 text-sm text-slate-100">{activeProfile?.lastConnectionResult || 'No result yet'}</div>
              </div>
            </div>

            {!activeValidation.valid && activeProfile ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                {activeValidation.errors[0]}
              </div>
            ) : null}

            {message ? (
              <div className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-300">{message}</div>
            ) : null}
          </div>

          <div className="flex flex-col gap-4">
            <button
              type="button"
              onClick={handleToggleConnection}
              disabled={loading || (!isConnected && (!activeProfile || !activeValidation.valid))}
              className="h-12 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {connectLabel}
            </button>
            <button type="button" onClick={() => handleCopyShareLink()} disabled={!activeProfile} className="h-11 rounded-lg border border-slate-800 bg-slate-900 px-4 text-sm text-slate-200 transition hover:border-slate-700 disabled:cursor-not-allowed disabled:opacity-60">Copy URI</button>
            <button type="button" onClick={() => handleCopyProfileSummary()} disabled={!activeProfile} className="h-11 rounded-lg border border-slate-800 bg-slate-900 px-4 text-sm text-slate-200 transition hover:border-slate-700 disabled:cursor-not-allowed disabled:opacity-60">Copy summary</button>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-lg border border-slate-800 bg-slate-900/88 p-5">
          <h2 className="mb-4 text-base font-semibold text-slate-100">Profile details</h2>
          <DetailRow label="Host" value={activeProfile?.serverAddress || 'Not loaded'} />
          <DetailRow label="Port" value={activeProfile?.serverPort || 'Not loaded'} />
          <DetailRow label="Server name" value={activeProfile?.serverName || 'Not loaded'} />
          <DetailRow label="Remarks" value={activeProfile?.remarks || 'None'} />
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900/88 p-5">
          <h2 className="mb-4 text-base font-semibold text-slate-100">Runtime</h2>
          <DetailRow label="PID" value={status.pid || 'Not running'} />
          <DetailRow label="Config" value={status.configPath || 'Not running'} />
          <DetailRow label="Binary" value={status.binaryPath || 'Not resolved yet'} />
        </section>
      </div>
    </div>
  );

  const renderProfiles = () => {
    const draftValidation = validateProfile(draftProfile);

    return (
      <div className="space-y-6">
        <header>
          <p className="text-sm font-medium text-blue-400">Profiles</p>
          <h2 className="mt-2 text-3xl font-semibold text-slate-50">Profile editor</h2>
          <p className="mt-2 max-w-xl text-sm text-slate-400">Keep one clean local source of truth for each server you manage.</p>
        </header>

        <section className="rounded-lg border border-slate-800 bg-slate-900/88 p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Profile name" value={draftProfile.name} onChange={(event) => setDraftProfile((current) => ({ ...current, name: event.target.value }))} placeholder="My VPS" />
            <Field label="Host" value={draftProfile.serverAddress} onChange={(event) => setDraftProfile((current) => ({ ...current, serverAddress: event.target.value }))} placeholder="157.90.116.123" />
            <Field label="Port" value={draftProfile.serverPort} onChange={(event) => setDraftProfile((current) => ({ ...current, serverPort: event.target.value }))} placeholder="8443" />
            <Field label="UUID" value={draftProfile.uuid} onChange={(event) => setDraftProfile((current) => ({ ...current, uuid: event.target.value }))} />
            <div className="md:col-span-2">
              <button type="button" onClick={() => setDraftProfile((current) => ({ ...current, uuid: generateUuid() }))} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 transition hover:border-slate-700">Generate UUID</button>
            </div>
            <Field label="Server name / SNI" value={draftProfile.serverName} onChange={(event) => setDraftProfile((current) => ({ ...current, serverName: event.target.value }))} />
            <Field label="REALITY public key" value={draftProfile.publicKey} onChange={(event) => setDraftProfile((current) => ({ ...current, publicKey: event.target.value }))} />
            <Field label="REALITY short ID" value={draftProfile.shortId} onChange={(event) => setDraftProfile((current) => ({ ...current, shortId: event.target.value }))} />
            <Field label="Fingerprint" value={draftProfile.fingerprint} onChange={(event) => setDraftProfile((current) => ({ ...current, fingerprint: event.target.value }))} />
            <Field label="Spider X" value={draftProfile.spiderX} onChange={(event) => setDraftProfile((current) => ({ ...current, spiderX: event.target.value }))} />
            <Field label="Flow" value={draftProfile.flow} onChange={(event) => setDraftProfile((current) => ({ ...current, flow: event.target.value }))} />
            <div className="md:col-span-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Mode</span>
              <div className="mt-2">
                <SegmentedToggle value={draftProfile.mode} onChange={(mode) => setDraftProfile((current) => ({ ...current, mode }))} options={[{ label: 'Proxy', value: 'proxy' }, { label: 'VPN', value: 'vpn' }]} />
              </div>
            </div>
            <div className="md:col-span-2">
              <Field label="Remarks" value={draftProfile.remarks} onChange={(event) => setDraftProfile((current) => ({ ...current, remarks: event.target.value }))} multiline />
            </div>
          </div>

          {!draftValidation.valid ? <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">{draftValidation.errors[0]}</div> : null}

          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" onClick={handleSaveProfile} className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500">{editingProfileId ? 'Update profile' : 'Save profile'}</button>
            <button type="button" onClick={() => { setEditingProfileId(null); setDraftProfile(createEmptyProfile()); }} className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-2.5 text-sm text-slate-200 transition hover:border-slate-700">Reset form</button>
          </div>
        </section>
      </div>
    );
  };

  const renderImport = () => (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-medium text-blue-400">Import</p>
        <h2 className="mt-2 text-3xl font-semibold text-slate-50">Bring in an existing profile</h2>
        <p className="mt-2 max-w-xl text-sm text-slate-400">Paste a share link or JSON object, review the parsed draft, then save it locally before connect.</p>
      </header>

      <section className="rounded-lg border border-slate-800 bg-slate-900/88 p-5">
        <textarea value={importText} onChange={(event) => setImportText(event.target.value)} rows={12} placeholder="vless://..." className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100 outline-none transition focus:border-blue-500" />
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" onClick={handleImportClipboard} className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-2.5 text-sm text-slate-200 transition hover:border-slate-700">Paste clipboard</button>
          <button type="button" onClick={() => setMessage('QR import is reserved for the camera pass.')} className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-2.5 text-sm text-slate-200 transition hover:border-slate-700">QR import</button>
          <button type="button" onClick={handleImportText} className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500">Open draft</button>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-300">
          <div className="text-xs uppercase tracking-wide text-slate-500">VLESS URI</div>
          <div className="mt-2 text-slate-400">Best when you already have a share link from your own panel or script.</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-300">
          <div className="text-xs uppercase tracking-wide text-slate-500">JSON import</div>
          <div className="mt-2 text-slate-400">Useful when the profile came from another Xray tool or exported config.</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-300">
          <div className="text-xs uppercase tracking-wide text-slate-500">QR import</div>
          <div className="mt-2 text-slate-400">The entry point is in place now so camera support can land later without changing the profile model.</div>
        </div>
      </section>
    </div>
  );

  const renderBootstrap = () => (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-medium text-blue-400">Bootstrap</p>
        <h2 className="mt-2 text-3xl font-semibold text-slate-50">Bootstrap planner</h2>
        <p className="mt-2 max-w-xl text-sm text-slate-400">Prepare a clean rollout plan for your VPS, then turn the result into a local profile when the final REALITY values are known.</p>
      </header>

      <section className="rounded-lg border border-slate-800 bg-slate-900/88 p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Profile name" value={bootstrapDraft.profileName} onChange={(event) => setBootstrapDraft((current) => ({ ...current, profileName: event.target.value }))} />
          <Field label="Public host" value={bootstrapDraft.publicHost} onChange={(event) => setBootstrapDraft((current) => ({ ...current, publicHost: event.target.value }))} placeholder="157.90.116.123" />
          <Field label="Public port" value={bootstrapDraft.publicPort} onChange={(event) => setBootstrapDraft((current) => ({ ...current, publicPort: event.target.value }))} placeholder="8443" />
          <Field label="Server name" value={bootstrapDraft.serverName} onChange={(event) => setBootstrapDraft((current) => ({ ...current, serverName: event.target.value }))} />
          <Field label="REALITY destination" value={bootstrapDraft.realityDest} onChange={(event) => setBootstrapDraft((current) => ({ ...current, realityDest: event.target.value }))} />
          <Field label="SSH host" value={bootstrapDraft.sshHost} onChange={(event) => setBootstrapDraft((current) => ({ ...current, sshHost: event.target.value }))} />
          <Field label="SSH port" value={bootstrapDraft.sshPort} onChange={(event) => setBootstrapDraft((current) => ({ ...current, sshPort: event.target.value }))} />
          <Field label="SSH user" value={bootstrapDraft.sshUser} onChange={(event) => setBootstrapDraft((current) => ({ ...current, sshUser: event.target.value }))} />
          <div className="md:col-span-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">SSH auth</span>
            <div className="mt-2">
              <SegmentedToggle value={bootstrapDraft.authMethod} onChange={(value) => setBootstrapDraft((current) => ({ ...current, authMethod: normalizeBootstrapAuthMethod(value) }))} options={[{ label: 'Private key', value: 'private_key' }, { label: 'Password', value: 'password' }]} />
            </div>
          </div>
          <Field label="UUID (optional)" value={bootstrapDraft.uuid} onChange={(event) => setBootstrapDraft((current) => ({ ...current, uuid: event.target.value }))} />
          <Field label="Public key (optional)" value={bootstrapDraft.publicKey} onChange={(event) => setBootstrapDraft((current) => ({ ...current, publicKey: event.target.value }))} />
          <Field label="Short ID (optional)" value={bootstrapDraft.shortId} onChange={(event) => setBootstrapDraft((current) => ({ ...current, shortId: event.target.value }))} />
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" onClick={handleGeneratePlan} disabled={bootstrapBusy} className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60">{bootstrapBusy ? 'Working' : 'Generate setup plan'}</button>
        </div>
      </section>

      {bootstrapPlan ? (
        <section className="rounded-lg border border-slate-800 bg-slate-900/88 p-5">
          <h2 className="mb-4 text-base font-semibold text-slate-100">Generated plan</h2>
          <DetailRow label="Profile ready" value={bootstrapPlan.profileReady ? 'Yes' : 'No'} />
          <DetailRow label="Missing fields" value={bootstrapPlan.missingFields?.length ? bootstrapPlan.missingFields.join(', ') : 'None'} />
          <div className="mt-4 space-y-2 text-sm text-slate-200">
            {bootstrapPlan.manualSteps?.map((step, index) => (
              <div key={`${step}-${index}`}>{index + 1}. {step}</div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" onClick={handleUseBootstrapDraft} className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-2.5 text-sm text-slate-200 transition hover:border-slate-700">{bootstrapPlan.profileReady ? 'Use ready profile' : 'Open draft profile'}</button>
            <button type="button" onClick={handleCopyBootstrapCommands} className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-2.5 text-sm text-slate-200 transition hover:border-slate-700">Copy commands</button>
            {bootstrapPlan.summary ? <button type="button" onClick={handleCopyBootstrapSummary} className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-2.5 text-sm text-slate-200 transition hover:border-slate-700">Copy summary</button> : null}
          </div>
        </section>
      ) : null}
    </div>
  );

  const renderLogs = () => (
    <section className="rounded-lg border border-slate-800 bg-slate-900/88 p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-100">Logs</h2>
        <div className="flex gap-2">
          <button type="button" onClick={handleCopyLogs} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 transition hover:border-slate-700">Copy</button>
          <button type="button" onClick={handleClearLogs} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 transition hover:border-slate-700">Clear</button>
        </div>
      </div>
      <div className="h-96 overflow-y-auto rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3">
        {logs.length === 0 ? (
          <div className="text-sm text-slate-500">No runtime logs yet. Connect once to start building a local history.</div>
        ) : (
          <div className="space-y-3">
            {logs.map((entry) => (
              <div key={entry.id} className="border-b border-slate-800 pb-3 last:border-b-0">
                <div className="text-xs text-slate-500">{entry.timestamp.slice(11, 19)} {entry.stream}</div>
                <div className={`mt-1 text-sm ${entry.level === 'error' ? 'text-rose-300' : entry.level === 'warn' ? 'text-amber-100' : 'text-slate-200'}`}>{entry.message}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );

  const renderSettings = () => (
    <section className="rounded-lg border border-slate-800 bg-slate-900/88 p-5">
      <h2 className="mb-4 text-base font-semibold text-slate-100">Settings</h2>
      <DetailRow label="Helper API" value={HELPER_API_URL} />
      <DetailRow label="Profiles" value={String(profiles.length)} />
      <DetailRow label="Selected mode" value={activeProfile ? (activeProfile.mode === 'vpn' ? 'VPN' : 'Proxy') : 'Not selected'} />
      <DetailRow label="Binary path" value={status.binaryPath || 'Not resolved yet'} />
      <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/45 p-4 text-sm text-slate-400">The main product flow is local and profile-based. The helper API is optional and only used for bootstrap planning.</div>
    </section>
  );

  const renderMainPanel = () => {
    switch (activeNav) {
      case 'profiles':
        return renderProfiles();
      case 'import':
        return renderImport();
      case 'bootstrap':
        return renderBootstrap();
      case 'logs':
        return renderLogs();
      case 'settings':
        return renderSettings();
      default:
        return renderConnect();
    }
  };

  return (
    <div className="min-h-screen bg-[#060d18] text-slate-100">
      <main className="mx-auto grid min-h-screen max-w-[1500px] grid-cols-[88px_360px_minmax(0,1fr)] gap-0 px-4 py-4">
        <aside className="flex flex-col rounded-l-xl border border-r-0 border-slate-800 bg-[#091120] px-3 py-4">
          <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-lg bg-blue-600 text-sm font-semibold text-white">W</div>
          <div className="flex w-full flex-1 flex-col gap-2">
            <NavButton label="Connect" active={activeNav === 'connect'} onClick={() => setActiveNav('connect')} />
            <NavButton label="Profiles" active={activeNav === 'profiles'} onClick={() => setActiveNav('profiles')} />
            <NavButton label="Import" active={activeNav === 'import'} onClick={() => setActiveNav('import')} />
            <NavButton label="Bootstrap" active={activeNav === 'bootstrap'} onClick={() => setActiveNav('bootstrap')} />
            <NavButton label="Logs" active={activeNav === 'logs'} onClick={() => setActiveNav('logs')} />
            <NavButton label="Settings" active={activeNav === 'settings'} onClick={() => setActiveNav('settings')} />
          </div>
        </aside>

        <aside className="flex min-h-0 flex-col border border-r-0 border-slate-800 bg-[#0b1323]">
          <div className="border-b border-slate-800 px-5 py-5">
            <h1 className="text-lg font-semibold text-slate-50">Profiles</h1>
            <p className="mt-1 text-sm text-slate-400">Profiles saved locally on this machine.</p>
          </div>

          <div className="space-y-4 border-b border-slate-800 px-5 py-5">
            <div className="flex gap-2">
              <button type="button" onClick={openCreateProfile} className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500">Add profile</button>
              <button type="button" onClick={() => setActiveNav('import')} className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-2.5 text-sm text-slate-200 transition hover:border-slate-700">Import</button>
            </div>

            <label className="block">
              <span className="mb-2 block text-sm text-slate-300">Search</span>
              <input type="text" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-blue-500" />
            </label>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {filteredProfiles.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-800 px-4 py-6 text-sm text-slate-500">No local profiles yet. Add one manually, paste a VLESS URI, or use the bootstrap planner.</div>
            ) : (
              <div className="space-y-2">
                {filteredProfiles.map((profile) => {
                  const selected = profile.id === activeProfileId;
                  return (
                    <div key={profile.id} className={`rounded-lg border px-4 py-3 ${selected ? 'border-blue-500 bg-blue-500/10' : 'border-slate-800 bg-slate-950/40'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <button type="button" onClick={() => handleSelectProfile(profile)} className="flex-1 text-left">
                          <div className="text-sm font-medium text-slate-100">{profile.name}</div>
                          <div className="mt-1 text-xs text-slate-400">{endpointLabel(profile)}</div>
                        </button>
                        <button type="button" onClick={() => handleToggleFavorite(profile)} className={`rounded-md border px-2 py-1 text-[11px] ${profile.isFavorite ? 'border-blue-500/30 bg-blue-500/10 text-blue-100' : 'border-slate-800 bg-slate-900 text-slate-400'}`}>{profile.isFavorite ? 'Fav' : 'Star'}</button>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-400">
                        <div className="rounded-md bg-slate-900 px-2 py-1">{profile.mode === 'vpn' ? 'VPN' : 'Proxy'}</div>
                        <div className="rounded-md bg-slate-900 px-2 py-1">{profile.lastConnectionResult || 'No result'}</div>
                        <div className="rounded-md bg-slate-900 px-2 py-1">{formatRelativeTime(profile.lastUsedAt)}</div>
                      </div>
                      <div className="mt-3 grid grid-cols-4 gap-2">
                        <button type="button" onClick={() => openEditProfile(profile)} className="rounded-lg border border-slate-800 px-3 py-2 text-xs text-slate-200 transition hover:border-slate-700">Edit</button>
                        <button type="button" onClick={() => handleCopyShareLink(profile)} className="rounded-lg border border-slate-800 px-3 py-2 text-xs text-slate-200 transition hover:border-slate-700">Copy</button>
                        <button type="button" onClick={() => handleDuplicateProfile(profile)} className="rounded-lg border border-slate-800 px-3 py-2 text-xs text-slate-200 transition hover:border-slate-700">Copy as new</button>
                        <button type="button" onClick={() => handleDeleteProfile(profile)} className="rounded-lg border border-rose-900/60 px-3 py-2 text-xs text-rose-300 transition hover:border-rose-700">Delete</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        <section className="min-h-0 overflow-y-auto rounded-r-xl border border-slate-800 bg-[#050b15] px-6 py-6">
          {renderMainPanel()}
        </section>
      </main>
    </div>
  );
}



