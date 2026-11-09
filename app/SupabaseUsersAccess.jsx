import React,{useCallback,useEffect,useState} from 'react';
import Dialog from './Dialog';

const input='mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm';
const button='rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-blue-800 hover:bg-slate-50 disabled:opacity-40';

export default function SupabaseUsersAccess({client,currentUser,onChange}){
  const [users,setUsers]=useState([]);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [editor,setEditor]=useState(null);
  const [draft,setDraft]=useState('');
  const isPrimary=currentUser?.isPrimaryAdmin===true;
  const refresh=useCallback(async()=>{
    setLoading(true);setError('');
    try {
      const {data,error:queryError}=await client.from('staff_profiles')
        .select('user_id,username,display_name,staff_code,role,is_primary_admin')
        .order('display_name',{ascending:true});
      if(queryError)throw queryError;
      setUsers(data||[]);
    }catch(err){setError(err.message||'Could not load users.');}
    finally{setLoading(false);}
  },[client]);
  useEffect(()=>{void refresh();},[refresh]);
  function open(action,person){
    setEditor({action,person});
    setDraft(action==='code'?person.staff_code||'':action==='role'?person.role:'');
    setError('');setNotice('');
  }
  async function perform(event){
    event.preventDefault();
    if(!editor)return;
    if(editor.action==='delete'&&!window.confirm('Permanently delete '+(editor.person.display_name||editor.person.username)+'? This cannot be undone.'))return;
    setBusy(true);setError('');
    const {data,error:fnError}=await client.functions.invoke('staff-admin-users',{
      body:{action:editor.action==='code'?'set_staff_code':editor.action==='role'?'set_role':
        editor.action==='password'?'reset_password':'delete_user',
        userId:editor.person.user_id,
        ...(editor.action==='code'?{staffCode:draft}:{}),
        ...(editor.action==='role'?{role:draft}:{}),
        ...(editor.action==='password'?{password:draft}:{})},
    });
    try {
      if(fnError){
        // Supabase exposes detailed error messages in the function response body.
        const payload=await fnError.context?.json?.().catch(()=>null);
        throw new Error(payload?.error||fnError.message);
      }
      if(data?.error)throw new Error(data.error);
      setEditor(null);setDraft('');
      setNotice(editor.action==='delete'?'User deleted.':'User settings updated.');
      await refresh();
      if(onChange)await onChange();
    }catch(err){setError(err.message||'Could not change this user.');}
    finally{setBusy(false);}
  }
  const protectedAccount=person=>person.is_primary_admin||person.user_id===currentUser?.id;
  const mayDelete=person=>!protectedAccount(person)&&(person.role==='user'||isPrimary);
  return <section className="overflow-hidden rounded-xl border bg-white">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
      <div><h2 className="font-semibold">Users &amp; access</h2>
        <p className="text-xs text-slate-500">All admins can view staff accounts and delete regular users.
          Only the primary admin can reset passwords or change roles.</p></div>
      <button className={button} type="button" disabled={loading||busy} onClick={refresh}>Refresh</button>
    </header>
    {loading&&<p className="p-4 text-sm text-slate-600">Loading users…</p>}
    {error&&!editor&&<p role="alert" className="p-4 text-sm text-red-700">{error}</p>}
    {notice&&<p role="status" className="p-4 text-sm text-green-800">{notice}</p>}
    <div className="overflow-x-auto"><table className="w-full text-left text-sm">
      <thead className="bg-slate-50 text-xs text-slate-600"><tr>
        {['Full name','Username','Role','Staff code / IHG','Actions'].map(label=>
          <th key={label} className="whitespace-nowrap border-b px-4 py-3">{label}</th>)}
      </tr></thead>
      <tbody className="divide-y">{users.map(person=><tr key={person.user_id}>
        <th className="whitespace-nowrap px-4 py-3 font-medium">{person.display_name||person.username||'Staff'}
          {person.user_id===currentUser?.id&&<span className="ml-2 text-xs text-slate-400">(You)</span>}</th>
        <td className="px-4 py-3">{person.username||'—'}</td>
        <td className="px-4 py-3">{person.role==='admin'?'Admin':'User'}
          {person.is_primary_admin&&<span className="ml-1 text-xs text-slate-500">(Primary)</span>}</td>
        <td className="px-4 py-3">{person.staff_code||'Not linked'}</td>
        <td className="px-4 py-3"><div className="flex flex-wrap gap-2">
          {!person.is_primary_admin&&<button className={button} disabled={busy}
            onClick={()=>open('code',person)}>Edit staff code</button>}
          {isPrimary&&!person.is_primary_admin&&<button className={button} disabled={busy}
            onClick={()=>open('role',person)}>Edit role</button>}
          {isPrimary&&!person.is_primary_admin&&<button className={button} disabled={busy}
            onClick={()=>open('password',person)}>Reset password</button>}
          {mayDelete(person)&&<button className={button+' text-red-700'} disabled={busy}
            onClick={()=>open('delete',person)}>Delete user</button>}
        </div></td>
      </tr>)}</tbody>
    </table>{!users.length&&!loading&&<p className="p-4 text-sm text-slate-500">No accounts found.</p>}</div>
    <p className="px-4 py-3 text-xs text-slate-500">Passwords are never displayed or stored in this interface.
      The assigned staff code must match the IHG table. Deleting an account does not delete historical hotel requests.</p>
    {editor&&<Dialog title={editor.action==='password'?'Reset password':
      editor.action==='delete'?'Delete user':editor.action==='role'?'Change role':'Link staff code'}
      onClose={()=>!busy&&setEditor(null)}>
      <form onSubmit={perform} className="space-y-4 p-5">
        <p className="text-sm">{editor.person.display_name||editor.person.username}</p>
        {editor.action==='code'&&<label className="block text-xs">Staff code (e.g. A/B)
          <input className={input} maxLength={32} value={draft} onChange={e=>setDraft(e.target.value)}/>
        </label>}
        {editor.action==='role'&&<label className="block text-xs">Role
          <select className={input} value={draft} onChange={e=>setDraft(e.target.value)}>
            <option value="user">User</option><option value="admin">Admin</option>
          </select>
        </label>}
        {editor.action==='password'&&<label className="block text-xs">New password
          <input className={input} type="password" autoComplete="new-password"
            required minLength={6} maxLength={128} value={draft} onChange={e=>setDraft(e.target.value)}/>
        </label>}
        {editor.action==='delete'&&<p className="text-sm text-red-700">
          This permanently deletes the user login. Their hotel request history is retained.
        </p>}
        {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex gap-3">
          <button type="submit" disabled={busy} className={'rounded-lg px-4 py-2 text-sm text-white disabled:opacity-40 '+(editor.action==='delete'?'bg-red-700':'bg-blue-700')}>
            {busy?'Saving…':editor.action==='delete'?'Delete user':'Save changes'}
          </button>
          <button type="button" className="text-sm" disabled={busy}
            onClick={()=>{setEditor(null);setError('');}}>Cancel</button>
        </div>
      </form>
    </Dialog>}
  </section>;
}
