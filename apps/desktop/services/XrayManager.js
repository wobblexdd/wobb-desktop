const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');

class XrayManager extends EventEmitter {
  constructor(options = {}) {
    super();

    this.logger = options.logger || console;
    this.platform = options.platform || process.platform;
    this.binaryName = options.binaryName || XrayManager.getBinaryName(this.platform);
    this.binaryPath = options.binaryPath || null;
    this.binRoot = options.binRoot || null;
    this.stopTimeoutMs = options.stopTimeoutMs || 5000;
    this.startupGraceMs = options.startupGraceMs || 1500;
    this.child = null;
    this.manualStop = false;
    this.runtimeDir = null;
    this.wrapperConfigPath = null;
    this.xrayConfigPath = null;
    this.socksPort = 10808;
    this.httpPort = 10809;
  }

  static getPlatformFolder(platform = process.platform) {
    switch (platform) {
      case 'win32':
        return 'win32';
      case 'darwin':
        return 'darwin';
      case 'linux':
        return 'linux';
      default:
        throw new Error(`Unsupported platform for Wobb engine: ${platform}`);
    }
  }

  static getBinaryName(platform = process.platform) {
    return platform === 'win32' ? 'wobb-engine.exe' : 'wobb-engine';
  }

  static createBasicVlessConfig(options = {}, enableStealth = options.stealthMode ?? false) {
    const {
      serverAddress = '',
      serverPort = 443,
      uuid = '',
      localSocksPort = 10808,
      localHttpPort = 10809,
      logLevel = 'warning',
      network = 'tcp',
      security = 'reality',
      serverName = '',
      flow = '',
      fingerprint = 'chrome',
      allowInsecure = false,
      publicKey,
      shortId,
      spiderX = '/',
      wsPath = '/',
      wsHost,
    } = options;

    if (!String(serverAddress || '').trim()) {
      throw new Error('Wobb profile is missing a server address.');
    }

    if (!String(uuid || '').trim()) {
      throw new Error('Wobb profile is missing a UUID.');
    }

    if (!Number.isInteger(Number(serverPort)) || Number(serverPort) < 1 || Number(serverPort) > 65535) {
      throw new Error('Wobb profile has an invalid server port.');
    }

    if (security === 'reality') {
      if (!String(serverName || '').trim()) {
        throw new Error('Wobb profile is missing a REALITY server name.');
      }
      if (!String(publicKey || '').trim()) {
        throw new Error('Wobb profile is missing a REALITY public key.');
      }
      if (!String(shortId || '').trim()) {
        throw new Error('Wobb profile is missing a REALITY short ID.');
      }
    }

    const streamSettings = {
      network,
      security,
    };

    if (enableStealth) {
      streamSettings.sockopt = {
        dialerProxy: 'stealth-fragment',
        tcpKeepAliveInterval: 5,
      };
    }

    if (security === 'tls') {
      streamSettings.tlsSettings = {
        serverName,
        fingerprint,
        allowInsecure,
      };
    }

    if (security === 'reality') {
      streamSettings.realitySettings = {
        serverName,
        fingerprint,
        publicKey: publicKey || '',
        shortId: shortId || '',
        spiderX,
      };
    }

    if (network === 'ws') {
      streamSettings.wsSettings = {
        path: wsPath,
        headers: wsHost ? { Host: wsHost } : {},
      };
    }

    const outbounds = [
      {
        tag: 'proxy',
        protocol: 'vless',
        settings: {
          vnext: [
            {
              address: serverAddress,
              port: Number(serverPort),
              users: [
                {
                  id: uuid,
                  encryption: 'none',
                  flow,
                },
              ],
            },
          ],
        },
        streamSettings,
      },
      {
        tag: 'direct',
        protocol: 'freedom',
        settings: {},
      },
      {
        tag: 'block',
        protocol: 'blackhole',
        settings: {},
      },
    ];

    if (enableStealth) {
      outbounds.splice(1, 0, {
        tag: 'stealth-fragment',
        protocol: 'freedom',
        settings: {
          fragment: {
            packets: 'tlshello',
            length: '20-40',
            interval: '10-20',
          },
        },
      });
    }

    return {
      log: {
        loglevel: logLevel,
      },
      inbounds: [
        {
          tag: 'socks-in',
          listen: '127.0.0.1',
          port: localSocksPort,
          protocol: 'socks',
          settings: {
            auth: 'noauth',
            udp: true,
          },
          sniffing: {
            enabled: true,
            destOverride: ['http', 'tls'],
          },
        },
        {
          tag: 'http-in',
          listen: '127.0.0.1',
          port: localHttpPort,
          protocol: 'http',
          settings: {},
          sniffing: {
            enabled: true,
            destOverride: ['http', 'tls'],
          },
        },
      ],
      outbounds,
      routing: {
        domainStrategy: 'AsIs',
      },
    };
  }

  isRunning() {
    return Boolean(this.child && !this.child.killed);
  }

  getStatus() {
    return {
      running: this.isRunning(),
      pid: this.child ? this.child.pid : null,
      binaryPath: this.binaryPath || null,
      configPath: this.wrapperConfigPath || null,
      xrayConfigPath: this.xrayConfigPath || null,
      socksPort: this.socksPort,
      httpPort: this.httpPort,
    };
  }

  resolveBinaryPath() {
    if (this.binaryPath) {
      this.assertBinaryExists(this.binaryPath);
      return this.binaryPath;
    }

    const platformFolder = XrayManager.getPlatformFolder(this.platform);
    const binaryName = this.binaryName;
    const candidates = new Set();
    const electronAppPath = this.getElectronAppPath();

    if (this.binRoot) {
      candidates.add(path.resolve(this.binRoot, platformFolder, binaryName));
    }

    if (process.resourcesPath) {
      candidates.add(path.resolve(process.resourcesPath, 'bin', platformFolder, binaryName));
      candidates.add(path.resolve(process.resourcesPath, platformFolder, binaryName));
    }

    if (electronAppPath) {
      candidates.add(path.resolve(electronAppPath, 'resources', 'bin', platformFolder, binaryName));
      candidates.add(path.resolve(electronAppPath, 'resources', platformFolder, binaryName));
      candidates.add(path.resolve(electronAppPath, 'bin', platformFolder, binaryName));
    }

    candidates.add(path.resolve(process.cwd(), 'bin', platformFolder, binaryName));
    candidates.add(path.resolve(process.cwd(), 'resources', 'bin', platformFolder, binaryName));
    candidates.add(path.resolve(process.cwd(), 'resources', platformFolder, binaryName));
    candidates.add(path.resolve(__dirname, '..', '..', '..', 'bin', platformFolder, binaryName));
    candidates.add(path.resolve(__dirname, '..', '..', '..', 'resources', 'bin', platformFolder, binaryName));
    candidates.add(path.resolve(__dirname, '..', '..', '..', 'resources', platformFolder, binaryName));

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        this.assertBinaryExists(candidate);
        this.binaryPath = candidate;
        return candidate;
      }
    }

    throw new Error(
      `Wobb engine not found. Expected one of:\n${Array.from(candidates)
        .map((candidate) => `- ${candidate}`)
        .join('\n')}`
    );
  }

  assertBinaryExists(binaryPath) {
    if (!fs.existsSync(binaryPath)) {
      throw new Error(`Wobb engine does not exist: ${binaryPath}`);
    }

    const accessMode =
      this.platform === 'win32'
        ? fs.constants.F_OK
        : fs.constants.F_OK | fs.constants.X_OK;

    fs.accessSync(binaryPath, accessMode);
  }

  createRuntimeFiles(configObject, binaryPath) {
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wobb-runtime-'));
    const xrayConfigPath = path.join(runtimeDir, 'xray-config.json');
    const wrapperConfigPath = path.join(runtimeDir, 'wobb-runtime.json');

    this.socksPort = Number(configObject?.inbounds?.find((entry) => entry?.tag === 'socks-in')?.port || 10808);
    this.httpPort = Number(configObject?.inbounds?.find((entry) => entry?.tag === 'http-in')?.port || 10809);

    fs.writeFileSync(xrayConfigPath, JSON.stringify(configObject, null, 2));
    fs.writeFileSync(
      wrapperConfigPath,
      JSON.stringify(
        {
          mode: 'proxy',
          datDir: path.dirname(binaryPath),
          configPath: xrayConfigPath,
        },
        null,
        2
      )
    );

    this.runtimeDir = runtimeDir;
    this.xrayConfigPath = xrayConfigPath;
    this.wrapperConfigPath = wrapperConfigPath;

    return { runtimeDir, xrayConfigPath, wrapperConfigPath };
  }

  cleanupRuntimeFiles() {
    if (!this.runtimeDir) {
      this.wrapperConfigPath = null;
      this.xrayConfigPath = null;
      return;
    }

    try {
      fs.rmSync(this.runtimeDir, { recursive: true, force: true });
    } catch (error) {
      this.logger.warn?.('[WobbManager] Failed to remove runtime directory:', error);
    } finally {
      this.runtimeDir = null;
      this.wrapperConfigPath = null;
      this.xrayConfigPath = null;
    }
  }

  async startXray(configJson) {
    if (this.isRunning()) {
      throw new Error('Wobb engine is already running.');
    }

    const binaryPath = this.resolveBinaryPath();
    const configObject = this.normalizeConfig(configJson);
    const { wrapperConfigPath } = this.createRuntimeFiles(configObject, binaryPath);
    const args = ['-configPath', wrapperConfigPath];

    this.logger.info?.(`[WobbManager] Starting engine: ${binaryPath} ${args.join(' ')}`);

    this.manualStop = false;

    return await new Promise((resolve, reject) => {
      let startupSettled = false;
      let startupTimer = null;

      const settleResolve = () => {
        if (startupSettled) {
          return;
        }
        startupSettled = true;
        if (startupTimer) {
          clearTimeout(startupTimer);
        }
        this.emit('started', this.getStatus());
        resolve(this.getStatus());
      };

      const settleReject = (error) => {
        if (startupSettled) {
          return;
        }
        startupSettled = true;
        if (startupTimer) {
          clearTimeout(startupTimer);
        }
        reject(error);
      };

      this.child = spawn(binaryPath, args, {
        cwd: path.dirname(binaryPath),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.attachLogStream(this.child.stdout, 'stdout', 'info');
      this.attachLogStream(this.child.stderr, 'stderr', 'warn');

      this.child.once('spawn', () => {
        this.logger.info?.(`[WobbManager] Engine started with PID ${this.child.pid}`);
        this.logger.info?.(`[WobbManager] Local proxies: socks=127.0.0.1:${this.socksPort} http=127.0.0.1:${this.httpPort}`);
        startupTimer = setTimeout(() => {
          if (this.child && !this.child.killed) {
            settleResolve();
          }
        }, this.startupGraceMs);
      });

      this.child.once('error', (error) => {
        this.logger.error?.('[WobbManager] Failed to start engine process:', error);
        this.child = null;
        this.cleanupRuntimeFiles();
        this.emit('error', error);
        settleReject(error);
      });

      this.child.once('exit', (code, signal) => {
        const wasManualStop = this.manualStop;
        const exitInfo = { code, signal, manualStop: wasManualStop };

        this.logger.warn?.(
          `[WobbManager] Engine exited with code=${code} signal=${signal || 'none'} manualStop=${wasManualStop}`
        );

        const startupError = !startupSettled && !wasManualStop
          ? new Error(`Wobb engine exited during startup (code=${code}, signal=${signal || 'none'}).`)
          : null;

        this.child = null;
        this.manualStop = false;
        this.cleanupRuntimeFiles();
        this.emit('exit', exitInfo);
        if (startupError) {
          settleReject(startupError);
        }
      });
    });
  }

  async stopXray() {
    if (!this.child) {
      this.cleanupRuntimeFiles();
      return false;
    }

    const child = this.child;
    this.manualStop = true;

    this.logger.info?.(`[WobbManager] Stopping engine PID ${child.pid}`);

    return new Promise((resolve) => {
      let settled = false;

      const finish = (result) => {
        if (settled) {
          return;
        }

        settled = true;
        resolve(result);
      };

      child.once('exit', () => finish(true));

      try {
        child.kill('SIGTERM');
      } catch (error) {
        this.logger.error?.('[WobbManager] Failed to send SIGTERM to engine:', error);
        finish(false);
        return;
      }

      setTimeout(() => {
        if (!this.child || this.child.pid !== child.pid) {
          finish(true);
          return;
        }

        this.logger.warn?.(
          `[WobbManager] Engine did not stop within ${this.stopTimeoutMs}ms, forcing termination`
        );

        try {
          child.kill('SIGKILL');
        } catch (error) {
          this.logger.error?.('[WobbManager] Failed to force-kill engine:', error);
          finish(false);
        }
      }, this.stopTimeoutMs).unref();
    });
  }

  async dispose() {
    await this.stopXray();
    this.removeAllListeners();
  }

  normalizeConfig(configJson) {
    if (typeof configJson === 'string') {
      return JSON.parse(configJson);
    }

    if (!configJson || typeof configJson !== 'object' || Array.isArray(configJson)) {
      throw new Error('Wobb config must be a JSON object or a JSON string.');
    }

    return configJson;
  }

  scrubLogs(data) {
    let scrubbed = String(data);
    const brandPattern = /\b(?:xray|v2ray|xtls)\b/gi;
    const bannerPattern = /\b(?:penetra(?:tes|tion)[^.]*|anti-censorship|a unified platform[^.]*)\b/gi;

    const hadBrandHit = brandPattern.test(scrubbed);
    brandPattern.lastIndex = 0;

    scrubbed = scrubbed.replace(brandPattern, '[Wobb Core]');
    scrubbed = scrubbed.replace(bannerPattern, '[Wobb Core]');

    if (hadBrandHit) {
      scrubbed = scrubbed.replace(/\b(?:go\d+\.\d+(?:\.\d+)?|v?\d+\.\d+\.\d+(?:\.\d+)?)\b/gi, '[Wobb Core]');
    }

    return scrubbed.replace(/\[Wobb Core\](?:\s+\[Wobb Core\])+/g, '[Wobb Core]');
  }

  attachLogStream(stream, label, methodName) {
    if (!stream) {
      return;
    }

    let buffer = '';
    stream.setEncoding('utf8');

    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line) {
          continue;
        }

        const scrubbedLine = this.scrubLogs(line);
        const loggerMethod = this.logger[methodName] || this.logger.log || console.log;
        loggerMethod.call(this.logger, `[WOBB ${label}] ${scrubbedLine}`);
        this.emit(label, scrubbedLine);
      }
    });

    stream.on('end', () => {
      if (!buffer) {
        return;
      }

      const scrubbedBuffer = this.scrubLogs(buffer);
      const loggerMethod = this.logger[methodName] || this.logger.log || console.log;
      loggerMethod.call(this.logger, `[WOBB ${label}] ${scrubbedBuffer}`);
      this.emit(label, scrubbedBuffer);
    });
  }

  getElectronAppPath() {
    try {
      const { app } = require('electron');
      if (app && typeof app.getAppPath === 'function') {
        return app.getAppPath();
      }
    } catch (_error) {
      // Electron is optional during local checks.
    }

    return null;
  }
}

module.exports = {
  XrayManager,
};
