const buckets = new Set(['profile-photos', 'listing-photos', 'roommate-post-photos']);
const stages = new Set(['permission', 'download', 'decode']);
const codes = new Set(['access_denied', 'not_found', 'NoSuchKey', 'NoSuchBucket', 'AccessDenied', 'InvalidJWT', 'Unauthorized', 'network_error', 'decode_failed']);
const reported = new Set();
const references = new Map();
let nextReference = 0;
export function mediaFailureDetails(stage, location, error = {}) {
  const status = Number(error.statusCode || error.status);
  const rawCode = String(error.code || '');
  const code = codes.has(rawCode) || /^(PGRST[0-9]{3}|[0-9A-Z]{5})$/.test(rawCode) ? rawCode : 'unknown';
  return {
    stage: stages.has(stage) ? stage : 'unknown',
    bucket: buckets.has(location?.bucket) ? location.bucket : 'external',
    code,
    ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { httpStatus: status } : {}),
  };
}
export function reportMediaFailure(src, stage, location, error) {
  if (!references.has(src)) {
    if (references.size >= 200) { references.clear(); reported.clear(); }
    references.set(src, ++nextReference);
  }
  const details = { mediaReference: references.get(src), ...mediaFailureDetails(stage, location, error) };
  const signature = JSON.stringify(details);
  if (!reported.has(signature)) {
    reported.add(signature);
    console.warn('[BoardMate media]', details);
  }
}
export function mediaAccessError(stage, location, original = {}) {
  const details = mediaFailureDetails(stage, location, original);
  return Object.assign(new Error(stage === 'permission' ? 'Media permission could not be confirmed.' : 'The media file could not be downloaded.'), details);
}
