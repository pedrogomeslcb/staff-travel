import React,{useCallback,useEffect,useState} from 'react';
import {supabase} from '../lib/supabase-client.mjs';
import StaffPlanner from './StaffPlanner';

const input='w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm';
const button='rounded-lg bg-blue-700 px-4 py-2.5 text-white disabled:opacity-50';
const usernameDomain='users.staff-travel.example.com';

// Supabase Auth natively signs in with an email or phone number, not a username.
// Usernames are mapped to reserved-domain identifiers; colleagues never need an email inbox.
function signInIdentifier(value) {
  const identifier=value.trim().toLowerCase();
  if(identifier.includes('@')) {
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier))throw new Error('Enter a valid administrator email.');
    return identifier;
  }
  if(!/^[a-z0-9][a-z0-9._-]{1,31}$/.test(identifier))
    throw new Error('Username must have 2–32 letters, numbers, dots, underscores or hyphens.');
  return identifier+'@'+usernameDomain;
}

export default function SupabaseGate() {
  const [identity,setIdentity]=useState(undefined);
  const [loginName,setLoginName]=useState('');
  const [view,setView]=useState('login');
  const [fullName,setFullName]=useState('');
  const [teamCode,setTeamCode]=useState('');
  const [confirmPassword,setConfirmPassword]=useState('');
  const [notice,setNotice]=useState('');
  const [password,setPassword]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const loadIdentity=useCallback(async()=>{
    if(!supabase)return;
    const {data:{user},error:authError}=await supabase.auth.getUser();
    if(authError||!user){setIdentity(null);return;}
    const {data:profile,error:profileError}=await supabase.from('staff_profiles')
      .select('role,staff_code,display_name').eq('user_id',user.id).maybeSingle();
    if(profileError){setIdentity(null);setError('Could not check account permissions: '+profileError.message);return;}
    if(!profile||!['admin','user'].includes(profile.role)){
      setIdentity(null);
      setError('This account is not registered in staff_profiles. Ask an administrator to grant access.');
      return;
    }
    setError('');
    setIdentity({
      id:user.id,
      name:profile.display_name||profile.staff_code||user.email?.split('@')[0]||'Staff',
      role:profile.role,
      staffCode:profile.staff_code||null,
    });
  },[]);
  useEffect(()=>{
    if(!supabase)return;
    let active=true;
    const refresh=()=>{if(active)void loadIdentity().catch(err=>{if(active){setIdentity(null);setError(err.message);}});};
    refresh();
    const {data:{subscription}}=supabase.auth.onAuthStateChange(()=>{setTimeout(refresh,0);});
    window.addEventListener('focus',refresh);
    return ()=>{active=false;subscription.unsubscribe();window.removeEventListener('focus',refresh);};
  },[loadIdentity]);
  async function login(event){
    event.preventDefault();
    setBusy(true);setError('');
    try {
      const email=signInIdentifier(loginName);
      const {error:loginError}=await supabase.auth.signInWithPassword({email,password});
      if(loginError)setError(loginError.message);
      else await loadIdentity();
    }catch(err){setError(err.message);}
    finally {setPassword('');setBusy(false);}
  }
  async function register(event) {
    event.preventDefault();
    setError('');setNotice('');
    const username=loginName.trim().toLowerCase();
    if(username.includes('@')){setError('Choose a username without @.');return;}
    if(['admin','root','system','support'].includes(username)){setError('This username is reserved. Choose another.');return;}
    if(!/^[a-z0-9][a-z0-9._-]{1,31}$/.test(username)) {
      setError('Username must be 2–32 characters using letters, digits, dots, _ or -.');return;
    }
    if(fullName.trim().length<2){setError('Enter your full name.');return;}
    if(password.length<6){setError('Choose a password with at least 6 characters.');return;}
    if(password!==confirmPassword){setError('Passwords do not match.');return;}
    if(!teamCode.trim()){setError('Enter the team access code.');return;}
    setBusy(true);
    try {
      const {data,error:signupError}=await supabase.auth.signUp({
        email:signInIdentifier(username),
        password,
        options:{data:{full_name:fullName.trim(),team_access_code:teamCode.trim()}},
      });
      if(signupError)throw signupError;
      setPassword('');setConfirmPassword('');setTeamCode('');
      if(!data.session){
        setNotice('Account request received but email confirmation is enabled. This username-only setup requires turning off Confirm email in Supabase.');
        setView('login');
      }else {
        await loadIdentity();
      }
    } catch(err) {
      setError(err.message||'Could not create account. Check your username and team access code.');
    } finally {setBusy(false);}
  }
  async function signOut(){
    setBusy(true);
    const {error:logoutError}=await supabase.auth.signOut();
    if(logoutError)setError(logoutError.message);
    else {setIdentity(null);setPassword('');}
    setBusy(false);
  }
  if(!supabase)return <div className="mx-auto mt-20 max-w-xl rounded-xl border bg-white p-8 text-sm text-red-800">
    The Supabase connection is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY
    as GitHub Actions repository variables, then rerun the publish workflow.
  </div>;
  if(identity===undefined)return <div className="p-8 text-center text-sm">Checking account permissions…</div>;
  if(identity)return <StaffPlanner key={identity.id+'-'+identity.role+'-'+identity.staffCode} mode="supabase"
    initialUser={identity} loginName={identity.name} supabaseClient={supabase} onSupabaseSignOut={signOut}/>;
  return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-5">
    <div className="w-full max-w-md space-y-4 rounded-2xl border bg-white p-7 shadow-sm">
      <h1 className="text-2xl font-semibold text-blue-900">Staff & Travel</h1>
      <div className="grid grid-cols-2 rounded-lg border bg-slate-50 p-1 text-sm">
        <button type="button" className={view==='login'?'rounded-md bg-white p-2 font-semibold shadow-sm':'p-2 text-slate-600'}
          onClick={()=>{setView('login');setError('');setNotice('');setPassword('');}}>Sign in</button>
        <button type="button" className={view==='register'?'rounded-md bg-white p-2 font-semibold shadow-sm':'p-2 text-slate-600'}
          onClick={()=>{setView('register');setError('');setNotice('');setPassword('');}}>Create account</button>
      </div>
      <p className="text-sm text-slate-600">{view==='register'
        ?'New team members can create their own login using the internal team access code. Accounts always start as User.'
        :'Sign in with your username and password. The primary administrator may use an email address.'}</p>
      <form onSubmit={view==='register'?register:login} className="space-y-4">
        {view==='register'&&<label className="block text-sm">Full name<input type="text" required maxLength={120}
          autoComplete="name" className={input+' mt-1'} value={fullName}
          onChange={e=>setFullName(e.target.value)}/></label>}
        <label className="block text-sm">Username {view==='login'?'(or primary admin email)':''}
          <input type="text" required autoComplete="username"
            placeholder="e.g. pg" className={input+' mt-1'} value={loginName}
            onChange={e=>setLoginName(e.target.value)}/></label>
        <label className="block text-sm">Password<input type="password" required
          autoComplete={view==='register'?'new-password':'current-password'}
          minLength={view==='register'?6:undefined}
          className={input+' mt-1'} value={password} onChange={e=>setPassword(e.target.value)}/></label>
        {view==='register'&&<>
          <label className="block text-sm">Confirm password<input type="password" required minLength={6}
            autoComplete="new-password" className={input+' mt-1'} value={confirmPassword}
            onChange={e=>setConfirmPassword(e.target.value)}/></label>
          <label className="block text-sm">Team access code<input type="password" required
            autoComplete="off" className={input+' mt-1'} value={teamCode}
            onChange={e=>setTeamCode(e.target.value)}/></label>
          <p className="text-xs text-amber-800">You can register without an admin. Your IHG membership is linked separately after identity verification; the registration code does not grant access to anyone else's membership.</p>
        </>}
        <button className={button+' w-full'} disabled={busy}>{busy?'Processing…':view==='register'?'Create account':'Sign in'}</button>
      </form>
      {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice&&<p role="status" className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{notice}</p>}
      {view==='login'&&<button className="text-xs text-slate-600 underline" disabled={busy} onClick={signOut}>Clear current session</button>}
      <p className="text-xs text-amber-900">Only the reference Database is shared. Hotel requests and schedules are still local
        to this browser until a secure shared workspace is configured.</p>
    </div>
  </main>;
}
