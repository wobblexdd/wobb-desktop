import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Power, ScrollText, Search, Server, Settings, Shield } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3000';
const VERIFY_ENDPOINT = `${API_BASE_URL}/api/v1/verify`;
const PROFILE_CACHE_KEY = 'wobb.desktop.profile.v1';
const SERVER_CACHE_KEY = 'wobb.desktop.servers.v1';

const INITIAL_STATUS = {
  state: 'ready',
  pid: null,
  binaryPath: null,
  configPath: 'stdin:',
  stealthMode: false,
  error: null,
};

function statusLabel(state) {
  switch (state) {
    case 'starting':
      return 'Connecting';
    case 'protected':
    case 'bypassing-dpi':
      return 'Connected';
    case 'stopping':
      return 'Disconnecting';
    default:
      return 'Disconnected';
  }
}

function readCachedProfile(accessKey) {
  try {
    const raw = window.localStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || parsed.accessKey !== accessKey || !parsed.profile) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function writeCachedProfile(accessKey, payload) {
  try {
    window.localStorage.setItem(
      PROFILE_CACHE_KEY,
      JSON.stringify({
        accessKey,
        profile: payload.profile,
        access: payload.access,
        expiry: payload.expiry || null,
        cachedAt: new Date().toISOString(),
      })
    );
  } catch {
    // Ignore local cache failures.
  }
}

function readServerCache() {
  try {
    const raw = window.localStorage.getItem(SERVER_CACHE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeServerCache(entry) {
  try {
    const current = readServerCache();
    const filtered = current.filter((item) => item.id !== entry.id);
    const next = [entry, ...filtered].slice(0, 10);
    window.localStorage.setItem(SERVER_CACHE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return readServerCache();
  }
}

function createServerEntry(accessKey, payload) {
  return {
    id: accessKey,
    accessKey,
    label: payload.access?.title || payload.profile.serverName || payload.profile.serverAddress,
    note: payload.access?.note || '',
    expiry: payload.expiry || null,
    profile: payload.profile,
    updatedAt: new Date().toISOString(),
  };
}

async function verifyAccess(accessKey) {
  const normalizedKey = String(accessKey || '').trim();
  if (!normalizedKey) {
    throw new Error('Access key is required.');
  }

  try {
    const response = await fetch(VERIFY_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ key: normalizedKey }),
    });

    const payload = await response.json();
    if (!response.ok || !payload?.success || !payload?.config) {
      throw new Error(payload?.message || 'Access key verification failed.');
    }

    const resolved = {
      profile: {
        serverAddress: payload.config.serverAddress,
        serverPort: Number(payload.config.port),
        uuid: payload.config.uuid,
        serverName: payload.config.sni || payload.config.serverAddress,
        security: payload.config.security || 'tls',
        network: payload.config.network || 'tcp',
        publicKey: payload.config.publicKey || '',
        shortId: payload.config.shortId || '',
        spiderX: payload.config.spiderX || '/',
        flow: payload.config.flow || '',
      },
      access: payload.access || null,
      expiry: payload.expiry || null,
      fromCache: false,
    };

    writeCachedProfile(normalizedKey, resolved);
    return resolved;
  } catch (error) {
    if (error instanceof TypeError) {
      const cached = readCachedProfile(normalizedKey);
      if (cached) {
        return {
          profile: cached.profile,
          access: cached.access || null,
          expiry: cached.expiry || null,
          fromCache: true,
        };
      }
    }

    throw error;
  }
}

function formatExpiry(value) {
  if (!value) {
    return 'Not set';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString('en-GB');
}

function SectionCard({ title, description, children, sectionRef }) {
  return (
    <section ref={sectionRef} className="rounded-lg border border-slate-800 bg-slate-900/88 p-5">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-slate-100">{title}</h2>
        {description ? <p className="mt-1 text-sm text-slate-400">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-slate-800 py-3 first:border-t-0 first:pt-0 last:pb-0">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="max-w-[62%] text-right text-sm text-slate-100">{value}</span>
    </div>
  );
}

function NavButton({ icon: Icon, label, onClick, active }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full flex-col items-center gap-2 rounded-lg px-2 py-3 text-xs font-medium transition ${
        active ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
      }`}
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </button>
  );
}

export default function App() {
  const [accessKey, setAccessKey] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [clientMode] = useState('proxy');
  const [status, setStatus] = useState(INITIAL_STATUS);
  const [logs, setLogs] = useState([]);
  const [profile, setProfile] = useState(null);
  const [accessInfo, setAccessInfo] = useState(null);
  const [expiry, setExpiry] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [savedServers, setSavedServers] = useState([]);
  const [selectedServerId, setSelectedServerId] = useState(null);
  const [activeNav, setActiveNav] = useState('connect');

  const logsSectionRef = useRef(null);
  const logsViewportRef = useRef(null);
  const connectRef = useRef(null);
  const settingsRef = useRef(null);
  const serversRef = useRef(null);

  const connectionLabel = statusLabel(status.state);
  const isConnected = status.state === 'protected' || status.state === 'bypassing-dpi';
  const isBusy = status.state === 'starting' || status.state === 'stopping';
  const connectLabel = isConnected ? 'Disconnect' : isBusy ? connectionLabel : 'Connect';

  useEffect(() => {
    setSavedServers(readServerCache());
  }, []);

  useEffect(() => {
    if (!window.wobb) {
      setMessage('Electron bridge is unavailable.');
      return;
    }

    let removeStatus = () => {};
    let removeLog = () => {};

    async function bootstrap() {
      const currentStatus = await window.wobb.getStatus();
      setStatus(currentStatus);

      removeStatus = window.wobb.onStatusChange((nextStatus) => {
        setStatus(nextStatus);
      });

      removeLog = window.wobb.onLog((entry) => {
        setLogs((current) => [...current, entry].slice(-200));
      });
    }

    bootstrap().catch((error) => {
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

  useEffect(() => {
    const viewport = logsViewportRef.current;
    if (!viewport) {
      return;
    }

    viewport.scrollTop = viewport.scrollHeight;
  }, [logs]);

  const filteredServers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return savedServers;
    }

    return savedServers.filter((item) => {
      const haystack = [item.label, item.note, item.profile?.serverAddress, item.profile?.serverName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [savedServers, searchQuery]);

  async function handleVerify() {
    setLoading(true);
    setMessage('');

    try {
      const resolved = await verifyAccess(accessKey);
      const entry = createServerEntry(accessKey.trim(), resolved);
      const updatedServers = writeServerCache(entry);

      setSavedServers(updatedServers);
      setSelectedServerId(entry.id);
      setProfile(resolved.profile);
      setAccessInfo(resolved.access);
      setExpiry(resolved.expiry);
      setMessage(resolved.fromCache ? 'Loaded cached server profile.' : 'Server profile verified.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Access key verification failed.');
    } finally {
      setLoading(false);
    }
  }

  function handleSelectServer(server) {
    setSelectedServerId(server.id);
    setAccessKey(server.accessKey || '');
    setProfile(server.profile || null);
    setAccessInfo(server.note || server.label ? { title: server.label, note: server.note, status: 'active' } : null);
    setExpiry(server.expiry || null);
    setMessage('');
  }

  async function handleToggleConnection() {
    if (!window.wobb) {
      setMessage('Electron bridge is unavailable.');
      return;
    }

    setLoading(true);
    setMessage('');

    try {
      if (isConnected || status.state === 'starting') {
        await window.wobb.stop();
        setMessage('Disconnected.');
        return;
      }

      let nextProfile = profile;
      let nextAccess = accessInfo;
      let nextExpiry = expiry;

      if (!nextProfile) {
        const resolved = await verifyAccess(accessKey);
        nextProfile = resolved.profile;
        nextAccess = resolved.access;
        nextExpiry = resolved.expiry;

        const entry = createServerEntry(accessKey.trim(), resolved);
        const updatedServers = writeServerCache(entry);
        setSavedServers(updatedServers);
        setSelectedServerId(entry.id);
      }

      setProfile(nextProfile);
      setAccessInfo(nextAccess);
      setExpiry(nextExpiry);

      await window.wobb.start({
        profile: nextProfile,
        stealthMode: false,
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Connection failed.');
    } finally {
      setLoading(false);
    }
  }

  function handleUnavailableMode() {
    setMessage('TUN mode is not available in this build.');
  }

  function scrollTo(ref, nav) {
    setActiveNav(nav);
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const selectedServer = savedServers.find((item) => item.id === selectedServerId) || null;
  const selectedLabel = selectedServer?.label || profile?.serverName || profile?.serverAddress || 'No server selected';

  return (
    <div className="min-h-screen bg-[#060d18] text-slate-100">
      <main className="mx-auto grid min-h-screen max-w-[1460px] grid-cols-[76px_340px_minmax(0,1fr)] gap-0 px-4 py-4">
        <aside className="flex flex-col items-center rounded-l-xl border border-r-0 border-slate-800 bg-[#091120] px-3 py-4">
          <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-lg bg-blue-600 text-sm font-semibold text-white">
            W
          </div>
          <div className="flex w-full flex-1 flex-col gap-2">
            <NavButton icon={Server} label="Servers" onClick={() => scrollTo(serversRef, 'servers')} active={activeNav === 'servers'} />
            <NavButton icon={Power} label="Connect" onClick={() => scrollTo(connectRef, 'connect')} active={activeNav === 'connect'} />
            <NavButton icon={ScrollText} label="Logs" onClick={() => scrollTo(logsSectionRef, 'logs')} active={activeNav === 'logs'} />
            <NavButton icon={Settings} label="Settings" onClick={() => scrollTo(settingsRef, 'settings')} active={activeNav === 'settings'} />
          </div>
        </aside>

        <aside ref={serversRef} className="flex min-h-0 flex-col border border-r-0 border-slate-800 bg-[#0b1323]">
          <div className="border-b border-slate-800 px-5 py-5">
            <h1 className="text-lg font-semibold text-slate-50">Servers</h1>
            <p className="mt-1 text-sm text-slate-400">Verify an access key and keep recent profiles in one place.</p>
          </div>

          <div className="space-y-4 border-b border-slate-800 px-5 py-5">
            <label className="block">
              <span className="mb-2 block text-sm text-slate-300">Access key</span>
              <input
                type="text"
                value={accessKey}
                onChange={(event) => setAccessKey(event.target.value)}
                placeholder="Enter access key"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-blue-500"
              />
            </label>

            <button
              type="button"
              onClick={handleVerify}
              disabled={loading}
              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Verify
            </button>

            <label className="block">
              <span className="mb-2 block text-sm text-slate-300">Search</span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2.5 pl-10 pr-3 text-sm text-slate-100 outline-none transition focus:border-blue-500"
                />
              </div>
            </label>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {filteredServers.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-800 px-4 py-6 text-sm text-slate-500">
                No saved profiles yet.
              </div>
            ) : (
              <div className="space-y-2">
                {filteredServers.map((server) => {
                  const selected = server.id === selectedServerId;

                  return (
                    <button
                      key={server.id}
                      type="button"
                      onClick={() => handleSelectServer(server)}
                      className={`w-full rounded-lg border px-4 py-3 text-left transition ${
                        selected
                          ? 'border-blue-500 bg-blue-500/10'
                          : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-slate-100">{server.label}</div>
                          <div className="mt-1 text-xs text-slate-400">{server.profile.serverAddress}:{server.profile.serverPort}</div>
                        </div>
                        <div className="rounded-md bg-slate-900 px-2 py-1 text-[11px] text-slate-400">
                          {server.profile.security || 'tls'}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        <section className="min-h-0 overflow-y-auto rounded-r-xl border border-slate-800 bg-[#050b15] px-6 py-6">
          <div className="space-y-6">
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-blue-400">Wobb desktop</p>
                <h2 className="mt-2 text-3xl font-semibold text-slate-50">Clean local access</h2>
                <p className="mt-2 max-w-xl text-sm text-slate-400">
                  Verify a profile, review the current runtime state, and connect without extra dashboard noise.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className={`rounded-md border px-3 py-1.5 text-sm ${
                  isConnected
                    ? 'border-blue-500/30 bg-blue-500/10 text-blue-100'
                    : 'border-slate-700 bg-slate-900 text-slate-300'
                }`}>
                  {connectionLabel}
                </div>
                <div className="rounded-md border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm text-slate-300">
                  {clientMode === 'proxy' ? 'Proxy' : 'TUN'}
                </div>
              </div>
            </header>

            <SectionCard
              title="Connect"
              description="Selected server, active mode, and connection control."
              sectionRef={connectRef}
            >
              <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_220px]">
                <div className="space-y-5">
                  <div className="rounded-lg border border-slate-800 bg-slate-950/45 p-5">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Selected server</div>
                    <div className="mt-3 text-2xl font-semibold text-slate-50">{selectedLabel}</div>
                    <div className="mt-2 text-sm text-slate-400">
                      {profile ? `${profile.serverAddress}:${profile.serverPort}` : 'Verify an access key to load a server profile.'}
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Profile</div>
                      <div className="mt-2 text-sm text-slate-100">{profile?.serverName || 'Not loaded'}</div>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Endpoint</div>
                      <div className="mt-2 text-sm text-slate-100">{profile ? `${profile.serverAddress}:${profile.serverPort}` : 'Not loaded'}</div>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Binary</div>
                      <div className="mt-2 text-sm text-slate-100">{status.binaryPath || 'Not resolved yet'}</div>
                    </div>
                  </div>

                  {message ? (
                    <div className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-300">
                      {message}
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-col gap-4">
                  <button
                    type="button"
                    onClick={handleToggleConnection}
                    disabled={loading || status.state === 'stopping'}
                    className="h-12 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {connectLabel}
                  </button>

                  <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Runtime</div>
                    <div className="mt-3 space-y-2 text-sm text-slate-300">
                      <div>PID: {status.pid || 'Not running'}</div>
                      <div>Config: {status.configPath || 'stdin:'}</div>
                    </div>
                  </div>
                </div>
              </div>
            </SectionCard>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
              <SectionCard title="Plan" description="Current access profile.">
                <DetailRow label="Status" value={accessInfo?.status || 'Unknown'} />
                <DetailRow label="Label" value={accessInfo?.title || 'Not loaded'} />
                <DetailRow label="Notes" value={accessInfo?.note || 'None'} />
                <DetailRow label="Expiry" value={formatExpiry(expiry)} />
              </SectionCard>

              <SectionCard
                title="Settings"
                description="Mode selection and local runtime details."
                sectionRef={settingsRef}
              >
                <div className="space-y-4">
                  <div className="flex rounded-lg border border-slate-800 bg-slate-900 p-1">
                    <button
                      type="button"
                      className="flex-1 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white"
                    >
                      Proxy
                    </button>
                    <button
                      type="button"
                      onClick={handleUnavailableMode}
                      className="flex-1 rounded-md px-3 py-2 text-sm text-slate-400"
                    >
                      TUN
                    </button>
                  </div>

                  <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
                      <Shield className="h-4 w-4 text-blue-400" />
                      Local runtime
                    </div>
                    <div className="mt-3 space-y-2 text-sm text-slate-400">
                      <div>Binary: {status.binaryPath || 'Not resolved yet'}</div>
                      <div>PID: {status.pid || 'Not running'}</div>
                    </div>
                  </div>
                </div>
              </SectionCard>
            </div>

            <SectionCard title="Logs" description="Desktop process logs." sectionRef={logsSectionRef}>
              <div
                className="h-72 overflow-y-auto rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3"
                ref={logsViewportRef}
              >
                {logs.length === 0 ? (
                  <div className="text-sm text-slate-500">No logs yet.</div>
                ) : (
                  <div className="space-y-3">
                    {logs.map((entry) => (
                      <div key={entry.id} className="border-b border-slate-850 pb-3 last:border-b-0">
                        <div className="text-xs text-slate-500">
                          {entry.timestamp.slice(11, 19)} {entry.stream}
                        </div>
                        <div className={`mt-1 text-sm ${
                          entry.level === 'error'
                            ? 'text-rose-300'
                            : entry.level === 'warn'
                              ? 'text-slate-300'
                              : 'text-slate-200'
                        }`}>
                          {entry.message}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </SectionCard>
          </div>
        </section>
      </main>
    </div>
  );
}
