/**
 * server/runtime.js
 * The server needs Node 22 or newer: the PDF library (pdf.js) uses the `Iterator`
 * global, which Node 20 does not have, so PDF upload would fail there with a vague
 * error. (Node 20 also reached end of life in April 2026.) Check once, at start-up,
 * and say so plainly instead.
 */

export const MIN_NODE_MAJOR = 22;

/** @returns {{ ok: boolean, message: string | null }} */
export function checkNodeVersion(version = process.versions.node) {
  const major = Number(String(version).split('.')[0]);
  if (Number.isFinite(major) && major >= MIN_NODE_MAJOR) return { ok: true, message: null };
  return {
    ok: false,
    message: `Context Compression Lab needs Node.js ${MIN_NODE_MAJOR} or newer (this is ${version}). ` +
             'Install a current LTS from https://nodejs.org and run "npm install" again.',
  };
}
