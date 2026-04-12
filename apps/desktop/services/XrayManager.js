const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');

class XrayManager extends EventEmitter {
  /**
   * Creates a manager for the masked Wobb engine process.
   *
   * @param {object} [options]
   * @param {Console|object} [options.logger]
   * @param {string} [options.platform]
   * @param {string} [options.binaryName]
   * @param {string|null} [options.binaryPath]
   * @param {string|null} [options.binRoot]
   * @param {number} [options.stopTimeoutMs]
   */
  constructor(options = {}) {
    super();

    this.logger = options.logger || console;
    this.platform = options.platform || process.platform;
    this.binaryName = options.binaryName || XrayManager.getBinaryName(this.platform);
    this.binaryPath = options.binaryPath || null;
    this.binRoot = options.binRoot || null;
    this.stopTimeoutMs = options.stopTimeoutMs || 5000;
    this.child = null;
    this.manualStop = false;
  }

  /**
   * Maps a Node platform to the binary directory name.
   *
   * @param {string} [platform]
   * @returns {string}
   */
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

  /**
   * Returns the masked engine executable name for the current platform.
   *
   * @param {string} [platform]
   * @returns {string}
   */
  static getBinaryName(platform = process.platform) {
    return platform === 'win32' ? 'wobb-engine.exe' : 'wobb-engine';
  }

  /**
   * Creates a client config for the Wobb engine.
   *
   * @param {object} [options]
   * @param {boolean} [enableStealth]
   * @returns {object}
   */
  static createBasicVlessConfig(options = {}, enableStealth = options.stealthMode ?? false) {
    const {
      serverAddress = 'edge.wobb.example',
      serverPort = 443,
      uuid = '00000000-0000-0000-0000-000000000000',
      localSocksPort = 10808,
      localHttpPort = 10809,
      logLevel = 'warning',
      network = 'tcp',
      security = 'tls',
      serverName = serverAddress,
      flow = '',
      fingerprint = 'chrome',
      allowInsecure = false,
      publicKey,
      shortId,
      spiderX = '/',
      wsPath = '/',
      wsHost,
    } = options;

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
              port: serverPort,
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

  /**
   * Returns whether the engine process is currently alive.
   *
   * @returns {boolean}
   */
  isRunning() {
    return Boolean(this.child && !this.child.killed);
  }

  /**
   * Returns a snapshot of the current engine process state.
   *
   * @returns {{running: boolean, pid: number|null, binaryPath: string|null, configPath: string|null}}
   */
  getStatus() {
    return {
      running: this.isRunning(),
      pid: this.child ? this.child.pid : null,
      binaryPath: this.binaryPath || null,
      configPath: 'stdin:',
    };
  }

  /**
   * Resolves the engine executable path from standard runtime locations.
   *
   * @returns {string}
   */
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

    candidates.add(path.resolve(process.cwd(), 'resources', 'bin', platformFolder, binaryName));
    candidates.add(path.resolve(process.cwd(), 'resources', platformFolder, binaryName));
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

  /**
   * Validates that the resolved binary exists and is executable when required.
   *
   * @param {string} binaryPath
   * @returns {void}
   */
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

  /**
   * Starts the engine by piping the JSON config to stdin.
   *
   * @param {object|string} configJson
   * @returns {Promise<{running: boolean, pid: number|null, binaryPath: string|null, configPath: string|null}>}
   */
  async startXray(configJson) {
    if (this.isRunning()) {
      throw new Error('Wobb engine is already running.');
    }

    const binaryPath = this.resolveBinaryPath();
    const configObject = this.normalizeConfig(configJson);
    const configPayload = `${JSON.stringify(configObject)}\n`;
    const args = ['run', '-config', 'stdin:'];

    this.logger.info?.(`[WobbManager] Starting engine: ${binaryPath} ${args.join(' ')}`);

    this.manualStop = false;
    this.child = spawn(binaryPath, args, {
      cwd: path.dirname(binaryPath),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.attachLogStream(this.child.stdout, 'stdout', 'info');
    this.attachLogStream(this.child.stderr, 'stderr', 'warn');

    this.child.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') {
        this.logger.warn?.('[WobbManager] Engine stdin error:', error);
      }
    });

    this.child.once('spawn', () => {
      this.logger.info?.(`[WobbManager] Engine started with PID ${this.child.pid}`);
      this.emit('started', this.getStatus());
      this.child.stdin.end(configPayload);
    });

    this.child.once('error', (error) => {
      this.logger.error?.('[WobbManager] Failed to start engine process:', error);
      this.child = null;
      this.emit('error', error);
    });

    this.child.once('exit', (code, signal) => {
      const wasManualStop = this.manualStop;
      const exitInfo = { code, signal, manualStop: wasManualStop };

      this.logger.warn?.(
        `[WobbManager] Engine exited with code=${code} signal=${signal || 'none'} manualStop=${wasManualStop}`
      );

      this.child = null;
      this.manualStop = false;
      this.emit('exit', exitInfo);
    });

    return this.getStatus();
  }

  /**
   * Stops the running engine gracefully and force-kills it on timeout.
   *
   * @returns {Promise<boolean>}
   */
  async stopXray() {
    if (!this.child) {
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

  /**
   * Stops the engine and detaches listeners.
   *
   * @returns {Promise<void>}
   */
  async dispose() {
    await this.stopXray();
    this.removeAllListeners();
  }

  /**
   * Parses an input config payload into a plain JSON object.
   *
   * @param {object|string} configJson
   * @returns {object}
   */
  normalizeConfig(configJson) {
    if (typeof configJson === 'string') {
      return JSON.parse(configJson);
    }

    if (!configJson || typeof configJson !== 'object' || Array.isArray(configJson)) {
      throw new Error('Wobb config must be a JSON object or a JSON string.');
    }

    return configJson;
  }

  /**
   * Scrubs engine branding and version-like tokens from log output.
   *
   * @param {string} data
   * @returns {string}
   */
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

  /**
   * Pipes a child-process stream into the logger after scrubbing brand markers.
   *
   * @param {import('node:stream').Readable|null} stream
   * @param {'stdout'|'stderr'} label
   * @param {'info'|'warn'|'error'} methodName
   * @returns {void}
   */
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

  /**
   * Returns the Electron app path when running inside Electron.
   *
   * @returns {string|null}
   */
  getElectronAppPath() {
    try {
      const { app } = require('electron');
      if (app && typeof app.getAppPath === 'function') {
        return app.getAppPath();
      }
    } catch (error) {
      // Electron is optional during local checks.
    }

    return null;
  }
}

module.exports = {
  XrayManager,
};
