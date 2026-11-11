-- Import Flowchart_app (8 text files) and Route Studio Offline (33 text files).
-- Source: Celeritas7/App_generation_offline commit 24b547da2f5afc7b857f0888156c9510d86713bf.
-- Client supplies wf.import_user and wf.import_rows transaction-local settings.
-- Private source content is deliberately excluded from this public repository.
-- Existing live files are preserved; all destination folders must already exist.
DO $import$
DECLARE target_user uuid := current_setting('wf.import_user')::uuid;
        items jsonb := current_setting('wf.import_rows')::jsonb;
BEGIN
 IF jsonb_array_length(items) <> 41 THEN RAISE EXCEPTION 'Expected 41 files'; END IF;
 IF EXISTS (
   SELECT 1 FROM jsonb_array_elements(items) i
   WHERE NOT EXISTS (
     SELECT 1 FROM public.weekly_focus_entries f
     WHERE f.user_id=target_user AND f.board_id='wf-code'
       AND f.item_key='fold:'||(i->'payload'->>'folder')
       AND f.payload->>'kind'='folder' AND f.payload->>'del'='false'
   )
 ) THEN RAISE EXCEPTION 'Destination folder missing'; END IF;
 INSERT INTO public.weekly_focus_entries(user_id,board_id,item_key,payload,updated_at)
 SELECT target_user,'wf-code',i->>'item_key',i->'payload',now()
 FROM jsonb_array_elements(items) i
 WHERE NOT EXISTS (
 SELECT 1 FROM public.weekly_focus_entries e
 WHERE e.user_id=target_user AND e.board_id='wf-code'
 AND e.payload->>'folder'=i->'payload'->>'folder'
 AND e.payload->>'name'=i->'payload'->>'name'
 AND e.payload->>'del'='false')
 ON CONFLICT (user_id,board_id,item_key) DO NOTHING;
END $import$;
