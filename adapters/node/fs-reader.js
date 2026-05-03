// Node reader for golden-trajectory files. Reads JSON from disk.
import { readFile } from 'node:fs/promises';

/**
 * @param {string} goldenPath
 * @returns {Promise<object>}
 */
export async function nodeFsReader(goldenPath) {
  const text = await readFile(goldenPath, 'utf-8');
  return JSON.parse(text);
}
