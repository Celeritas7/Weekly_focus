-- Weekly Focus v90 · starter focus groups — OPTIONAL, run after focus-groups.sql.
-- Built from the app names visible on your Week tab. Unknown names return 'not found'
-- and are skipped; everything else stays ungrouped. Edit freely before running.

select wf_group_create('Akatsuki links',
  array['Akatsuki','Weekly focus','Cost_management','Sukkiri','Roadmap','Command_centre_advanced'],
  'Hub + the apps talking through it. Finish R016 / V2-D before new links.', true);

select wf_group_create('Language study',
  array['Scriptura','Japanese study app','KG chart']);

select wf_group_create('Commonplace & coding',
  array['Commonplace - Machine learning','Commonplace - Python','Commonplace - SQL','Commonplace - BAT','Code_sensei']);

select * from wf_group_list();
