import React,{useCallback,useEffect,useState} from 'react';
import Dialog from './Dialog';

const input='mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm';
const button='rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-blue-800 hover:bg-slate-50 disabled:opacity-40';
const normalizeCode=value=>String(value??'').trim().toUpperCase();
const personName=person=>person.display_name||person.username||'Staff';

export default function SupabaseUsersAccess({client,currentUser,onChange}){
  const [users,setUsers]=useState([]);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [editor,setEditor]=useState(null);
  const isPrimary=currentUser?.isPrimaryAdmin===true;

  const refresh=useCallback(async()=>{
    setLoading(true);
    try {
      const [profiles,memberships]=await Promise.all([
        client.from('staff_profiles')
          .select('user_id,username,display_name,staff_code,role,is_primary_admin')
          .order('display_name',{ascending:true}),
        client.from('staff_ihg_memberships').select('user_id,membership'),
      ]);
      if(profiles.error)throw profiles.error;
      if(memberships.error)throw memberships.error;
      const byUser=new Map((memberships.data||[]).map(row=>[row.user_id,row.membership]));
      setUsers((profiles.data||[]).map(person=>({
        ...person,ihgMembership:byUser.get(person.user_id)||'',
      })));
    }catch(err){setError(err.message||'Could not load users.');}
    finally{setLoading(false);}
  },[client]);
  useEffect(()=>{void refresh();},[refresh]);

  const protectedAccount=person=>person.is_primary_admin||person.user_id===currentUser?.id;
  const mayDelete=person=>!protectedAccount(person)&&(person.role==='user'||isPrimary);
  const mayEditRole=person=>!protectedAccount(person);
  const mayEditCode=person=>!person.is_primary_admin;
  const mayResetPassword=person=>isPrimary&&!person.is_primary_admin;

  function open(person){
    setEditor({
      person,
      staffCode:person.staff_code||'',
      ihgMembership:person.ihgMembership||'',
      role:person.role,
      newPassword:'',
    });
    setError('');
    setNotice('');
  }
  function updateEditor(field,value){
    setEditor(previous=>({...previous,[field]:value}));
  }
  function close(){
    if(!busy){setEditor(null);setError('');}
  }

  async function adminAction(action,userId,payload={}){
    const {data,error:fnError}=await client.functions.invoke('staff-admin-users',{
      body:{action,userId,...payload},
    });
    if(fnError){
      let detail;
      try {
        if(typeof fnError.context?.json==='function')
          detail=await fnError.context.json();
      }catch{}
      throw new Error(detail?.error||fnError.message||'Could not update the account.');
    }
    if(data?.error)throw new Error(data.error);
  }

  async function finish(message){
    setEditor(null);
    setError('');
    setNotice(message);
    await refresh();
    if(onChange)await onChange();
  }

  async function save(event){
    event.preventDefault();
    if(busy||!editor)return;
    const person=editor.person;
    const staffCode=normalizeCode(editor.staffCode);
    const ihgMembership=editor.ihgMembership.trim();
    const newPassword=editor.newPassword;
    const codeChanged=mayEditCode(person)&&staffCode!==normalizeCode(person.staff_code);
    const ihgChanged=ihgMembership!==(person.ihgMembership||'');
    const roleChanged=mayEditRole(person)&&editor.role!==person.role;
    const passwordChanged=mayResetPassword(person)&&newPassword.length>0;

    if(staffCode.length>32||ihgMembership.length>64){
      setError('Staff code may have at most 32 characters and IHG membership at most 64.');
      return;
    }
    if(passwordChanged&&(newPassword.length<6||newPassword.length>128)){
      setError('A new password must contain between 6 and 128 characters.');
      return;
    }
    if(!codeChanged&&!ihgChanged&&!roleChanged&&!passwordChanged){
      setNotice('No changes to save.');
      setEditor(null);
      return;
    }

    setBusy(true);setError('');
    let completed=0;
    try {
      if(codeChanged){
        await adminAction('set_staff_code',person.user_id,{staffCode});
        completed++;
      }
      if(ihgChanged){
        const {error:membershipError}=ihgMembership
          ?await client.from('staff_ihg_memberships').upsert({
            user_id:person.user_id,
            membership:ihgMembership,
            updated_at:new Date().toISOString(),
          })
          :await client.from('staff_ihg_memberships')
            .delete().eq('user_id',person.user_id);
        if(membershipError)throw membershipError;
        completed++;
      }
      if(roleChanged){
        await adminAction('set_role',person.user_id,{role:editor.role});
        completed++;
      }
      if(passwordChanged){
        await adminAction('reset_password',person.user_id,{password:newPassword});
        completed++;
      }
      await finish('User updated.');
    }catch(err){
      // Multiple settings use separate requests and cannot be committed atomically.
      // Show an explicit partial-save warning instead of implying a full success.
      if(completed){
        try{await refresh();if(onChange)await onChange();}catch{}
      }
      setError((completed?'Some changes were saved, but not all. ':'')+
        (err.message||'Could not save user.')+
        (completed?' Close and reopen this user to review the saved values.':''));
    }finally{setBusy(false);}
  }

  async function deleteUser(){
    if(!editor||busy||!mayDelete(editor.person))return;
    const person=editor.person;
    if(!window.confirm('Permanently delete '+personName(person)+'? This cannot be undone.'))return;
    setBusy(true);setError('');
    try {
      await adminAction('delete_user',person.user_id);
      await finish('User deleted. Existing hotel requests have been retained.');
    }catch(err){
      setError(err.message||'Could not delete user.');
    }finally{setBusy(false);}
  }

  return <section className="overflow-hidden rounded-xl border bg-white">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
      <div>
        <h2 className="font-semibold">Users &amp; access</h2>
        <p className="text-xs text-slate-500">
          Admins can manage users and roles. Password resets and deleting other admins
          are restricted to the primary admin.
        </p>
      </div>
      <button className={button} type="button" disabled={loading||busy} onClick={()=>{setError('');void refresh();}}>Refresh</button>
    </header>
    {loading&&<p className="p-4 text-sm text-slate-600">Loading users…</p>}
    {error&&!editor&&<p role="alert" className="p-4 text-sm text-red-700">{error}</p>}
    {notice&&<p role="status" className="p-4 text-sm text-green-800">{notice}</p>}
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs text-slate-600"><tr>
          {['Full name','Username','Role','Staff code','IHG membership','Actions'].map(label=>
            <th key={label} className="whitespace-nowrap border-b px-4 py-3">{label}</th>)}
        </tr></thead>
        <tbody className="divide-y">{users.map(person=><tr key={person.user_id}>
          <th className="whitespace-nowrap px-4 py-3 font-medium">
            {personName(person)}
            {person.user_id===currentUser?.id&&<span className="ml-2 text-xs text-slate-400">(You)</span>}
          </th>
          <td className="px-4 py-3">{person.username||'—'}</td>
          <td className="px-4 py-3">
            {person.role==='admin'?'Admin':'User'}
            {person.is_primary_admin&&<span className="ml-1 text-xs text-slate-500">(Primary)</span>}
          </td>
          <td className="px-4 py-3">{person.staff_code||'—'}</td>
          <td className="px-4 py-3">{person.ihgMembership||'Not linked'}</td>
          <td className="px-4 py-3">
            <button type="button" className={button} disabled={busy}
              onClick={()=>open(person)}>Edit user</button>
          </td>
        </tr>)}</tbody>
      </table>
      {!users.length&&!loading&&<p className="p-4 text-sm text-slate-500">No accounts found.</p>}
    </div>
    <p className="px-4 py-3 text-xs text-slate-500">
      Staff code and IHG membership are separate. Passwords cannot be viewed.
      Deleting a user preserves their historical hotel requests.
    </p>

    {editor&&<Dialog wide title={'Edit user · '+personName(editor.person)} onClose={close}>
      <form onSubmit={save} className="space-y-5 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-xs text-slate-600">Full name
            <input className={input+' bg-slate-50'} readOnly value={personName(editor.person)}/>
          </label>
          <label className="block text-xs text-slate-600">Username
            <input className={input+' bg-slate-50'} readOnly value={editor.person.username||''}/>
          </label>
          <label className="block text-xs text-slate-600">Staff code
            <input className={input+(!mayEditCode(editor.person)?' bg-slate-50':'')}
              readOnly={!mayEditCode(editor.person)} maxLength={32}
              placeholder="e.g. P/G" value={editor.staffCode}
              onChange={e=>updateEditor('staffCode',e.target.value)}/>
          </label>
          <label className="block text-xs text-slate-600">IHG membership number
            <input className={input} maxLength={64} placeholder="Hotel loyalty number"
              value={editor.ihgMembership}
              onChange={e=>updateEditor('ihgMembership',e.target.value)}/>
          </label>
          <label className="block text-xs text-slate-600">Role
            <select className={input+(!mayEditRole(editor.person)?' bg-slate-50':'')}
              disabled={!mayEditRole(editor.person)} value={editor.role}
              onChange={e=>updateEditor('role',e.target.value)}>
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          {mayResetPassword(editor.person)&&<label className="block text-xs text-slate-600">New password (optional)
            <input className={input} type="password" autoComplete="new-password"
              minLength={6} maxLength={128} placeholder="Leave blank to keep current password"
              value={editor.newPassword}
              onChange={e=>updateEditor('newPassword',e.target.value)}/>
          </label>}
        </div>
        {editor.person.is_primary_admin&&<p className="text-xs text-slate-500">
          The primary admin account is protected: its role, staff code and access cannot be changed here.
        </p>}
        {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          <button type="submit" disabled={busy}
            className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm text-white disabled:opacity-40">
            {busy?'Saving…':'Save changes'}
          </button>
          <button type="button" disabled={busy} onClick={close}
            className="rounded-lg border px-4 py-2.5 text-sm">Cancel</button>
          {mayDelete(editor.person)&&<button type="button" disabled={busy}
            onClick={deleteUser}
            className="ml-auto rounded-lg border border-red-200 px-4 py-2.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-40">
            Delete user
          </button>}
        </div>
      </form>
    </Dialog>}
  </section>;
}
