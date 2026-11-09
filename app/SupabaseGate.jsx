import React,{useCallback,useEffect,useState} from 'react';
import {supabase} from '../lib/supabase-client.mjs';
import StaffPlanner from './StaffPlanner';

const input='w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm';
const button='rounded-lg bg-blue-700 px-4 py-2.5 text-white disabled:opacity-50';

export default function SupabaseGate() {
  const [identity,setIdentity]=useState(undefined);
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const loadIdentity=useCallback(async()=>{
    if(!supabase)return;
    const {data:{user},error:authError}=await supabase.auth.getUser();
    if(authError||!user){setIdentity(null);return;}
    const {data:profile,error:profileError}=await supabase.from('staff_profiles')
      .select('role,staff_code').eq('user_id',user.id).maybeSingle();
    if(profileError){setIdentity(null);setError('Could not check account permissions: '+profileError.message);return;}
    if(!profile||!['admin','user'].includes(profile.role)){
      setIdentity(null);
      setError('This account is not registered in staff_profiles. Ask an administrator to grant access.');
      return;
    }
    setError('');
    setIdentity({
      id:user.id,
      name:profile.staff_code||user.email?.split('@')[0]||'Staff',
      role:profile.role,
      staffCode:profile.staff_code||null,
    });
  },[]);
  useEffect(()=>{
    if(!supabase)return;
    let active=true;
    const refresh=()=>{if(active)void loadIdentity().catch(err=>{if(active){setIdentity(null);setError(err.message);}});};
    refresh();
    const {data:{subscription}}=supabase.auth.onAuthStateChange(()=>{refresh();});
    window.addEventListener('focus',refresh);
    return ()=>{active=false;subscription.unsubscribe();window.removeEventListener('focus',refresh);};
  },[loadIdentity]);
  async function login(event){
    event.preventDefault();
    setBusy(true);setError('');
    const {error:loginError}=await supabase.auth.signInWithPassword({email:email.trim(),password});
    setPassword('');
    if(loginError)setError(loginError.message);
    else await loadIdentity().catch(err=>setError(err.message));
    setBusy(false);
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
      <p className="text-sm text-slate-600">Sign in using your Supabase account. The old admin / test login is not valid here.</p>
      <form onSubmit={login} className="space-y-4">
        <label className="block text-sm">Email<input type="email" required autoComplete="username" className={input+' mt-1'}
          value={email} onChange={e=>setEmail(e.target.value)}/></label>
        <label className="block text-sm">Password<input type="password" required autoComplete="current-password"
          className={input+' mt-1'} value={password} onChange={e=>setPassword(e.target.value)}/></label>
        <button className={button+' w-full'} disabled={busy}>{busy?'Signing in…':'Sign in'}</button>
      </form>
      {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <button className="text-xs text-slate-600 underline" disabled={busy} onClick={signOut}>Clear current session</button>
      <p className="text-xs text-amber-900">Only the reference Database is shared. Hotel requests and schedules are still local
        to this browser until a secure shared workspace is configured.</p>
    </div>
  </main>;
}
