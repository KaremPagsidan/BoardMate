import test from 'node:test';
import assert from 'node:assert/strict';
import { canSubmitInitialVerification, loadVerificationStatus, formatVerificationDate } from '../src/lib/verificationStatus.js';

test('both roles use a read-only route for all submitted/legacy states and any document evidence', () => {
 for (const role of ['RENTER','LANDLORD']) {
  assert.equal(canSubmitInitialVerification({role,verificationStatus:'not_submitted'}),true);
  for (const status of ['pending','approved','rejected',undefined]) {
   assert.equal(canSubmitInitialVerification({role,verificationStatus:status}),false);
  }
  for (const field of ['verificationRevision','idDocumentPath','selfieDocumentPath','idUploaded','selfieUploaded']) assert.equal(canSubmitInitialVerification({role,verificationStatus:'not_submitted',[field]:'existing'}),false);
 }
});
function clientFor(profile, submission, failure) {
 const calls=[];
 return {calls,from(table){
  const query={select(columns){calls.push(['select',table,columns]);return query;},eq(field,value){calls.push(['filter',field,value]);return query;},async maybeSingle(){return {data:table==='profiles'?profile:submission,error:failure};}};
  return query;
 }};
}
test('status reads only the matching revision and uses actual submission/review dates and remarks', async () => {
 const profile={id:'member',verification_revision:'current',verification_status:'pending',verification_reason:''};
 const submission={user_id:'member',revision:'current',status:'rejected',submitted_at:'2026-11-13T01:00:00Z',reviewed_at:'2026-11-13T02:00:00Z',reason:'ID is unreadable'};
 const client=clientFor(profile,submission);
 const result=await loadVerificationStatus(client,'member');
 assert.equal(result.status,'rejected');assert.equal(result.reason,'ID is unreadable');
 assert.equal(result.submittedAt,submission.submitted_at);assert.equal(result.reviewedAt,submission.reviewed_at);
 assert.ok(client.calls.some(c=>c[0]==='filter'&&c[1]==='revision'&&c[2]==='current'));
 assert.ok(client.calls.every(c=>['select','filter'].includes(c[0])));
});
test('legacy submission dates stay unknown; reviewed_at fallback does not invent a submission date',async()=>{
 const client=clientFor({id:'member',verification_status:'approved',verified_at:'2026-11-13T02:00:00Z',created_at:'2025-01-01'},null);
 const result=await loadVerificationStatus(client,'member');
 assert.equal(result.submittedAt,null);assert.ok(result.reviewedAt);
 assert.equal(client.calls.filter(c=>c[0]==='select').length,1);
 assert.equal(formatVerificationDate(null),'Not recorded');assert.equal(formatVerificationDate('invalid'),'Not recorded');
});
test('missing records, denied reads and foreign revision responses fail without mutation',async()=>{
 await assert.rejects(loadVerificationStatus(clientFor(null,null),'member'));
 await assert.rejects(loadVerificationStatus(clientFor({id:'other'},null),'member'));
 await assert.rejects(loadVerificationStatus(clientFor({},null,new Error('RLS denied')),'member'));
 await assert.rejects(loadVerificationStatus(clientFor({id:'member',verification_revision:'current'},{user_id:'other',revision:'current'}),'member'));
});
