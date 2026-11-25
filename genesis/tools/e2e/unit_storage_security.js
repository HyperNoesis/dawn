'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const provider = fs.readFileSync(path.join(root, 'js/providers/storage-provider.js'), 'utf8');
const auth = fs.readFileSync(path.join(root, 'js/providers/auth-provider.js'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8');

assert(provider.includes('_recordingPath(userId, id, mime)'), 'recording extension is chosen from the MIME type');
assert(provider.includes("type.includes('mp4') || type.includes('quicktime')"), 'MP4 and QuickTime use an .mp4 suffix');
assert(provider.includes("extension === 'mp4' ? 'mp4' : 'webm'"), 'duplicates preserve their media extension');
assert(provider.includes('if (cleanup && cleanup.error)'), 'failed duplicate metadata writes clean up copied blobs');
assert(provider.includes('if (storageError)'), 'failed storage deletion does not hide the error or delete metadata');
assert(provider.includes("if (!res.ok) throw new Error('Could not download recording"), 'failed downloads are not returned as valid recordings');
assert(auth.includes("for (const bucket of ['recordings', 'environments'])"), 'account deletion walks both private buckets');
assert(auth.includes(".remove(paths.slice(i, i + CHUNK_SIZE))"), 'account deletion removes object bytes through Storage API');
assert(auth.includes("this.client.rpc('delete_own_account')"), 'account row is deleted only after storage cleanup');
assert(!schema.includes('delete from storage.objects'), 'SQL never deletes external Storage blobs directly');
assert(schema.includes('if auth.uid() is null then'), 'account deletion requires an authenticated caller');

console.log('storage-security: media extensions, blob cleanup and account-deletion Storage API path passed');
