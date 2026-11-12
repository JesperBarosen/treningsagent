-- Let users edit and delete their own sessions from the app (PATCH and DELETE
-- /sessions/{id}). Editing a climbing session replaces its climbs, so users
-- may also delete their own climbs. Deleting a session removes its climbs by
-- cascade.

create policy "Users can update their own sessions"
    on public.sessions for update to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

create policy "Users can delete their own sessions"
    on public.sessions for delete to authenticated
    using (user_id = (select auth.uid()));

create policy "Users can delete their own climbs"
    on public.climbs for delete to authenticated
    using (user_id = (select auth.uid()));

grant update (sport, date, duration_min, effort, notes, distance_km, elevation_m)
    on public.sessions to authenticated;
grant delete on public.sessions to authenticated;
grant delete on public.climbs to authenticated;
