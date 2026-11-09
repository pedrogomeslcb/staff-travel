// Supabase Edge Function: staff-admin-users
// Deploy using Supabase Dashboard > Edge Functions > Deploy a new function > Via Editor.
// Service credentials are read only from Supabase's server-side environment.
// NEVER add service/secret keys to GitHub or to the browser build.
import {createClient} from 'npm:@supabase/supabase-js@2';

const cors={
  'Access-Control-Allow-Origin':'https://pedrogomeslcb.github.io',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Content-Type':'application/json',
  'Cache-Control':'no-store',
};
function reply(status,payload){
  return new Response(JSON.stringify(payload),{status,headers:cors});
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(request.method!=='POST')return reply(405,{error:'Method not allowed.'});

  const origin=request.headers.get('origin');
  if(origin && origin!=='https://pedrogomeslcb.github.io')
    return reply(403,{error:'Origin not allowed.'});

  try {
    const url=Deno.env.get('SUPABASE_URL');
    const allKeys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
    const secretKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||
      Object.values(allKeys).find(v=>typeof v==='string' && v.startsWith('sb_secret_'));
    if(!url||!secretKey)return reply(503,{error:'Server-side admin credentials are not configured.'});
    const admin=createClient(url,secretKey,{auth:{autoRefreshToken:false,persistSession:false}});

    const token=request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if(!token)return reply(401,{error:'Sign in first.'});
    const {data:{user},error:verifyError}=await admin.auth.getUser(token);
    if(verifyError||!user)return reply(401,{error:'Session is invalid or expired.'});

    const {data:actor,error:actorError}=await admin.from('staff_profiles')
      .select('role,is_primary_admin').eq('user_id',user.id).maybeSingle();
    if(actorError||actor?.role!=='admin')return reply(403,{error:'Admin access is required.'});
    const isPrimary=actor.is_primary_admin===true;
    const body=await request.json();
    const action=String(body?.action||'');
    const targetId=String(body?.userId||'');
    if(!uuid.test(targetId))return reply(400,{error:'Invalid user identifier.'});

    const {data:target,error:targetError}=await admin.from('staff_profiles')
      .select('user_id,role,is_primary_admin,display_name,username,staff_code')
      .eq('user_id',targetId).maybeSingle();
    if(targetError||!target)return reply(404,{error:'User account not found.'});
    if(target.is_primary_admin)return reply(403,{error:'The primary admin account is protected.'});

    if(action==='delete_user'){
      if(targetId===user.id)return reply(403,{error:'You cannot delete your own account.'});
      if(target.role==='admin'&&!isPrimary)
        return reply(403,{error:'Only the primary admin can delete other admins.'});
      const {error}=await admin.auth.admin.deleteUser(targetId);
      if(error)throw error;
      // staff_profiles deletes on CASCADE; hotel history is retained without its FK.
      return reply(200,{ok:true});
    }
    if(action==='reset_password'){
      if(!isPrimary)return reply(403,{error:'Only the primary admin can reset passwords.'});
      const password=body.password;
      if(typeof password!=='string'||password.length<6||password.length>128)
        return reply(400,{error:'Password must contain 6–128 characters.'});
      const {error}=await admin.auth.admin.updateUserById(targetId,{password});
      if(error)throw error;
      return reply(200,{ok:true});
    }
    if(action==='set_staff_code'){
      const staffCode=String(body.staffCode||'').trim().toUpperCase();
      if(staffCode.length>32)return reply(400,{error:'Staff code is too long.'});
      const {error}=await admin.from('staff_profiles')
        .update({staff_code:staffCode||null}).eq('user_id',targetId);
      if(error)throw error;
      return reply(200,{ok:true});
    }
    if(action==='set_role'){
      // All admins may promote or demote other accounts; nobody may alter
      // the primary admin or their own role. Access is checked server-side.
      if(targetId===user.id)return reply(403,{error:'You cannot change your own role.'});
      if(!['admin','user'].includes(body.role))return reply(400,{error:'Invalid role.'});
      const {error}=await admin.from('staff_profiles')
        .update({role:body.role}).eq('user_id',targetId);
      if(error)throw error;
      return reply(200,{ok:true});
    }
    return reply(400,{error:'Unknown action.'});
  }catch(error){
    // Deliberately do not return secrets or internal stack traces.
    return reply(400,{error: String(error?.message||'Unable to complete operation.').slice(0,300)});
  }
});
