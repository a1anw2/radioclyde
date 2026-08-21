// Minimal raw client for Liquidsoap's telnet command server (radio.liq
// enables it, bound to 127.0.0.1 only -- see that file's own comment).
// Liquidsoap's telnet protocol is plain text: one command per line, response
// terminated by a line containing exactly "END". No npm dependency needed
// for something this small.
//
// The exact command set a given Liquidsoap build actually supports has bitten
// this project before (radio.liq's fade.out()/crossfade() comments) --
// verify against the real running build (`telnet 127.0.0.1 <port>` + `help`)
// before wiring a new command to a UI button, don't assume from Liquidsoap's
// general docs.
import net from 'node:net';
import { config } from '../config/index.js';

const CONNECT_TIMEOUT_MS = 3_000;
const RESPONSE_TIMEOUT_MS = 5_000;

export function sendCommand(command) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: config.liquidsoap.telnetHost,
      port: config.liquidsoap.telnetPort,
    });
    let buffer = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Liquidsoap telnet command "${command}" timed out.`));
    }, CONNECT_TIMEOUT_MS + RESPONSE_TIMEOUT_MS);

    socket.on('connect', () => {
      socket.write(`${command}\n`);
    });
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (/(^|\n)END\r?\n?$/.test(buffer)) {
        clearTimeout(timer);
        socket.end('quit\n');
        resolve(buffer.replace(/(^|\n)END\r?\n?$/, '').trim());
      }
    });
    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
