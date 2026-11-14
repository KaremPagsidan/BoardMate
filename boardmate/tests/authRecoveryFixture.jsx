import { createRoot } from 'react-dom/client';
import App from '../src/App';
import { supabase } from '../src/supabaseClient';
import AppViewport from '../src/components/AppViewport';
import PasswordRecovery from '../src/components/PasswordRecovery';
import AppDialogProvider from '../src/components/AppDialogProvider';
import '../src/index.css';

// No live Auth calls. The real Supabase SDK receives deterministic mock HTTP.
const realFetch=window.fetch.bind(window), realNow=Date.now;
window.clockOffset=0;Date.now=()=>realNow()+window.clockOffset;
window.authCalls=[];
const user={id:'11111111-1111-4111-8111-111111111111',email:'member@gmail.com',aud:'authenticated',role:'authenticated',user_metadata:{role:'RENTER'}};
window.fetch=async (input,options={})=>{
 const url=String(input);
 if(!url.includes('/auth/v1/')&&!url.includes('/rest/v1/'))return realFetch(input,options);
 const body=options.body?JSON.parse(options.body):{};
 window.authCalls.push({url,body,method:options.method});
 const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 if(url.includes('/recover'))return window.recoveryRateLimit?json({code:'over_email_send_rate_limit',msg:'Rate limit'},429):json({});
 if(url.includes('/verify')){
  if(body.token!=='012345')return json({code:'otp_expired',msg:'Token has expired or is invalid'},403);
  return json({access_token:'mock-recovery-token',refresh_token:'mock-refresh-token',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user});
 }
 if(url.includes('/user'))return json(user);
 if(url.includes('/logout'))return json({});
 return json([]);
};
const root=createRoot(document.getElementById('root'));let version=0;
window.showAuthFixture=kind=>{
 version++;
 root.render(<AppDialogProvider key={version}>{kind==='app'?<App/>:<AppViewport><PasswordRecovery initialEmail="member@gmail.com" onBack={()=>{}} onComplete={message=>{window.recoveryCompleted=message;}}/></AppViewport>}</AppDialogProvider>);
};
window.mainAuthSession=async()=> (await supabase.auth.getSession()).data.session;
window.showAuthFixture('recovery');
