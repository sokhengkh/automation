import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';

const execFileAsync = promisify(execFile);

export class NgrokService {
  constructor() {
    this.process = null;
    this.publicUrl = '';
  }

  async getExistingTunnelUrl() {
    try {
      const res = await fetch('http://127.0.0.1:4040/api/tunnels');
      if (!res.ok) return '';
      const data = await res.json();
      const httpsTunnel = (data.tunnels || []).find((t) => String(t.public_url || '').startsWith('https://'));
      if (httpsTunnel?.public_url) {
        this.publicUrl = httpsTunnel.public_url;
        return this.publicUrl;
      }
      return '';
    } catch {
      return '';
    }
  }

  async ensureAuthtoken() {
    if (!config.ngrok.authtoken) return;
    try {
      await execFileAsync(config.ngrok.binary, ['config', 'add-authtoken', config.ngrok.authtoken]);
    } catch (err) {
      console.warn('[ngrok] Could not apply authtoken automatically:', err.message);
    }
  }

  async startTunnel(port = config.port) {
    const existing = await this.getExistingTunnelUrl();
    if (existing) {
      console.log(`[ngrok] Reusing active tunnel: ${existing}`);
      return existing;
    }

    if (!config.ngrok.autostart) {
      return '';
    }

    await this.ensureAuthtoken();

    const args = ['http', String(port)];
    if (config.ngrok.domain) {
      args.push(`--domain=${config.ngrok.domain}`);
    }

    try {
      this.process = spawn(config.ngrok.binary, args, {
        stdio: 'ignore',
        windowsHide: true,
      });

      this.process.on('error', (err) => {
        console.warn('[ngrok] Failed to launch ngrok:', err.message);
      });

      // Wait up to 10s for ngrok local API to report tunnel
      for (let i = 0; i < 20; i += 1) {
        await new Promise((r) => setTimeout(r, 500));
        const url = await this.getExistingTunnelUrl();
        if (url) {
          console.log(`[ngrok] Tunnel started: ${url}`);
          return url;
        }
      }
    } catch (err) {
      console.warn('[ngrok] Startup error:', err.message);
    }

    return '';
  }

  stop() {
    if (this.process && !this.process.killed) {
      this.process.kill();
      this.process = null;
    }
  }
}

export const ngrokService = new NgrokService();
