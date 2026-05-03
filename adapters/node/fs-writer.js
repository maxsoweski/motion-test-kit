// Node writer for the on-failure dump. Writes the JSON-serialized
// snapshot to the supplied path.

import { writeFile } from 'node:fs/promises';

/**
 * @param {Array} snapshot
 * @param {string} dumpPath
 * @returns {Promise<void>}
 */
export async function nodeFsWriter(snapshot, dumpPath) {
  const json = JSON.stringify(snapshot);
  await writeFile(dumpPath, json);
}
