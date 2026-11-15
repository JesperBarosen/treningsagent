-- Editing a break that is on (#82): the reason, the injury details (body part,
-- pain), the note and the planned end can change without ending the break.
-- The start date never changes. The existing update policy ("Users can end
-- their own pauses") already limits updates to the user's own rows; this only
-- widens which columns the API may write. The table checks still apply
-- (planned_end >= start_date, injury fields only for an injury).
grant update (planned_end, reason, body_part, pain, note) on public.pauses to authenticated;

comment on policy "Users can end their own pauses" on public.pauses is
    'Users can end or edit (#82) their own pauses; the column grants limit what changes.';
