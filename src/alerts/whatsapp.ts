import path from 'node:path';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
} from '@whiskeysockets/baileys';
import type { WASocket } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import type { Logger, WhatsAppConfig, WhatsAppSender } from '../types.js';

// Unofficial WhatsApp client via Baileys. On first run it prints a QR code to
// scan with your phone; the session is then persisted under authDir so future
// runs reconnect automatically. Excluded from unit coverage (pure I/O).
export async function createWhatsApp(
  waConfig: WhatsAppConfig,
  { logger = console }: { logger?: Logger } = {},
): Promise<WhatsAppSender> {
  if (!waConfig.enabled) {
    return { send: async () => {}, close: async () => {}, enabled: false };
  }

  const authDir = path.resolve(waConfig.authDir);
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  let sock: WASocket;
  let ready = false;

  function start(): void {
    sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }) as never,
    });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        logger.info?.('Scan this QR code with WhatsApp to link the device:');
        qrcode.generate(qr, { small: true });
      }
      if (connection === 'open') {
        ready = true;
        logger.info?.('WhatsApp connected.');
      }
      if (connection === 'close') {
        ready = false;
        const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output
          ?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) start();
        else logger.warn?.('WhatsApp logged out; delete the auth dir and re-link.');
      }
    });
  }

  start();

  function toJid(number: string): string {
    const digits = String(number).replace(/[^0-9]/g, '');
    return `${digits}@s.whatsapp.net`;
  }

  async function send(number: string, text: string): Promise<void> {
    // Wait briefly for the socket to be ready on cold start.
    for (let i = 0; i < 30 && !ready; i += 1) {
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!ready) throw new Error('WhatsApp socket not connected');
    await sock.sendMessage(toJid(number), { text });
  }

  async function close(): Promise<void> {
    try {
      await sock?.logout?.();
    } catch {
      /* ignore */
    }
  }

  return { send, close, enabled: true };
}
