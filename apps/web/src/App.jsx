import React, { useEffect, useMemo, useRef, useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3000';
const VERIFY_ENDPOINT = `${API_BASE_URL}/api/v1/verify`;
const PROFILE_CACHE_KEY = 'wobb.desktop.profile.v1';

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
      return 'Connected';
    case 'bypassing-dpi':
      return 'Connected (Stealth)';
    case 'stopping':
      return 'Disconnecting';
    default:
      return 'Disconnected';
  }
}

function statusTone(state) {
  if (state === 'protected' || state === 'bypassing-dpi') {
    return 'success';
  }

  if (state === 'starting' || state === 'stopping') {
    return 'warning';
  }

  return 'neutral';
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

function toneClass(tone) {
  switch (tone) {
    case 'success':
      return 'bg-emerald-500/12 text-emerald-200 border-emerald-400/20';
    case 'warning':
      return 'bg-amber-500/12 text-amber-200 border-amber-400/20';
    default:
      return 'bg-slate-700/50 text-slate-200 border-slate-600';
  }
}

function Card({ title, description, children, aside }) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/80 p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-100">{title}</h2>
          {description ? <p className="mt-1 text-sm text-slate-400">{description}</p> : null}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-slate-800 py-3 first:border-t-0 first:pt-0 last:pb-0">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="max-w-[60%] text-right text-sm text-slate-100">{value}</span>
    </div>
  );
}

export default function App() {
  const [accessKey, setAccessKey] = useState('');
  const [stealthMode, setStealthMode] = useState(false);
  const [status, setStatus] = useState(INITIAL_STATUS);
  const [logs, setLogs] = useState([]);
  const [profile, setProfile] = useState(null);
  const [accessInfo, setAccessInfo] = useState(null);
  const [expiry, setExpiry] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const logViewportRef = useRef(null);

  const connectionTone = statusTone(status.state);
  const connectLabel =
    status.state === 'protected' || status.state === 'bypassing-dpi'
      ? 'Disconnect'
      : status.state === 'starting'
        ? 'Connecting'
        : status.state === 'stopping'
          ? 'Disconnecting'
          : 'Connect';

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
    const viewport = logViewportRef.current;
    if (!viewport) {
      return;
    }

    viewport.scrollTop = viewport.scrollHeight;
  }, [logs]);

  const profileSummary = useMemo(() => {
    if (!profile) {
      return 'No profile loaded';
    }

    return `${profile.serverAddress}:${profile.serverPort}`;
  }, [profile]);

  async function handleVerify() {
    setLoading(true);
    setMessage('');

    try {
      const resolved = await verifyAccess(accessKey);
      setProfile(resolved.profile);
      setAccessInfo(resolved.access);
      setExpiry(resolved.expiry);
      setMessage(resolved.fromCache ? 'Loaded cached profile because the backend is unreachable.' : 'Access key verified.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Access key verification failed.');
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleConnection() {
    if (!window.wobb) {
      setMessage('Electron bridge is unavailable.');
      return;
    }

    setLoading(true);
    setMessage('');

    try {
      if (status.state === 'protected' || status.state === 'bypassing-dpi' || status.state === 'starting') {
        await window.wobb.stop();
        setMessage('Connection stopped.');
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
        setProfile(nextProfile);
        setAccessInfo(nextAccess);
        setExpiry(nextExpiry);
      }

      await window.wobb.start({
        profile: nextProfile,
        stealthMode,
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Connection failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-8">
        <header className="flex flex-col gap-3 border-b border-slate-800 pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-50">Wobb</h1>
            <p className="mt-1 text-sm text-slate-400">Desktop connection utility</p>
          </div>
          <div className={`inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium ${toneClass(connectionTone)}`}>
            {statusLabel(status.state)}
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="grid gap-6">
            <Card title="Connection" description="Current engine state and connect control.">
              <div className="space-y-4">
                <div>
                  <div className="text-3xl font-semibold text-slate-50">{statusLabel(status.state)}</div>
                  <div className="mt-1 text-sm text-slate-400">{profileSummary}</div>
                </div>

                <button
                  type="button"
                  onClick={handleToggleConnection}
                  disabled={loading || status.state === 'stopping'}
                  className="w-full rounded-md bg-blue-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {connectLabel}
                </button>

                {message ? <div className="rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300">{message}</div> : null}
              </div>
            </Card>

            <Card title="Access" description="Verify an access key before connecting.">
              <div className="space-y-4">
                <label className="block">
                  <span className="mb-2 block text-sm text-slate-300">Access key</span>
                  <input
                    type="text"
                    value={accessKey}
                    onChange={(event) => setAccessKey(event.target.value)}
                    placeholder="Enter access key"
                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-blue-500"
                  />
                </label>

                <label className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-950 px-3 py-3">
                  <span className="text-sm text-slate-300">Stealth mode</span>
                  <input
                    type="checkbox"
                    checked={stealthMode}
                    onChange={(event) => setStealthMode(event.target.checked)}
                    className="h-4 w-4 accent-blue-600"
                  />
                </label>

                <button
                  type="button"
                  onClick={handleVerify}
                  disabled={loading}
                  className="w-full rounded-md border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-100 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Verify access
                </button>
              </div>
            </Card>
          </div>

          <div className="grid gap-6">
            <Card title="Profile" description="Resolved connection profile from the backend.">
              {profile ? (
                <div>
                  <DetailRow label="Server" value={profile.serverAddress} />
                  <DetailRow label="Port" value={String(profile.serverPort)} />
                  <DetailRow label="Security" value={profile.security || 'tls'} />
                  <DetailRow label="Server name" value={profile.serverName || '-'} />
                  <DetailRow label="Mode" value={stealthMode ? 'Stealth' : 'Standard'} />
                </div>
              ) : (
                <p className="text-sm text-slate-400">No access key has been verified yet.</p>
              )}
            </Card>

            <Card title="Plan" description="What the current access key provides.">
              <div>
                <DetailRow label="Status" value={accessInfo?.status || 'Unknown'} />
                <DetailRow label="Label" value={accessInfo?.title || 'Not loaded'} />
                <DetailRow label="Notes" value={accessInfo?.note || 'None'} />
                <DetailRow label="Expiry" value={formatExpiry(expiry)} />
              </div>
            </Card>

            <Card title="Diagnostics" description="Local desktop process logs.">
              <div
                ref={logViewportRef}
                className="h-72 overflow-y-auto rounded-md border border-slate-800 bg-slate-950 px-3 py-2"
              >
                {logs.length === 0 ? (
                  <div className="text-sm text-slate-500">No logs yet.</div>
                ) : (
                  <div className="space-y-2">
                    {logs.map((entry) => (
                      <div key={entry.id} className="border-b border-slate-900 pb-2 last:border-b-0">
                        <div className="text-xs text-slate-500">
                          {entry.timestamp.slice(11, 19)} {entry.stream}
                        </div>
                        <div className={`text-sm ${entry.level === 'error' ? 'text-rose-300' : entry.level === 'warn' ? 'text-amber-200' : 'text-slate-200'}`}>
                          {entry.message}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </div>
        </section>
      </main>
    </div>
  );
}
