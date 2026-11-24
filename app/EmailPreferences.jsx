import {useEffect,useState} from 'react';
import Dialog from './Dialog';

export function EmailFields({draft,setDraft,role,personal=false,requiredEmail=false}){
  return <><label className="block">Notification email<input type="email" maxLength={254} value={draft.email} required={requiredEmail&&(role==='admin'||draft.hotel||draft.transfer)}
          onChange={e=>setDraft({...draft,email:e.target.value})} className="mt-1 block w-full border rounded p-2"/></label>
          {role==='admin'?<p>Administrators receive all workspace activity alerts.</p>:<fieldset className="space-y-2"><legend>Updates about {personal?'your':'this user’s'} requests</legend>
            {[['hotel','Hotel'],['transfer','Transfers']].map(([key,label])=><label className="block" key={key}><input type="checkbox" checked={draft[key]} onChange={e=>setDraft({...draft,[key]:e.target.checked})}/> {label}</label>)}</fieldset>}</>;
}

export default function EmailPreferences({client,id,role,name,personal=false}){
  const [open,setOpen]=useState(false),[first,setFirst]=useState(false);
  const [draft,setDraft]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    if(!personal && !revision)return;
    let active=true;
    setDraft(null);setError('');
    client.rpc('staff_get_mail_preferences',{target:id}).then(({data,error})=>{
      if(!active)return;
      if(error){setError(error.code==='PGRST202'?'Email preferences require the updated admin-request-email.sql migration.':error.message);return;}
      setDraft(data);
      if(personal && !revision && role!=='admin' && !data.configured){setFirst(true);setOpen(true);}
    }).catch(err=>{if(active)setError(err.message);});
    return ()=>{active=false;};
  },[client,id,role,personal,revision]);
  async function save(decline){
    if(busy||!draft)return;
    setBusy(true);setError('');
    try{
      const {error}=await client.rpc('staff_save_mail_preferences',{target:id,address:decline?'':draft.email,
        hotel_updates:!decline&&draft.hotel,transfer_updates:!decline&&draft.transfer});
      if(error)throw error;
      setFirst(false);setOpen(false);
    }catch(err){setError(err.message);}
    finally{setBusy(false);}
  }
  function close(){
    if(busy)return;
    if(first){void save(true);return;}
    setOpen(false);
  }
  return <><button type="button" className="text-blue-700 text-sm" onClick={()=>{setRevision(v=>v+1);setOpen(true);}}>Email preferences</button>
    {open&&<Dialog title={personal?'Email preferences':'Email preferences · '+name} onClose={close}>
      <form className="p-5 space-y-4 text-sm" onSubmit={e=>{e.preventDefault();void save(false);}}>
        {error&&<p role="alert" className="text-red-700">{error}</p>}
        {draft?<><EmailFields {...{draft,setDraft,role,personal}} requiredEmail/>
          <div className="flex flex-wrap gap-4"><button disabled={busy} className="text-blue-700">Save preferences</button>
          {role!=='admin'&&<button type="button" disabled={busy} onClick={()=>save(true)}>{personal?'No email updates':'Disable updates'}</button>}</div>
        </>:!error&&<p role="status">Loading preferences…</p>}
      </form>
    </Dialog>}
  </>;
}
