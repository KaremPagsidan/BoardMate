import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (await readFile(new URL('../src/lib/verification.js', import.meta.url), 'utf8'))
  .replace("import { supabase } from '../supabaseClient';", 'const supabase = globalThis.verificationTestClient;')
  .replace("'./verificationStatus.js'", JSON.stringify(new URL('../src/lib/verificationStatus.js', import.meta.url).href));
let moduleNumber = 0;
const idFile = { name: 'id.pdf', type: 'application/pdf', size: 100 };
const selfieFile = { name: 'selfie.png', type: 'image/png', size: 100 };

async function fixture(options = {}) {
  const events = [];
  const files = new Set();
  let profile = { id: 'member', verification_status: 'not_submitted', verification_revision: null, id_document_path: null, selfie_document_path: null, ...options.profile };
  let reads = 0;
  let writes = 0;
  const client = {
    auth: { getUser: async () => {
      events.push(['auth']);
      return { data: { user: options.unauthenticated ? null : { id: options.userId || 'member' } }, error: null };
    } },
    rpc: async (name, args) => {
      if (name === 'is_boardmate_verification_storage_private') {
        events.push(['private-storage']);
        return { data: options.privateStorage !== false, error: options.rpcError || null };
      }
      if (name === 'boardmate_verification_resubmission_ready') return { data: options.resubmissionReady !== false, error: null };
      if (name === 'submit_boardmate_verification' || name === 'resubmit_boardmate_verification') {
        const paths = { id_document_path: args.p_id_path, selfie_document_path: args.p_selfie_path };
        writes += 1;
        events.push(['save', paths, args.p_expected_revision]);
        if (options.staleSubmission) return { data: null, error: new Error('Verification changed. Refresh and retry.') };
        assert.equal(args.p_expected_revision, profile.verification_revision || null);
        if (!options.saveFailure || options.commitDespiteError) profile = {
          ...profile, ...paths, ...(args.p_identity || {}), verification_status: 'pending', verification_revision: crypto.randomUUID(), id_uploaded: true, selfie_uploaded: true,
        };
        if (options.saveFailure) return { data: null, error: new Error('Save interrupted') };
        return { data: { ...profile }, error: null };
      }
      if (name === 'review_boardmate_verification') {
        events.push(['review', args]);
        if (args.p_revision !== profile.verification_revision || profile.verification_status !== 'pending') {
          return { data: null, error: new Error('Stale verification review. Refresh and inspect the current submission.') };
        }
        profile = { ...profile, verification_status: args.p_status, verification_reason: args.p_reason };
        return { data: { ...profile }, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
    storage: { from: bucket => {
      assert.equal(bucket, 'verification-documents');
      return {
        upload: async (path, file, settings) => {
          events.push(['upload', path, settings]);
          if (options.failUpload === (path.includes('/selfie-') ? 'selfie' : 'id')) return { error: new Error('Upload interrupted') };
          files.add(path);
          return { error: null };
        },
        remove: async paths => {
          events.push(['remove', paths]);
          if (options.cleanupFailure) throw new Error('Cleanup unavailable');
          paths.forEach(path => files.delete(path));
          return { error: null };
        },
      };
    } },
    from: table => {
      assert.equal(table, 'profiles');
      return {
        select() { return this; },
        eq(column, value) { assert.equal(column, 'id'); assert.equal(value, 'member'); return this; },
        async maybeSingle() {
          reads += 1;
          events.push(['read']);
          if (reads > 1 && options.confirmationFailure) throw new Error('Offline');
          if (reads > 1 && options.reviewAfterSave) profile = { ...profile, verification_status: options.reviewAfterSave };
          return { data: options.missingProfile ? null : { ...profile }, error: null };
        },
      };
    },
  };
  globalThis.verificationTestClient = client;
  const api = await import(`data:text/javascript;base64,${Buffer.from(source + `\n// fixture ${moduleNumber++}`).toString('base64')}`);
  delete globalThis.verificationTestClient;
  return { api, events, files, get profile() { return profile; }, get writes() { return writes; } };
}

test('successful submission authenticates, checks privacy, uploads both files, then saves paths together', async () => {
  const context = await fixture();
  const progress = [];
  const result = await context.api.submitVerificationDocuments('member', { idFile, selfieFile }, text => progress.push(text));
  const uploads = context.events.filter(([event]) => event === 'upload');
  assert.equal(uploads.length, 2);
  assert.ok(uploads.every(([, path, settings]) => path.startsWith('member/') && settings.upsert === false));
  assert.equal(context.events[0][0], 'auth');
  assert.ok(context.events.findIndex(([event]) => event === 'private-storage') < context.events.findIndex(([event]) => event === 'upload'));
  assert.equal(context.events.at(-1)[0], 'save');
  assert.deepEqual(Object.keys(context.events.at(-1)[1]).sort(), ['id_document_path', 'selfie_document_path']);
  assert.equal(result.verification_status, 'pending');
  assert.equal(context.writes, 1);
  assert.equal(progress.length, 4);
});

test('unauthenticated or mismatched accounts cannot upload or write profiles', async () => {
  for (const options of [{ unauthenticated: true }, { userId: 'another-account' }]) {
    const context = await fixture(options);
    await assert.rejects(context.api.submitVerificationDocuments('member', { idFile, selfieFile }), /Sign in/);
    assert.equal(context.files.size, 0);
    assert.equal(context.writes, 0);
  }
});

test('public, missing, or unverifiable private storage fails before either upload', async () => {
  for (const options of [{ privateStorage: false }, { rpcError: { message: 'Function not installed' } }]) {
    const context = await fixture(options);
    await assert.rejects(context.api.submitVerificationDocuments('member', { idFile, selfieFile }), /private storage could not be confirmed/);
    assert.equal(context.files.size, 0);
    assert.equal(context.writes, 0);
  }
});

test('missing, empty, oversized, or invalid files never submit a profile', async () => {
  for (const files of [
    { idFile, selfieFile: null },
    { idFile: { ...idFile, size: 0 }, selfieFile },
    { idFile: { ...idFile, size: 11 * 1024 * 1024 }, selfieFile },
    { idFile, selfieFile: idFile },
    { idFile: { ...idFile, type: 'text/html' }, selfieFile },
  ]) {
    const context = await fixture();
    await assert.rejects(context.api.submitVerificationDocuments('member', files));
    assert.equal(context.files.size, 0);
    assert.equal(context.writes, 0);
  }
});

test('failure uploading the second document cleans up the first without marking pending', async () => {
  const context = await fixture({ failUpload: 'selfie' });
  await assert.rejects(context.api.submitVerificationDocuments('member', { idFile, selfieFile }), /Upload interrupted/);
  assert.equal(context.files.size, 0);
  assert.equal(context.writes, 0);
  assert.equal(context.profile.verification_status, 'not_submitted');
});

test('failed profile save cleans up new uploads and preserves existing rejected documents', async () => {
  const context = await fixture({ saveFailure: true, profile: {
    verification_status: 'rejected', id_document_path: 'member/old-id.pdf', selfie_document_path: 'member/old-selfie.png',
  } });
  await assert.rejects(context.api.submitVerificationDocuments('member', { idFile, selfieFile }), /Save interrupted/);
  assert.equal(context.files.size, 0);
  assert.equal(context.profile.verification_status, 'rejected');
  assert.equal(context.profile.id_document_path, 'member/old-id.pdf');
  assert.equal(context.events.find(([event]) => event === 'remove')[1].length, 2);
});

test('lost save response is recovered without deleting committed documents', async () => {
  const context = await fixture({ saveFailure: true, commitDespiteError: true });
  const result = await context.api.submitVerificationDocuments('member', { idFile, selfieFile });
  assert.equal(result.verification_status, 'pending');
  assert.equal(context.files.size, 2);
  assert.equal(context.events.some(([event]) => event === 'remove'), false);
});

test('unknown save outcome retains files and reports uncertainty instead of false success', async () => {
  const context = await fixture({ saveFailure: true, commitDespiteError: true, confirmationFailure: true });
  await assert.rejects(context.api.submitVerificationDocuments('member', { idFile, selfieFile }), /could not be confirmed/);
  assert.equal(context.files.size, 2);
  assert.equal(context.events.some(([event]) => event === 'remove'), false);
});

test('cleanup failure is reported without claiming verification completed', async () => {
  const context = await fixture({ failUpload: 'selfie', cleanupFailure: true });
  await assert.rejects(context.api.submitVerificationDocuments('member', { idFile, selfieFile }), /Temporary uploads could not be removed/);
  assert.equal(context.writes, 0);
});

test('rejected users can replace just one document, retaining the other', async () => {
  const context = await fixture({ profile: { verification_status: 'rejected', id_document_path: 'member/old-id.pdf', selfie_document_path: 'member/old-selfie.png' } });
  const result = await context.api.submitVerificationDocuments('member', { selfieFile });
  assert.equal(result.id_document_path, 'member/old-id.pdf');
  assert.notEqual(result.selfie_document_path, 'member/old-selfie.png');
  assert.equal(result.verification_status, 'pending');
  assert.equal(context.files.size, 1);
});

test('legacy pending, approved, and rejected states are preserved regardless of missing documents', async () => {
  const { api } = await fixture();
  assert.equal(api.getVerificationStatus({ verification_status: 'pending' }), 'pending');
  assert.equal(api.getVerificationStatus({ verification_status: 'pending', id_document_path: 'id', selfie_document_path: 'selfie' }), 'pending');
  assert.equal(api.getVerificationStatus({ verification_status: 'approved' }), 'approved');
  assert.equal(api.getVerificationStatus({ verification_status: 'rejected' }), 'rejected');
  assert.equal(api.verificationProfileUpdate({ verification_status: 'pending' }).idUploaded, false);
});

test('stale submissions report the conflict and clean up only their new uploads', async () => {
  const context = await fixture({ staleSubmission: true, profile: { verification_revision: 'existing-revision' } });
  await assert.rejects(context.api.submitVerificationDocuments('member', { idFile, selfieFile }), /Verification changed/);
  assert.equal(context.files.size, 0);
  assert.equal(context.events.find(([event]) => event === 'save')[2], 'existing-revision');
});

test('retries use fresh UUID paths and do not enable storage upserts', async () => {
  const context = await fixture({ failUpload: 'selfie' });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(context.api.submitVerificationDocuments('member', { idFile, selfieFile }));
  }
  const uploads = context.events.filter(([event]) => event === 'upload');
  assert.equal(new Set(uploads.map(([, path]) => path)).size, uploads.length);
  assert.ok(uploads.every(([, , settings]) => settings.upsert === false));
});

test('admin review sends the displayed revision and rejects a superseded snapshot', async () => {
  const context = await fixture({ profile: { verification_status: 'pending', verification_revision: 'current-version' } });
  await assert.rejects(context.api.reviewVerificationSubmission({ id: 'member', verification_revision: 'older-version' }, 'approved'), /Stale verification review/);
  const reviewed = await context.api.reviewVerificationSubmission({ id: 'member', verification_revision: 'current-version' }, 'rejected', 'Replace the ID');
  assert.equal(reviewed.verification_status, 'rejected');
  assert.deepEqual(context.events.at(-1)[1], { p_user_id: 'member', p_revision: 'current-version', p_status: 'rejected', p_reason: 'Replace the ID' });
});

test('legacy admin review requires explicit new submission instead of changing old status', async () => {
  const context = await fixture({ profile: { verification_status: 'approved' } });
  await assert.rejects(context.api.reviewVerificationSubmission({ id: 'member' }, 'rejected'), /legacy account needs a new document submission/);
  assert.equal(context.profile.verification_status, 'approved');
  assert.equal(context.events.length, 0);
});

test('lost submission responses recover an immediate admin decision without falsely claiming pending status', async () => {
  for (const status of ['approved', 'rejected']) {
    const context = await fixture({ saveFailure: true, commitDespiteError: true, reviewAfterSave: status });
    const result = await context.api.submitVerificationDocuments('member', { idFile, selfieFile });
    assert.equal(result.verification_status, status);
    assert.equal(context.events.some(([event]) => event === 'remove'), false);
    assert.equal(context.files.size, 2);
  }
});

test('first-time submission entry point rejects every previously submitted state before upload/write', async () => {
  for (const profile of [
    { verification_status: 'pending' }, { verification_status: 'approved' }, { verification_status: 'rejected' },
    { verification_revision: 'existing' }, { id_document_path: 'original-id.pdf' }, { selfie_document_path: 'original-selfie.png' },
    { id_uploaded: true }, { selfie_uploaded: true },
  ]) {
    const context = await fixture({ profile });
    await assert.rejects(context.api.submitInitialVerificationDocuments('member', { idFile, selfieFile }), /already been submitted/);
    assert.equal(context.events.some(([event]) => ['upload','save','remove'].includes(event)), false);
    assert.equal(context.files.size, 0);
  }
});
test('first-time submission still uploads both documents and creates its initial revision', async () => {
  const context = await fixture();
  const result = await context.api.submitInitialVerificationDocuments('member', { idFile, selfieFile });
  assert.equal(result.verification_status, 'pending');
  assert.ok(result.verification_revision);
  assert.equal(context.events.filter(([event]) => event === 'save').length, 1);
});

test('rejected resubmission saves corrected identity with separate documents and recovers lost responses', async () => {
 for (const lost of [false,true]) {
  const context=await fixture({profile:{role:'RENTER',verification_status:'rejected',verification_revision:'rejected-revision',id_document_path:'member/original-id.pdf',selfie_document_path:'member/original-selfie.png'},saveFailure:lost,commitDespiteError:lost});
  const result=await context.api.resubmitVerificationDocuments('member',{idFile,selfieFile},{full_name:'Corrected Name'},'rejected-revision');
  assert.equal(result.verification_status,'pending');assert.equal(result.full_name,'Corrected Name');
  assert.notEqual(result.id_document_path,'member/original-id.pdf');assert.notEqual(result.selfie_document_path,'member/original-selfie.png');
  assert.equal(context.events.filter(([event])=>event==='save').length,1);
  assert.equal(context.events.some(([event])=>event==='remove'),false);
 }
});
test('resubmission fails before uploads when pending, approved, suspended, stale, missing files or migration unavailable',async()=>{
 for(const options of [
  {profile:{verification_status:'pending'}},{profile:{verification_status:'approved'}},{profile:{suspended_at:'now'}},
  {profile:{verification_revision:'newer'}},{resubmissionReady:false},
 ]){
  const context=await fixture({...options,profile:{verification_status:'rejected',verification_revision:'current',...options.profile}});
  await assert.rejects(context.api.resubmitVerificationDocuments('member',{idFile,selfieFile},{full_name:'Corrected'},'current'));
  assert.equal(context.events.some(([event])=>['upload','save','remove'].includes(event)),false);
 }
 const context=await fixture({profile:{verification_status:'rejected',verification_revision:'current'}});
 await assert.rejects(context.api.resubmitVerificationDocuments('member',{idFile},{},'current'),/both/);
});
