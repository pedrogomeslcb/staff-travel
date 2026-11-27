import {PlannerError} from './planner.mjs';
export function assertCanceledDeletion(user,trip,acknowledge=false){
  if(!user?.id||user.role!=='admin')throw new PlannerError('Administrator access required.',403);
  if(!trip?.id||!trip.canceledAt||trip.archivedAt)throw new PlannerError('Only canceled, non-archived requests can be permanently deleted.');
  if(!Number.isSafeInteger(trip.revision)||trip.revision<1)throw new PlannerError('Refresh the request before deleting.',409);
  if(trip.hotelCancellationRequired&&!trip.hotelCancellationNotifiedAt&&acknowledge!==true)throw new PlannerError('Confirm that no hotel cancellation notice is outstanding.');
}
