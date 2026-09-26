-- =====================================================================
--  Weekly Focus v92 · Vault addresses — ONE-ROW migration + one phone fix
--  Run each numbered statement on its own in Supabase → SQL Editor.
--  Before you start: close Weekly Focus on every device (or wait until it
--  shows "synced"). An unsent board change from the app would overwrite this.
--  Touches only the __board row's meta.cvault; bumps payload.u so the app
--  accepts the change on its next 15 s pull.
-- =====================================================================

-- 1) PREVIEW — before / after for "Sender: Japan 南浦和". Writes nothing.
select v->'f' as before,
       ((v->'f') - 'a1' - 'city') || jsonb_build_object(
         'ctry',        'JP',
         'postal_code', '336-0025',
         'prefecture',  '埼玉県',
         'city',        'さいたま市南区',
         'street',      '文蔵2-11-15',
         'building',    'アーバンテラス南浦和 201号',
         'romaji',      'Urban Terrace Minami-Urawa 201, 2-11-15 Bunzo, Minami-ku, Saitama-shi, Saitama 336-0025',
         'old',         jsonb_build_object('a1', v->'f'->'a1', 'city', v->'f'->'city')
       ) as after
from weekly_focus_entries e, jsonb_array_elements(e.payload->'meta'->'cvault') v
where e.item_key = '__board' and v->>'cat' = 'addr' and v->'f'->>'t' = 'Sender: Japan 南浦和';


-- 2) MIGRATE that one record. Expect "UPDATE 1".
update weekly_focus_entries e
set payload = jsonb_set(
      jsonb_set(e.payload, '{meta,cvault}', (
        select jsonb_agg(
          case when v->>'cat' = 'addr' and v->'f'->>'t' = 'Sender: Japan 南浦和'
               then jsonb_set(jsonb_set(v, '{f}',
                      ((v->'f') - 'a1' - 'city') || jsonb_build_object(
                        'ctry',        'JP',
                        'postal_code', '336-0025',
                        'prefecture',  '埼玉県',
                        'city',        'さいたま市南区',
                        'street',      '文蔵2-11-15',
                        'building',    'アーバンテラス南浦和 201号',
                        'romaji',      'Urban Terrace Minami-Urawa 201, 2-11-15 Bunzo, Minami-ku, Saitama-shi, Saitama 336-0025',
                        'old',         jsonb_build_object('a1', v->'f'->'a1', 'city', v->'f'->'city'))),
                    '{u}', to_jsonb((extract(epoch from clock_timestamp()) * 1000)::bigint))
               else v end
          order by i)
        from jsonb_array_elements(e.payload->'meta'->'cvault') with ordinality as a(v, i))),
      '{u}', to_jsonb((extract(epoch from clock_timestamp()) * 1000)::bigint)),
    updated_at = now()
where e.item_key = '__board'
  and exists (select 1 from jsonb_array_elements(e.payload->'meta'->'cvault') v
              where v->>'cat' = 'addr' and v->'f'->>'t' = 'Sender: Japan 南浦和');


-- 3) PREVIEW — phone fix for "Sender: Japan 市川". Writes nothing.
select v->'f'->>'ph' as before, '+81 9075557923' as after
from weekly_focus_entries e, jsonb_array_elements(e.payload->'meta'->'cvault') v
where e.item_key = '__board' and v->>'cat' = 'addr' and v->'f'->>'t' = 'Sender: Japan 市川';


-- 4) FIX that phone. Expect "UPDATE 1".
update weekly_focus_entries e
set payload = jsonb_set(
      jsonb_set(e.payload, '{meta,cvault}', (
        select jsonb_agg(
          case when v->>'cat' = 'addr' and v->'f'->>'t' = 'Sender: Japan 市川' and v->'f'->>'ph' = '+81 09075557923'
               then jsonb_set(jsonb_set(v, '{f,ph}', '"+81 9075557923"'),
                    '{u}', to_jsonb((extract(epoch from clock_timestamp()) * 1000)::bigint))
               else v end
          order by i)
        from jsonb_array_elements(e.payload->'meta'->'cvault') with ordinality as a(v, i))),
      '{u}', to_jsonb((extract(epoch from clock_timestamp()) * 1000)::bigint)),
    updated_at = now()
where e.item_key = '__board'
  and exists (select 1 from jsonb_array_elements(e.payload->'meta'->'cvault') v
              where v->>'cat' = 'addr' and v->'f'->>'t' = 'Sender: Japan 市川' and v->'f'->>'ph' = '+81 09075557923');


-- 5) CHECK — both records after the change.
select v->'f' as fields
from weekly_focus_entries e, jsonb_array_elements(e.payload->'meta'->'cvault') v
where e.item_key = '__board' and v->>'cat' = 'addr' and v->'f'->>'t' in ('Sender: Japan 南浦和', 'Sender: Japan 市川');
