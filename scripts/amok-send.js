'use strict';
// "amok <ruta>" dentro de una terminal de amok: en vez de abrir otra ventana, le pide a la ventana
// dueña de la terminal que cambie de carpeta (sin cerrar pestañas ni terminales) o abra archivos.
// Lo corre el lanzador con ELECTRON_RUN_AS_NODE=1. Sale con 3 si no hay ventana que atienda:
// el lanzador entonces abre una ventana nueva como siempre.
const net = require('net');
const path = require('path');

const ipc = process.env.AMOK_IPC;
if (!ipc) process.exit(3);
const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const paths = (args.length ? args : ['.']).map((a) => path.resolve(a));

let out = '';
let sent = false;
const sock = net.connect(ipc, () => {
  sent = true;
  sock.write(JSON.stringify({ token: process.env.AMOK_TOKEN, paths }) + '\n');
});
sock.setEncoding('utf8');
sock.on('data', (d) => { out += d; });
sock.on('error', () => process.exit(sent ? 1 : 3));
sock.on('end', () => {
  let r;
  try { r = JSON.parse(out); } catch { r = { error: 'respuesta inválida de amok' }; }
  if (r.error) { console.error(`amok: ${r.error}`); process.exit(1); }
  if (r.msg) console.log(r.msg);
  process.exit(0);
});
setTimeout(() => { console.error('amok: la ventana no respondió'); process.exit(sent ? 1 : 3); }, 5000);
