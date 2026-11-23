# Staff & Travel — Supabase setup

## Automatically generated login usernames

New users enter **Name and last name** instead of choosing a username.
The signup form derives the login from the initial of the first name and
the first three letters of the final surname (for example, **Pedro Gomes → P/GOM**).
Accents are normalized, and the username is shown as a non-editable preview.
Usernames are displayed and stored in **uppercase** after the migration; sign-in
remains case-insensitive, and existing credentials and the primary administrator's
email continue working. Two people generating the same username cannot both
register with that exact handle; an administrator must resolve such a conflict.

**Required for existing Supabase projects:** Before registering anyone under the
new scheme, run [supabase/allow-slash-usernames.sql](./supabase/allow-slash-usernames.sql)
in **Supabase → SQL Editor → New query → Run**. It repairs the signup
validation function, allows `/` in usernames, and uppercases existing
profile usernames. It does not change account emails, passwords, user IDs,
or the existing private team access code. Do **not** rerun
`self-registration.sql` just to enable this change: it contains initial
team-code setup and could reset the current configured code.

> The GitHub Pages application uses Supabase Auth and a server-authorized Database. Never add your Supabase service role or secret key to this public repository.

## Administrator-only activity logs

Run [supabase/admin-activity-logs.sql](./supabase/admin-activity-logs.sql)
in **Supabase → SQL Editor → New query → Run** to enable the **Logs** tab.
The table is protected by Supabase row-level security: only authenticated
Admins may read it. Browser clients cannot insert, modify, or delete events.

It records new cloud changes to hotel requests, transfer status, shared schedule,
staff roles/departments and IHG membership records. Passwords and membership
numbers are not written to logs. Activity capture starts when the SQL is applied
and does not retrospectively recover edits that were made before installation.
Browser-only transfer-driver assignments are not cloud events and are not
included. If you install the Schedule or IHG SQL tables later, rerun this
activity-logs migration to attach their triggers.

## Transfer pickup suggestions after removing the Hotel field

Run [supabase/transfer-pickup-date-search.sql](./supabase/transfer-pickup-date-search.sql)
in Supabase SQL Editor once **after**
[supabase/shared-transfer-pickups.sql](./supabase/shared-transfer-pickups.sql).
The updated hotel request searches existing return pickups by **date and departure
airport**, no longer requiring the hidden Hotel field to match. Choosing a
suggestion copies its time and original pickup location internally, allowing
the shared transfer group and passenger count to match the existing booking.
The UI does not display legacy hotel branding or historical project defaults.
Pickup selection does not automatically guarantee a seat, arrange a driver,
or send a booking confirmation. If the migration is missing, a visible message
asks for it; free-text pickup times remain available.

## Schedule admin permissions and shared transfer passengers

To let admins edit team members' Schedule dates, run
[supabase/admin-schedule-edit.sql](./supabase/admin-schedule-edit.sql) once
in Supabase SQL Editor (after the original shared-schedule.sql).
The new admin-only RPC prevents un-migrated databases from accidentally
saving a coworker's edits under the admin's own account. Regular users
can still edit only their own dates; the Primary Admin is not a Schedule target.
All manual Schedule edits continue to be recorded in the protected Logs table
when activity logging is installed.

To let users see their transfer co-passengers, run
[supabase/transfer-copassengers.sql](./supabase/transfer-copassengers.sql)
in Supabase SQL Editor (after staff profiles and hotel requests exist).
The RPC returns only names and minimal route data for colleagues booked on
the authenticated user's exact transfer (same date, time, airport and hotel
for returns). It does not provide other people's full bookings, confirmation
numbers, or loyalty numbers. Admins retain their existing full transfer view.

Hotel Request flight-number fields accept free text and offer Database
flight suggestions: arrival flights have destination NBJ and departure flights
have origin NBJ. Previous hotel/project values are retained in Supabase for
historical integrity but the legacy defaults are no longer shown in the UI.
New requests start with neutral internal placeholders. To group pickups from
different hotel records, the pickup location must match; flights alone do not
establish that everyone can use the same vehicle.

## Shared hotel loyalty numbers and transfer pickup suggestions

These features require two additional **Supabase SQL Editor** migrations. Run
them after the existing staff, hotel, and IHG tables have been installed:

1. [supabase/auto-ihg-from-hotel.sql](./supabase/auto-ihg-from-hotel.sql):
   saves the hotel-request owner's non-empty IHG number into
   `staff_ihg_memberships`. Users cannot change another user's IHG record.
   The Database → IHG screen then reads that same shared table.
2. [supabase/shared-transfer-pickups.sql](./supabase/shared-transfer-pickups.sql):
   stores driver allocations centrally and provides a limited RPC for finding
   **same-date, same-hotel, same-airport** return pickups. The request form
   shows the requesting usernames, scheduled pickup time and allocated driver,
   if any. Accepting an option sets the same pickup time so the request joins
   the existing group; it is not a booking or guaranteed seat.

The shared transfer table is administrator-controlled. Regular users can only
retrieve allocations relevant to their own requests and matching pickup
suggestions; they cannot enumerate another person's hotel or flight details.
The current GitHub Pages/Cloudflare frontend works after those SQL migrations,
without another Edge Function deployment. If the SQL is missing, the request
form allows manual pickup times but explains why suggestions are unavailable.
Existing browser-only driver selections made on the **same browser and
domain** are imported when an admin opens the app after the migration; local
storage on a different domain cannot be migrated automatically.

## Shared Schedule directory

**All registered users and admins** appear as team members in Schedule, including their Department tags. The **Primary Admin is deliberately excluded** from the Schedule roster. Ordinary users do not receive everyone's complete staff profile or IHG membership number.

To activate team visibility for ordinary users, run [supabase/schedule-directory.sql](./supabase/schedule-directory.sql) in Supabase SQL Editor once. This adds a read-only, authenticated, server-checked directory RPC and does not weaken the existing row-level security policies on `staff_profiles`.

The directory migration synchronizes **who appears**, but does not synchronize
their daily statuses. To share everyone's Onsite, Offsite, F-Day, Vacation, and
Other dates, also run [supabase/shared-schedule.sql](./supabase/shared-schedule.sql)
in the Supabase SQL Editor. This sets up the protected shared schedule table,
read permissions for all registered staff, and authenticated RPCs that let each
person edit **only their own dates**.

If this shared-schedule migration is missing, the application displays an explicit
warning and does **not** claim that a new Schedule edit was saved. Existing
browser-only schedule entries are preserved and, once the SQL is installed,
are imported into the shared table for the signed-in user on page refresh.
Conflicting shared entries are never overwritten. Each person should sign in
on the browser where they made their previous local edits, then reload once
to import their dates. Other users can then reload or refocus the site to see
the synchronized schedule. The Primary Admin remains excluded from the roster.

## Department tags

The staff admin table and the Edit user dialog now support three Department values:
**TMO**, **Cost Excellence**, and **Revenue Enhancement** (or Unassigned).
The selected department also appears as a color-coded tag on the Schedule and can be used to filter team members.

To enable this in an existing project, complete **both** steps:
1. Run [supabase/departments.sql](./supabase/departments.sql) in the Supabase SQL Editor.
   This adds the validated `staff_profiles.department` column without changing existing users.
2. Replace the deployed Edge Function `staff-admin-users` with the current version of
   [supabase/functions/staff-admin-users/index.ts](./supabase/functions/staff-admin-users/index.ts)
   using Supabase → Edge Functions → `staff-admin-users` → Editor → Deploy.

The frontend alone cannot save departments until the Supabase migration and the Edge Function update are complete.
All admins can assign departments. This does not change the user's User/Admin permissions.

## Activate shared hotels and administrator user management

The frontend source has been published, but these two backend steps **must** be completed in the Supabase dashboard before the new features work.

### 1. Run the database migration

1. Open Supabase Dashboard → your project → **SQL Editor → New query**.
2. Copy the entire contents of [supabase/admin-and-hotels.sql](./supabase/admin-and-hotels.sql) from this repository.
3. Paste into the editor and choose **Run**.
4. Inspect the last result: the existing main email-based Admin should have `is_primary_admin = true`.

This migration:
- Enables shared hotel requests with RLS.
- Lets admins see and modify all hotel requests; staff see and modify only their own requests.
- Allows admins to read registered staff profiles.
- Makes the principal account a protected Primary Admin.
- Prevents browser clients from modifying profile roles or primary-admin flags directly.
- Preserves hotel history if a user is deleted.

### 2. Deploy the secure admin Edge Function

1. Open Supabase Dashboard → **Edge Functions → Deploy a new function → Via Editor**.
2. Set the function name to exactly **`staff-admin-users`**.
3. Copy the contents of [supabase/functions/staff-admin-users/index.ts](./supabase/functions/staff-admin-users/index.ts) into the code editor, replacing the template content.
4. Click **Deploy function**.
5. The server-side Supabase environment must provide `SUPABASE_URL` and a service role or secret key, supplied by Supabase itself. Never paste these keys into the GitHub Pages app or GitHub Actions public variables.

The function verifies the caller's current authenticated Supabase session and checks admin/primary-admin status inside the database before performing any changes.

The admin panel can then:
- **All admins:** list registered staff, promote users to Admin, demote other non-primary admins to User, delete non-admin users, link verified staff codes, and edit all hotel requests.
- **Primary Admin only:** reset another user's password (e.g. `test01`) and delete another admin.
- **Nobody:** read or reveal existing passwords; Supabase stores password hashes.

The Primary Admin account and deleting your own account are blocked from deletion.

### 3. Try it in the browser

Open [Staff & Travel](https://pedrogomeslcb.github.io/staff-travel/), sign in as the primary admin, open **Database → Users & access** and test the user table. Open **Hotel & flights** to see shared hotel requests from all registered users.

New employees register on **Create account** using their chosen username, password and private team access code from the earlier [self-registration.sql](./supabase/self-registration.sql) setup.

**IHG setup:** After the other SQL setup steps, also run [supabase/ihg-by-username.sql](./supabase/ihg-by-username.sql) in Supabase SQL Editor. This creates a username-linked IHG table, migrates matches such as username `pg` / staff code `P/G`, and preserves unlinked legacy entries. Admins can edit IHG by username in Database → IHG or Database → Users & access. Staff code and IHG membership are separate values. New hotel requests prefill the authenticated user's IHG number, which other ordinary users cannot browse.\n\n**Important:** Existing hotel requests previously saved in a browser demo are not automatically migrated into the shared database. Schedule edits and transfer driver allocations remain local until a separate shared roster migration. No automatic bookings or e-mails are generated by the site.

### Days in country, Excel and administrator notifications

Run `supabase/team-flight-dates.sql` in the project's SQL Editor to enable
team-wide calendar-day reporting from arrival through return departure. The
Schedule panel and the workbook include future active itineraries in the
calendar-year projection. Before installation, administrators can use their
visible reservations and ordinary users see their own flight totals.

**Export to Excel** downloads the current account's visible workspace, across
all dates. Administrators also receive the database directories, users and logs.

To enable automatic mail in the connected Supabase project:

1. Install the existing activity logs and shared transfer migrations, then run
   `supabase/admin-request-email.sql`. Only new hotel and transfer events are queued.
2. In Supabase Vault add `staff_resend_api_key` (a Resend sending key) and
   `staff_email_from` (a verified sender). Keep both server-side.
3. Each administrator signs in and saves their real mailbox under **Database →
   My email for hotel and transfer alerts**. Pending events wait for an address.
4. After an authorized request change, check the admin inbox and the provider
   delivery log. Supabase Cron dispatches every minute. In SQL Editor, inspect
   `select event_id, user_id, attempts, last_status, delivered_at from staff_mail.outbox order by event_id desc;`.
   A delivery timestamp means the mail provider accepted the message. Failed
   requests retry up to eight times. Correct the configuration before requeuing
   failed events. The worker checks the current admin role before dispatch.
