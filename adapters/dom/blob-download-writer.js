// Browser writer for the on-failure dump. Serializes the snapshot to a
// Blob and triggers a download via an anchor click. Uses the file's
// basename (last path segment) as the download filename.

/**
 * @param {Array} snapshot
 * @param {string} dumpPath  used only for the filename (basename); the
 *                            file lands in the browser's Downloads folder.
 */
export function blobDownloadWriter(snapshot, dumpPath) {
  const json = JSON.stringify(snapshot);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = dumpPath.split('/').pop() || 'dump.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}
