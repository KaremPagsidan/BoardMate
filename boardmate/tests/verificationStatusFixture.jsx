import { createRoot } from 'react-dom/client';
import App from '../src/App';
import AppDialogProvider from '../src/components/AppDialogProvider';
import { supabase } from '../src/supabaseClient';
import '../src/index.css';

// Entire app is real; only Supabase IO is replaced. No live API/storage traffic.
window.verificationCalls=[];
let profile;
let history = [];
const storedFiles = new Set();
window.correctionsReady = true;
window.fixtureNotifications = [];
window.phoneAuthCalls = 0;
window.historySnapshot = () => JSON.stringify(history);
const userId='11111111-1111-4111-8111-111111111111';
const authUser=()=>({id:userId,email:'member@example.com',user_metadata:{role:profile.role}});
supabase.auth.getSession=async()=>({data:{session:{user:authUser()}}});
supabase.auth.verifyOtp=async args=>{if(args.phone)window.phoneAuthCalls++;return {data:{user:authUser()},error:null};};
supabase.auth.updateUser=async args=>{if(args.phone)window.phoneAuthCalls++;return {data:{user:authUser()},error:null};};
supabase.auth.getUser=async()=>({data:{user:authUser()}});
supabase.channel=()=>{const channel={on(){return channel;},subscribe(){return channel;}};return channel;};
supabase.removeChannel=async()=>{};
supabase.rpc=async (name,args)=>{
 window.verificationCalls.push({method:'rpc',table:name,args});
 if(name==='boardmate_verification_resubmission_ready')return {data:window.correctionsReady,error:null};
 if(name==='is_boardmate_verification_storage_private')return {data:true,error:null};
 if(name==='resubmit_boardmate_verification'){
  if(profile.verification_status!=='rejected'||profile.verification_revision!==args.p_expected_revision)return {error:new Error('Only the current rejected revision can be resubmitted.')};
  profile={...profile,...args.p_identity,id_document_path:args.p_id_path,selfie_document_path:args.p_selfie_path,verification_status:'pending',verification_revision:crypto.randomUUID(),verification_reason:null,verified_at:null};
  history.unshift({revision:profile.verification_revision,user_id:userId,status:'pending',submitted_at:new Date().toISOString(),profile_snapshot:structuredClone(args.p_identity),id_document_path:args.p_id_path,selfie_document_path:args.p_selfie_path});
  return {data:structuredClone(profile),error:null};
 }
 return {data:[],error:null};
};
supabase.storage.from=()=>({
 upload:async(path,file,options)=>{window.verificationCalls.push({method:'storage.upload',path,options});if(storedFiles.has(path))throw new Error('Overwrite blocked');storedFiles.add(path);return {data:{path},error:null};},
 remove:async paths=>{window.verificationCalls.push({method:'storage.remove',paths});return {error:null};},
 createSignedUrl:async path=>{window.verificationCalls.push({method:'storage.read',path});return {data:{signedUrl:'https://example.invalid/private-preview'},error:null};},
});
supabase.from=table=>{
 let single=false,method='select',start=0,end=49;const filters={};
 const finish=()=>{
  window.verificationCalls.push({method,table});
  if(method!=='select'&&!['boardmate_notifications','boardmate_account_preferences'].includes(table))throw new Error('Unexpected data mutation');
  if(table==='boardmate_account_preferences'&&method==='upsert')return {data:null,error:null};
  if(table==='boardmate_notifications'&&method==='update'){window.fixtureNotifications.forEach(row=>row.read_at=new Date().toISOString());return {data:null,error:null};}
  let data=single?null:[];
  if(table==='boardmate_notifications')data=structuredClone(window.fixtureNotifications);
  if(table==='profiles')data=single?structuredClone(profile):[structuredClone(profile)];
  if(table==='boardmate_verification_submissions')data=single?structuredClone(history.find(row=>row.revision===filters.revision)||null):structuredClone(history.slice(start,end+1));
  return {data,error:null,count:0};
 };
 const query=new Proxy({}, {get:(_,property)=>{
  if(property==='then')return (resolve,reject)=>Promise.resolve().then(finish).then(resolve,reject);
  if(property==='eq')return (key,value)=>{filters[key]=value;return query;};
  if(property==='range')return (a,b)=>{start=a;end=b;return query;};
  if(property==='single'||property==='maybeSingle')return ()=>{single=true;return Promise.resolve().then(finish);};
  return ()=>{if(['insert','update','delete','upsert'].includes(property))method=property;return query;};
 }});
 return query;
};
let version=0;const root=createRoot(document.getElementById('root'));
window.verificationSnapshot=()=>JSON.stringify(profile);
window.showVerificationFixture=(role='RENTER',status='pending',legacy=false)=>{
 profile={id:userId,role,email:'member@example.com',full_name:`Test ${role} ${status}`,verification_status:status,
  verification_revision:status==='not_submitted'||legacy?null:'22222222-2222-4222-8222-222222222222',
  verification_reason:status==='rejected'?'The government ID is unreadable. Contact the administrator. '+ 'Feedback '.repeat(25):status==='approved'?'Documents reviewed.':'',
  verified_at:status==='pending'||status==='not_submitted'?null:'2026-11-13T02:00:00Z',
  id_uploaded:status!=='not_submitted'&&!legacy,selfie_uploaded:status!=='not_submitted'&&!legacy,
  phone:'09123456789',gender:'Female',dob:'2000-01-01',business_name:'House',address:'Manila',gov_id_number:'1234',property_type:'Apartment',
  id_document_path:status==='not_submitted'||legacy?null:'original/id.pdf',selfie_document_path:status==='not_submitted'||legacy?null:'original/selfie.png',
 };
 history=profile.verification_revision?[{revision:profile.verification_revision,user_id:userId,status,submitted_at:'2026-11-13T01:00:00Z',reviewed_at:profile.verified_at,reason:profile.verification_reason,profile_snapshot:{full_name:profile.full_name},id_document_path:profile.id_document_path,selfie_document_path:profile.selfie_document_path}]:[];
 window.fixtureNotifications=status==='not_submitted'?[]:[{id:'notice-1',user_id:userId,title:status==='approved'?'Your account has been approved':'Verification corrections requested',body:status==='approved'?'Documents accepted.':'Please correct your personal details.',target_type:'profile',target_id:userId,created_at:new Date().toISOString(),read_at:null}];
 storedFiles.add('original/id.pdf');storedFiles.add('original/selfie.png');
 root.render(<AppDialogProvider key={++version}><App/></AppDialogProvider>);
};
window.showVerificationFixture();
