'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const provider = fs.readFileSync(path.join(root, 'js/providers/storage-provider.js'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8');

assert(provider.includes('_recordingPath(userId, id, mime)'), 'recording extension is chosen from the MIME type');
assert(provider.includes("type.includes('mp4') || type.includes('quicktime')"), 'MP4 and QuickTime use an .mp4 suffix');
assert(provider.includes("extension === 'mp4' ? 'mp4' : 'webm'"), 'duplicates preserve their media extension');
assert(provider.includes('if (cleanup && cleanup.error)'), 'failed duplicate metadata writes clean up copied blobs');
assert(provider.includes('if (storageError)'), 'failed storage deletion does not hide the error or delete metadata');
assert(provider.includes("if (!res.ok) throw new Error('Could not download recording"), 'failed downloads are not returned as valid recordings');
assert(schema.includes('delete from storage.objects'), 'account deletion removes private storage objects');
assert(schema.includes("bucket_id in ('recordings', 'environments')"), 'both private buckets are cleaned');
assert(schema.includes('if auth.uid() is null then'), 'account deletion requires an authenticated caller');

console.log('storage-security: extensions, failed-write cleanup and account-deletion storage cleanup passed');
