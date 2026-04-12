import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  KeyRound,
  MapPin,
  Power,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  TriangleAlert,
  Wifi,
} from 'lucide-react';

const BOOT_TEXT = 'Wobb Neural Link Initializing...';
const BOOT_DURATION_MS = 2000;
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const AUTH_ENDPOINT = `${API_BASE_URL}/api/v1/verify`;
const PROFILE_CACHE_KEY = 'wobb.cachedProfile.v1';

const STATUS_META = {
  ready: {
    label: 'Ready',
    chip: 'border-red-400/20 bg-red-500/10 text-red-200',
    accent: 'text-red-300',
    button: 'border-red-400/45 bg-red-500/8 shadow-[0_0_45px_rgba(248,113,113,0.22)]',
    pulse: 'border-red-300/20',
    core: 'border-red-400/20 bg-red-500/10 text-red-200',
    hint: 'Enter a valid access key to initialize protected routing.',
  },
  starting: {
    label: 'Connecting...',
    chip: 'border-amber-400/25 bg-amber-500/12 text-amber-200',
    accent: 'text-amber-300',
    button: 'border-amber-400/60 bg-amber-500/10 shadow-[0_0_60px_rgba(251,191,36,0.28)]',
    pulse: 'border-amber-300/25',
    core: 'border-amber-400/25 bg-amber-500/10 text-amber-200',
    hint: 'Authorizing the key and preparing secure transport.',
  },
  protected: {
    label: 'Protected',
    chip: 'border-emerald-400/25 bg-emerald-500/12 text-emerald-200',
    accent: 'text-emerald-300',
    button: 'border-emerald-400/60 bg-emerald-500/10 shadow-[0_0_70px_rgba(16,185,129,0.36)]',
    pulse: 'border-emerald-300/25',
    core: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200',
    hint: 'Protected route is active and ready for traffic.',
  },
  'bypassing-dpi': {
    label: 'Bypassing DPI',
    chip: 'border-emerald-400/25 bg-emerald-500/12 text-emerald-200',
    accent: 'text-emerald-300',
    button: 'border-emerald-400/60 bg-emerald-500/10 shadow-[0_0_80px_rgba(16,185,129,0.40)]',
    pulse: 'border-emerald-300/30',
    core: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200',
    hint: 'Stealth fragmentation is active on the protected route.',
  },
  stopping: {
    label: 'Stopping...',
    chip: 'border-slate-300/20 bg-white/5 text-slate-300',
    accent: 'text-slate-300',
    button: 'border-slate-300/25 bg-white/5 shadow-[0_0_35px_rgba(148,163,184,0.18)]',
    pulse: 'border-slate-300/15',
    core: 'border-slate-300/20 bg-white/5 text-slate-300',
    hint: 'Shutting down the active route cleanly.',
  },
};

const INITIAL_STATUS = {
  state: 'ready',
  pid: null,
  binaryPath: null,
  configPath: 'stdin:',
  stealthMode: false,
  error: null,
};

const INITIAL_TELEMETRY = {
  downloadMbps: 0,
  uploadMbps: 0,
  downloadSeries: [8, 12, 10, 16, 14, 18, 15, 20, 18, 16],
  uploadSeries: [5, 7, 6, 8, 7, 9, 8, 10, 8, 7],
};

/**
 * Returns a derived server badge for the active route.
 *
 * @param {object|null} profile
 * @returns {{flag: string, city: string, region: string}}
 */
function getServerBadge(profile) {
  if (!profile?.serverAddress) {
    return {
      flag: 'NET',
      city: 'Awaiting Route',
      region: 'No endpoint resolved',
    };
  }

  return {
    flag: 'DE',
    city: 'Frankfurt',
    region: profile.serverAddress,
  };
}

/**
 * Writes a verified profile to localStorage for offline fallback.
 *
 * @param {string} key
 * @param {object} profile
 * @returns {void}
 */
function writeCachedProfile(key, profile) {
  try {
    window.localStorage.setItem(
      PROFILE_CACHE_KEY,
      JSON.stringify({
        key,
        profile,
        cachedAt: new Date().toISOString(),
      })
    );
  } catch (error) {
    // Ignore cache write failures.
  }
}

/**
 * Reads a cached profile for a matching access key.
 *
 * @param {string} key
 * @returns {object|null}
 */
function readCachedProfile(key) {
  try {
    const raw = window.localStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || parsed.key !== key || !parsed.profile) {
      return null;
    }

    return parsed.profile;
  } catch (error) {
    return null;
  }
}

/**
 * Fetches a live config from the authentication backend with cache fallback.
 *
 * @param {string} key
 * @returns {Promise<{profile: object, fromCache: boolean}>}
 */
async function resolveKey(key) {
  const normalizedKey = key.trim();

  if (!normalizedKey) {
    throw new Error('Valid Access Key Required');
  }

  try {
    const response = await fetch(AUTH_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key: normalizedKey }),
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error('Authentication service returned an invalid response.');
    }

    if (!response.ok || !payload?.success || !payload?.config) {
      throw new Error(payload?.message || 'Invalid or expired key');
    }

    const profile = {
      serverAddress: payload.config.serverAddress,
      serverPort: payload.config.port,
      uuid: payload.config.uuid,
      serverName: payload.config.sni || payload.config.serverAddress,
      security: payload.config.security || 'tls',
      network: 'tcp',
      expiry: payload.expiry || null,
    };

    writeCachedProfile(normalizedKey, profile);

    return {
      profile,
      fromCache: false,
    };
  } catch (error) {
    if (error instanceof TypeError) {
      const cachedProfile = readCachedProfile(normalizedKey);
      if (cachedProfile) {
        return {
          profile: cachedProfile,
          fromCache: true,
        };
      }
    }

    throw error;
  }
}

/**
 * Measures approximate latency to the active route endpoint.
 *
 * @param {string} serverAddress
 * @returns {Promise<number|null>}
 */
async function measureLatency(serverAddress) {
  if (!serverAddress) {
    return null;
  }

  const target = /^https?:\/\//i.test(serverAddress)
    ? serverAddress
    : `https://${serverAddress}`;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 4000);
  const startedAt = performance.now();

  try {
    await fetch(`${target.replace(/\/$/, '')}/?latency=${Date.now()}`, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    });

    return Math.round(performance.now() - startedAt);
  } catch (error) {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

/**
 * Returns the UI tone for a latency badge.
 *
 * @param {number|null} latencyMs
 * @returns {string}
 */
function getLatencyTone(latencyMs) {
  if (latencyMs == null) {
    return 'border-white/10 bg-white/5 text-slate-300';
  }

  if (latencyMs < 100) {
    return 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200';
  }

  if (latencyMs <= 300) {
    return 'border-amber-400/20 bg-amber-500/10 text-amber-200';
  }

  return 'border-rose-400/20 bg-rose-500/10 text-rose-200';
}

/**
 * Creates the next mock throughput frame.
 *
 * @param {typeof INITIAL_TELEMETRY} current
 * @param {boolean} isRunning
 * @returns {typeof INITIAL_TELEMETRY}
 */
function nextTelemetryFrame(current, isRunning) {
  const nextDownload = isRunning ? Number((6 + Math.random() * 85).toFixed(1)) : 0;
  const nextUpload = isRunning ? Number((2 + Math.random() * 28).toFixed(1)) : 0;
  const rotate = (series, nextValue) => [...series.slice(1), nextValue];

  return {
    downloadMbps: nextDownload,
    uploadMbps: nextUpload,
    downloadSeries: rotate(current.downloadSeries, nextDownload),
    uploadSeries: rotate(current.uploadSeries, nextUpload),
  };
}

/**
 * Renders a lightweight toast stack.
 *
 * @param {{toasts: Array<{id: string, message: string}>}} props
 * @returns {JSX.Element}
 */
function ToastStack({ toasts }) {
  return (
    <div className="fixed right-5 top-5 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-3">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="toast-enter flex items-start gap-3 rounded-2xl border border-rose-400/20 bg-black/70 px-4 py-3 text-sm text-slate-100 shadow-[0_10px_30px_rgba(0,0,0,0.28)] backdrop-blur-xl"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Renders the boot splash with a typewriter effect.
 *
 * @param {{bootText: string}} props
 * @returns {JSX.Element}
 */
function BootOverlay({ bootText }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#09090b]/96 backdrop-blur-md">
      <div className="relative w-[min(540px,calc(100vw-2rem))] overflow-hidden rounded-[28px] border border-blue-400/18 bg-black/65 px-8 py-10 text-center shadow-[0_0_80px_rgba(59,130,246,0.12)]">
        <div className="boot-scan-line absolute inset-x-0 top-0 h-12 bg-[linear-gradient(180deg,transparent,rgba(59,130,246,0.18),transparent)]" />
        <p className="font-mono text-[11px] uppercase tracking-[0.5em] text-blue-300">
          WOBB CONTROL MATRIX
        </p>
        <h2 className="mt-4 min-h-[2.5rem] text-3xl font-semibold text-white">{bootText}</h2>
        <p className="mt-3 text-sm text-slate-400">
          Preparing interface layers, telemetry channels, and protection controls.
        </p>
        <div className="mt-7 h-2 overflow-hidden rounded-full bg-white/6">
          <div className="h-full w-full origin-left animate-[pulse_1.1s_ease-in-out_infinite] rounded-full bg-[linear-gradient(90deg,rgba(59,130,246,0.0),rgba(59,130,246,0.95),rgba(16,185,129,0.85))]" />
        </div>
      </div>
    </div>
  );
}

/**
 * Renders the animated power button card.
 *
 * @param {object} props
 * @returns {JSX.Element}
 */
function PowerPanel({
  heroStatus,
  hint,
  isRunning,
  latencyMs,
  loading,
  status,
  statusMeta,
  onToggle,
}) {
  return (
    <div className="rounded-[32px] border border-white/10 bg-black/35 p-6 backdrop-blur-xl">
      <div className="flex flex-col items-center rounded-[28px] border border-blue-400/10 bg-slate-950/65 px-6 py-9 text-center">
        <button
          type="button"
          onClick={onToggle}
          disabled={loading || status.state === 'stopping'}
          className={`group relative flex h-60 w-60 items-center justify-center rounded-full border transition duration-300 ease-out hover:scale-[1.03] ${statusMeta.button} disabled:cursor-not-allowed disabled:opacity-60`}
        >
          <span
            className={`absolute inset-0 rounded-full bg-[conic-gradient(from_90deg_at_50%_50%,rgba(59,130,246,0.30),rgba(16,185,129,0.18),rgba(248,113,113,0.18),rgba(59,130,246,0.30))] blur-xl transition duration-300 group-hover:scale-105 ${
              status.state === 'protected' || status.state === 'bypassing-dpi'
                ? 'wobb-breathe opacity-100'
                : 'opacity-85'
            }`}
          />
          <span
            className={`absolute inset-3 rounded-full border ${statusMeta.pulse} ${
              status.state === 'protected' || status.state === 'bypassing-dpi'
                ? 'wobb-breathe'
                : status.state === 'starting'
                  ? 'animate-[ping_1.8s_ease-in-out_infinite]'
                  : ''
            }`}
          />
          <span className="absolute inset-8 rounded-full border border-white/8 bg-slate-950/90" />
          <span className="relative flex flex-col items-center">
            <span className="text-4xl font-semibold leading-none tracking-[0.45em] text-white">PWR</span>
            <span
              className={`mt-5 flex h-20 w-20 items-center justify-center rounded-[28px] border ${statusMeta.core} shadow-lg shadow-black/30 transition`}
            >
              <Power className="h-10 w-10" />
            </span>
            <span className="mt-5 font-mono text-[11px] uppercase tracking-[0.4em] text-slate-400">
              {isRunning ? 'Deactivate' : loading ? 'Authorizing' : 'Activate'}
            </span>
          </span>
        </button>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <p className="text-3xl font-semibold tracking-tight text-white transition">{heroStatus}</p>
          {(status.state === 'protected' || status.state === 'bypassing-dpi') && (
            <span className={`rounded-full border px-3 py-1 text-xs font-medium ${getLatencyTone(latencyMs)}`}>
              {latencyMs == null ? 'Latency unavailable' : `${latencyMs} ms`}
            </span>
          )}
        </div>
        <p className="mt-3 max-w-sm text-sm text-slate-400">{hint}</p>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-500">Process</p>
          <p className="mt-2 text-sm text-slate-200">{status.pid || 'Idle'}</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-500">Route Mode</p>
          <p className="mt-2 text-sm text-slate-200">{status.stealthMode ? 'Stealth' : 'Standard'}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Renders the authorization and stealth cards.
 *
 * @param {object} props
 * @returns {JSX.Element}
 */
function ProfilePanel({ accessKey, loading, stealthMode, onAccessKeyChange, onStealthChange, status }) {
  return (
    <div className="grid gap-6">
      <section className="rounded-[32px] border border-white/10 bg-black/35 p-6 backdrop-blur-xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-blue-300">
              Connection Profile
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Access Authorization</h2>
          </div>
          <KeyRound className="h-5 w-5 text-blue-300" />
        </div>

        <label className="block">
          <span className="mb-2 block text-sm text-slate-300">Access Key</span>
          <input
            type="text"
            value={accessKey}
            onChange={(event) => onAccessKeyChange(event.target.value)}
            placeholder="Enter your Wobb access key"
            className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-4 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-blue-400/50 focus:ring-2 focus:ring-blue-400/20"
          />
        </label>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-400">
          <div className="rounded-full border border-white/10 bg-slate-950/55 px-3 py-1">
            Endpoint: <span className="font-mono text-blue-300">{AUTH_ENDPOINT}</span>
          </div>
          {loading && (
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/15 bg-amber-500/10 px-3 py-1 text-amber-200">
              <Wifi className="h-3.5 w-3.5" />
              Verifying key
            </div>
          )}
        </div>
      </section>

      <section className="rounded-[32px] border border-white/10 bg-black/35 p-6 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-emerald-300">
              Stealth Routing
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Anti-DPI Toggle</h2>
            <p className="mt-2 text-sm text-slate-400">
              Route traffic through fragmentation when hostile DPI paths are expected.
            </p>
          </div>

          <Sparkles className="h-5 w-5 text-emerald-300" />
        </div>

        <div className="mt-6 flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/60 p-4">
          <div className="pr-4">
            <p className="text-sm font-medium text-slate-100">
              {stealthMode ? 'Stealth Mode Enabled' : 'Stealth Mode Disabled'}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {stealthMode
                ? 'Fragmentation profile will be applied on connect.'
                : 'Standard protected route without fragmentation.'}
            </p>
          </div>

          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              checked={stealthMode}
              onChange={(event) => onStealthChange(event.target.checked)}
              className="peer sr-only"
            />
            <span className="h-8 w-14 rounded-full border border-white/10 bg-slate-800 transition peer-checked:bg-emerald-500/85" />
            <span className="pointer-events-none absolute left-1 top-1 h-6 w-6 rounded-full bg-white shadow transition peer-checked:translate-x-6" />
          </label>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-500">Core Path</p>
            <p className="mt-2 truncate text-sm text-slate-200">{status.binaryPath || 'Pending resolution'}</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-500">Security</p>
            <p className="mt-2 flex items-center gap-2 text-sm text-slate-200">
              {status.state === 'protected' || status.state === 'bypassing-dpi' ? (
                <>
                  <ShieldCheck className="h-4 w-4 text-emerald-300" />
                  Active
                </>
              ) : (
                <>
                  <ShieldOff className="h-4 w-4 text-slate-400" />
                  Standby
                </>
              )}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * Renders telemetry cards with animated mock data.
 *
 * @param {object} props
 * @returns {JSX.Element}
 */
function TelemetryPanel({ telemetry, serverBadge }) {
  return (
    <section className="rounded-[32px] border border-white/10 bg-black/35 p-6 backdrop-blur-xl">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-blue-300">Telemetry</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Live Throughput</h2>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/55 px-3 py-1 text-xs text-slate-300">
          <MapPin className="h-3.5 w-3.5 text-blue-300" />
          {serverBadge.flag} {serverBadge.city}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
          <div className="flex items-center justify-between">
            <div className="inline-flex items-center gap-2 text-sm text-slate-200">
              <ArrowDownLeft className="h-4 w-4 text-blue-300" />
              Download
            </div>
            <span className="font-mono text-sm text-blue-300">{telemetry.downloadMbps.toFixed(1)} Mbps</span>
          </div>
          <div className="mt-4 flex h-12 items-end gap-1">
            {telemetry.downloadSeries.map((value, index) => (
              <span
                key={`down-${index}`}
                className="flex-1 rounded-t bg-gradient-to-t from-blue-600/40 to-blue-300/90 transition-all duration-500"
                style={{ height: `${Math.max(12, value)}%` }}
              />
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
          <div className="flex items-center justify-between">
            <div className="inline-flex items-center gap-2 text-sm text-slate-200">
              <ArrowUpRight className="h-4 w-4 text-emerald-300" />
              Upload
            </div>
            <span className="font-mono text-sm text-emerald-300">{telemetry.uploadMbps.toFixed(1)} Mbps</span>
          </div>
          <div className="mt-4 flex h-12 items-end gap-1">
            {telemetry.uploadSeries.map((value, index) => (
              <span
                key={`up-${index}`}
                className="flex-1 rounded-t bg-gradient-to-t from-emerald-600/35 to-emerald-300/85 transition-all duration-500"
                style={{ height: `${Math.max(10, value * 1.6)}%` }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 text-sm text-slate-400">
        Endpoint: <span className="text-slate-200">{serverBadge.region}</span>
      </div>
    </section>
  );
}

/**
 * Renders the log console.
 *
 * @param {object} props
 * @returns {JSX.Element}
 */
function LogConsole({ consoleOpen, logs, onToggle, viewportRef }) {
  return (
    <section className="rounded-[32px] border border-white/10 bg-black/35 backdrop-blur-xl">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-6 py-5 text-left"
      >
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-blue-300">
            Live Process Log
          </p>
          <p className="mt-2 text-sm text-slate-400">
            Scrubbed runtime telemetry from the protected engine process.
          </p>
        </div>

        <div className="flex items-center gap-3 text-slate-400">
          <span className="text-xs uppercase tracking-[0.25em]">{consoleOpen ? 'Collapse' : 'Expand'}</span>
          {consoleOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </div>
      </button>

      {consoleOpen && (
        <div className="border-t border-white/8 px-6 pb-6">
          <div
            ref={viewportRef}
            className="matrix-console mt-6 h-72 overflow-y-auto rounded-[24px] border border-white/10 bg-black/35 p-4 text-xs leading-6 text-slate-200 shadow-inner shadow-black/40 backdrop-blur-xl"
          >
            {logs.length === 0 ? (
              <div className="flex h-full items-center justify-center text-slate-500">
                Protected runtime logs will stream here.
              </div>
            ) : (
              logs.map((entry) => (
                <div key={entry.id} className="border-b border-white/5 py-1 last:border-b-0">
                  <span className="mr-3 text-slate-500">{entry.timestamp.slice(11, 19)}</span>
                  <span
                    className={
                      entry.level === 'error'
                        ? 'text-rose-300'
                        : entry.stream === 'engine'
                          ? 'text-blue-300'
                          : 'text-slate-300'
                    }
                  >
                    [{entry.stream}] {entry.message}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function App() {
  const [accessKey, setAccessKey] = useState('');
  const [stealthMode, setStealthMode] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(true);
  const [booting, setBooting] = useState(true);
  const [bootText, setBootText] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(INITIAL_STATUS);
  const [logs, setLogs] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [activeProfile, setActiveProfile] = useState(null);
  const [latencyMs, setLatencyMs] = useState(null);
  const [telemetry, setTelemetry] = useState(INITIAL_TELEMETRY);
  const logViewportRef = useRef(null);

  const stateKey = STATUS_META[status.state] ? status.state : 'ready';
  const statusMeta = STATUS_META[stateKey];
  const isRunning =
    status.state === 'protected' ||
    status.state === 'bypassing-dpi' ||
    status.state === 'starting';

  useEffect(() => {
    const startedAt = Date.now();
    let index = 0;

    const typeTimer = setInterval(() => {
      index += 1;
      setBootText(BOOT_TEXT.slice(0, index));

      if (index >= BOOT_TEXT.length) {
        clearInterval(typeTimer);
      }
    }, 70);

    const hideTimer = setTimeout(() => {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= BOOT_DURATION_MS) {
        setBooting(false);
      }
    }, BOOT_DURATION_MS);

    return () => {
      clearInterval(typeTimer);
      clearTimeout(hideTimer);
    };
  }, []);

  useEffect(() => {
    let unsubscribeStatus = () => {};
    let unsubscribeLog = () => {};

    /**
     * Subscribes to the secure bridge and hydrates initial state.
     *
     * @returns {Promise<void>}
     */
    async function bootstrap() {
      if (!window.wobb) {
        pushToast('Secure bridge unavailable.');
        return;
      }

      const currentStatus = await window.wobb.getStatus();
      setStatus(currentStatus);
      setStealthMode(Boolean(currentStatus.stealthMode));

      unsubscribeStatus = window.wobb.onStatusChange((nextStatus) => {
        setStatus(nextStatus);
        setStealthMode(Boolean(nextStatus.stealthMode));
      });

      unsubscribeLog = window.wobb.onLog((entry) => {
        setLogs((current) => [...current, entry].slice(-500));
      });
    }

    bootstrap().catch((error) => {
      pushToast(error.message);
    });

    return () => {
      unsubscribeStatus();
      unsubscribeLog();
    };
  }, []);

  useEffect(() => {
    if (!status.error) {
      return;
    }

    pushToast(status.error);
  }, [status.error]);

  useEffect(() => {
    const viewport = logViewportRef.current;
    if (!viewport || !consoleOpen) {
      return;
    }

    viewport.scrollTop = viewport.scrollHeight;
  }, [logs, consoleOpen]);

  useEffect(() => {
    const interval = setInterval(() => {
      setTelemetry((current) => nextTelemetryFrame(current, isRunning));
    }, 1200);

    return () => clearInterval(interval);
  }, [isRunning]);

  const heroStatus = useMemo(() => {
    if (status.state === 'bypassing-dpi') {
      return 'Bypassing DPI';
    }

    if (status.state === 'protected') {
      return 'Protected';
    }

    if (status.state === 'starting') {
      return stealthMode ? 'Bypassing DPI' : 'Connecting';
    }

    return 'Ready';
  }, [status.state, stealthMode]);

  const serverBadge = useMemo(() => getServerBadge(activeProfile), [activeProfile]);

  useEffect(() => {
    if (
      !activeProfile?.serverAddress ||
      (status.state !== 'protected' && status.state !== 'bypassing-dpi')
    ) {
      setLatencyMs(null);
      return;
    }

    let cancelled = false;

    measureLatency(activeProfile.serverAddress).then((value) => {
      if (!cancelled) {
        setLatencyMs(value);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeProfile, status.state]);

  /**
   * Pushes a toast into the visible stack.
   *
   * @param {string} message
   * @returns {void}
   */
  function pushToast(message) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((current) => [...current, { id, message }].slice(-4));

    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3600);
  }

  /**
   * Starts or stops the engine based on the current route state.
   *
   * @returns {Promise<void>}
   */
  async function handleToggle() {
    if (!window.wobb) {
      pushToast('Secure bridge unavailable.');
      return;
    }

    if (loading) {
      return;
    }

    setLoading(true);

    try {
      if (isRunning) {
        await window.wobb.stop();
        setLatencyMs(null);
      } else {
        const { profile, fromCache } = await resolveKey(accessKey);
        setActiveProfile(profile);

        if (fromCache) {
          pushToast('Server unreachable. Using cached profile.');
        }

        await window.wobb.start({
          profile,
          stealthMode,
        });
      }
    } catch (error) {
      pushToast(error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen overflow-hidden bg-[#09090b] text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.16),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.12),transparent_28%),linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:auto,auto,36px_36px,36px_36px]" />
        <div className="absolute left-[-7rem] top-[-8rem] h-72 w-72 rounded-full bg-blue-500/18 blur-3xl" />
        <div className="absolute right-[-5rem] top-28 h-80 w-80 rounded-full bg-emerald-500/12 blur-3xl" />
        <div className="absolute bottom-[-8rem] left-1/3 h-80 w-80 rounded-full bg-blue-400/10 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(9,9,11,0.18),rgba(9,9,11,0.72))]" />
      </div>

      <ToastStack toasts={toasts} />
      {booting && <BootOverlay bootText={bootText} />}

      <main className="relative mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-6 py-8 lg:px-10">
        <header className="rounded-[30px] border border-white/10 bg-black/35 px-7 py-6 backdrop-blur-xl">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.45em] text-blue-300">
                WOBB CONTROL MATRIX
              </p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white">
                Wobb Protection Console
              </h1>
              <p className="mt-3 max-w-2xl text-sm text-slate-400">
                Subscription-ready access control, protected route management, and scrubbed engine
                telemetry in one hardened interface.
              </p>
            </div>

            <div
              className={`inline-flex items-center gap-3 rounded-full border px-4 py-2 text-sm font-medium backdrop-blur-sm transition ${statusMeta.chip}`}
            >
              <Activity className={`h-4 w-4 ${statusMeta.accent}`} />
              {heroStatus}
            </div>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[430px_minmax(0,1fr)]">
          <PowerPanel
          heroStatus={heroStatus}
          hint={statusMeta.hint}
          isRunning={isRunning}
          latencyMs={latencyMs}
          loading={loading}
          status={status}
          statusMeta={statusMeta}
            onToggle={handleToggle}
          />

          <ProfilePanel
            accessKey={accessKey}
            loading={loading}
            stealthMode={stealthMode}
            onAccessKeyChange={setAccessKey}
            onStealthChange={setStealthMode}
            status={status}
          />
        </section>

        <TelemetryPanel telemetry={telemetry} serverBadge={serverBadge} />
        <LogConsole
          consoleOpen={consoleOpen}
          logs={logs}
          onToggle={() => setConsoleOpen((current) => !current)}
          viewportRef={logViewportRef}
        />
      </main>
    </div>
  );
}

export default App;
