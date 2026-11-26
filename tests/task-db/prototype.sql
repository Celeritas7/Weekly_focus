-- Disposable Phase 3B fixture. Install only in the test runner's fresh cluster.
CREATE ROLE wf_demo_phone LOGIN;
CREATE ROLE wf_demo_pc LOGIN;
CREATE ROLE wf_demo_cc LOGIN;
CREATE SCHEMA wf_demo;
REVOKE ALL ON SCHEMA wf_demo FROM PUBLIC;
CREATE TABLE wf_demo.actors (
  login name PRIMARY KEY, owner_id text NOT NULL, writer text NOT NULL
);
INSERT INTO wf_demo.actors VALUES
  ('wf_demo_phone','learner','wf'), ('wf_demo_pc','learner','wf'), ('wf_demo_cc','learner','cc');
CREATE TABLE wf_demo.entries (
  owner_id text, board text, item text, revision bigint NOT NULL, payload jsonb NOT NULL,
  PRIMARY KEY(owner_id,board,item)
);
CREATE TABLE wf_demo.receipts (
  owner_id text, writer text, board text, item text, operation text,
  intent jsonb NOT NULL, applied_revision bigint NOT NULL,
  PRIMARY KEY(owner_id,writer,board,item,operation)
);

CREATE FUNCTION wf_demo.actor() RETURNS SETOF wf_demo.actors
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT * FROM wf_demo.actors WHERE login = session_user
$$;
REVOKE ALL ON FUNCTION wf_demo.actor() FROM PUBLIC;

-- Retain deleted payloads and revisions; a board deletion also fences future creates.
ALTER TABLE wf_demo.entries ADD COLUMN removed boolean NOT NULL DEFAULT false;
CREATE TABLE wf_demo.closed_boards (
  owner_id text, board text, PRIMARY KEY(owner_id,board)
);
CREATE FUNCTION wf_demo.lock_board(owner_id text,board text) RETURNS void
LANGUAGE sql SET search_path = pg_catalog AS $$
  SELECT pg_advisory_xact_lock(hashtextextended(jsonb_build_array(owner_id,board)::text,0))
$$;
REVOKE ALL ON FUNCTION wf_demo.lock_board(text,text) FROM PUBLIC;

-- Compute a branch archive transition from the locked, authoritative payload.
-- NULL means the graph or requested transition needs review.
CREATE FUNCTION wf_demo.archive_tasks(tasks jsonb, target text, hiding boolean, edited bigint)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
  IF jsonb_typeof(tasks) IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
  IF EXISTS (SELECT FROM jsonb_array_elements(tasks) n GROUP BY n->>'id'
             HAVING nullif(n->>'id','') IS NULL OR count(*) <> 1) THEN RETURN NULL; END IF;
  WITH RECURSIVE nodes AS (
    SELECT n, ord, n->>'id' AS id, n->>'parentId' AS parent,
      coalesce(n->>'del','false')='true' AS deleted,
      coalesce(n->>'archived','false')='true' AS archived
    FROM jsonb_array_elements(tasks) WITH ORDINALITY t(n,ord)
  ), walk AS (
    SELECT id, ARRAY[id] AS path, NOT deleted AS available,
      NOT deleted AND NOT (CASE WHEN id=target THEN hiding ELSE archived END) AS active
    FROM nodes WHERE parent IS NULL
    UNION ALL
    SELECT c.id, w.path||c.id, w.active AND NOT c.deleted,
      w.active AND NOT c.deleted AND NOT (CASE WHEN c.id=target THEN hiding ELSE c.archived END)
    FROM walk w JOIN nodes c ON c.parent=w.id
  ), reopen AS (
    SELECT DISTINCT unnest(w.path) AS id FROM walk w JOIN nodes n USING(id)
    WHERE NOT hiding AND target=ANY(w.path) AND w.active AND coalesce(n.n->>'done','false') <> 'true'
  )
  SELECT jsonb_agg(
    CASE WHEN n.id=target OR (r.id IS NOT NULL AND n.n->>'done'='true')
      THEN n.n || jsonb_build_object('u',edited)
        || CASE WHEN n.id=target THEN jsonb_build_object('archived',hiding) ELSE '{}'::jsonb END
        || CASE WHEN r.id IS NOT NULL THEN '{"done":false}'::jsonb ELSE '{}'::jsonb END
      ELSE n.n END ORDER BY n.ord)
  INTO result FROM nodes n LEFT JOIN reopen r USING(id)
  WHERE (SELECT count(*) FROM walk)=(SELECT count(*) FROM nodes)
    AND EXISTS (SELECT FROM nodes t JOIN walk USING(id)
                WHERE t.id=target AND available AND t.archived<>hiding);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION wf_demo.archive_tasks(jsonb,text,boolean,bigint) FROM PUBLIC;

-- Limited to one-level, existing active tasks and the CC flag.
CREATE FUNCTION wf_demo.apply(p_board text, p_item text, p_op text, p_base bigint,
                              p_field text, p_sub text, p_value boolean)
RETURNS TABLE(status text, version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor wf_demo.actors%ROWTYPE;
  entry wf_demo.entries%ROWTYPE;
  receipt wf_demo.receipts%ROWTYPE;
  intent jsonb := jsonb_build_array(p_base,p_field,p_sub,p_value);
  idx integer;
  matches integer;
BEGIN
  SELECT * INTO actor FROM wf_demo.actor();
  IF NOT FOUND OR p_field IS NULL OR
     NOT ((actor.writer='wf' AND p_field IN ('done','lat','archived') AND nullif(p_sub,'') IS NOT NULL)
       OR (actor.writer='wf' AND p_field='nextRun' AND p_sub IS NULL AND p_value IS TRUE)
       OR (actor.writer='cc' AND p_field='ccActive' AND p_sub IS NULL)) THEN
    RETURN QUERY SELECT 'refused'::text,NULL::bigint; RETURN;
  END IF;
  IF p_base IS NULL OR p_base < 0 OR nullif(p_op,'') IS NULL OR p_value IS NULL THEN
    RETURN QUERY SELECT 'missing-precondition'::text,NULL::bigint; RETURN;
  END IF;
  PERFORM wf_demo.lock_board(actor.owner_id,p_board);
  SELECT * INTO entry FROM wf_demo.entries
    WHERE owner_id=actor.owner_id AND board=p_board AND item=p_item FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'missing'::text,NULL::bigint; RETURN; END IF;
  SELECT * INTO receipt FROM wf_demo.receipts
    WHERE owner_id=actor.owner_id AND writer=actor.writer AND board=p_board AND item=p_item AND operation=p_op;
  IF FOUND THEN
    IF receipt.intent = intent THEN RETURN QUERY SELECT 'replayed'::text,receipt.applied_revision;
    ELSE RETURN QUERY SELECT 'id-reused'::text,entry.revision; END IF;
    RETURN;
  END IF;
  IF entry.removed THEN RETURN QUERY SELECT 'deleted'::text,entry.revision; RETURN; END IF;
  IF entry.revision <> p_base THEN RETURN QUERY SELECT 'conflict'::text,entry.revision; RETURN; END IF;
  IF p_field='nextRun' THEN
    -- Pilot supports manually repeated flat, Weekly Focus-owned checklists.
    DECLARE
      tasks jsonb := entry.payload->'subtasks';
      history jsonb := coalesce(entry.payload->'checklistRuns','[]'::jsonb);
      stamp bigint := floor(extract(epoch FROM statement_timestamp())*1000)::bigint;
      next_tasks jsonb;
      finished jsonb;
    BEGIN
      IF entry.payload->'repeatChecklist' IS DISTINCT FROM 'true'::jsonb
         OR coalesce(entry.payload->'taskSchemaVersion','1'::jsonb) <> '1'::jsonb
         OR jsonb_typeof(tasks) IS DISTINCT FROM 'array' OR jsonb_typeof(history) <> 'array' THEN
        RETURN QUERY SELECT 'blocked'::text,entry.revision; RETURN;
      END IF;
      IF jsonb_array_length(tasks)=0 OR EXISTS (
        SELECT FROM jsonb_array_elements(tasks) t
        WHERE jsonb_typeof(t->'id') IS DISTINCT FROM 'string' OR nullif(t->>'id','') IS NULL
           OR t->'done' IS DISTINCT FROM 'true'::jsonb OR t->>'parentId' IS NOT NULL
           OR t->>'occurrenceId' IS NOT NULL OR t->>'src' IS NOT NULL
           OR t->>'archived'='true' OR t->>'del'='true'
      ) OR EXISTS (SELECT FROM jsonb_array_elements(tasks) t GROUP BY t->>'id' HAVING count(*)>1) THEN
        RETURN QUERY SELECT 'blocked'::text,entry.revision; RETURN;
      END IF;
      SELECT jsonb_agg(t || jsonb_build_object('done',false,'u',stamp) ORDER BY ord),
             jsonb_agg(jsonb_build_object('id',t->'id','text',t->>'t') ORDER BY ord)
        INTO next_tasks,finished FROM jsonb_array_elements(tasks) WITH ORDINALITY AS rows(t,ord);
      entry.payload := entry.payload || jsonb_build_object('subtasks',next_tasks,
        'checklistRuns',history || jsonb_build_array(jsonb_build_object('id',p_op,
          'closedAt',stamp,'revision',p_base,'completedTasks',finished)));
    END;
  ELSIF p_field='archived' THEN
    IF coalesce(entry.payload->'taskSchemaVersion','1'::jsonb) <> '1'::jsonb THEN
      RETURN QUERY SELECT 'blocked'::text,entry.revision; RETURN;
    END IF;
    DECLARE updated jsonb := wf_demo.archive_tasks(entry.payload->'subtasks',p_sub,p_value,
        floor(extract(epoch FROM statement_timestamp())*1000)::bigint);
    BEGIN
      IF updated IS NULL THEN RETURN QUERY SELECT 'blocked'::text,entry.revision; RETURN; END IF;
      entry.payload := jsonb_set(entry.payload,'{subtasks}',updated);
    END;
  ELSIF p_field IN ('done','lat') THEN
    IF COALESCE(entry.payload->'taskSchemaVersion','1'::jsonb) <> '1'::jsonb OR
       jsonb_typeof(entry.payload->'subtasks') IS DISTINCT FROM 'array' THEN
      RETURN QUERY SELECT 'blocked'::text,entry.revision; RETURN;
    END IF;
    SELECT count(*),min(ord-1) INTO matches,idx FROM jsonb_array_elements(entry.payload->'subtasks')
      WITH ORDINALITY AS t(node,ord) WHERE node->>'id'=p_sub;
    IF matches <> 1 OR EXISTS (SELECT FROM jsonb_array_elements(entry.payload->'subtasks') t
      WHERE t->>'occurrenceId' IS NOT NULL OR t->>'parentId' IS NOT NULL OR t->>'archived'='true' OR (t->>'id'=p_sub AND t->>'del'='true')) THEN
      RETURN QUERY SELECT 'blocked'::text,entry.revision; RETURN;
    END IF;
    entry.payload := jsonb_set(entry.payload,ARRAY['subtasks',idx::text,p_field],to_jsonb(p_value));
    IF p_field='lat' AND p_value THEN
      entry.payload := jsonb_set(entry.payload,ARRAY['subtasks',idx::text,'latAt'],
        to_jsonb(floor(extract(epoch FROM statement_timestamp())*1000)::bigint));
    END IF;
  ELSE
    entry.payload := jsonb_set(entry.payload,'{ccActive}',to_jsonb(p_value));
  END IF;
  UPDATE wf_demo.entries SET payload=entry.payload,revision=entry.revision+1
    WHERE owner_id=actor.owner_id AND board=p_board AND item=p_item;
  INSERT INTO wf_demo.receipts VALUES(actor.owner_id,actor.writer,p_board,p_item,p_op,intent,entry.revision+1);
  RETURN QUERY SELECT 'applied'::text, entry.revision+1;
END $$;
REVOKE ALL ON FUNCTION wf_demo.apply(text,text,text,bigint,text,text,boolean) FROM PUBLIC;
GRANT USAGE ON SCHEMA wf_demo TO wf_demo_pc,wf_demo_phone,wf_demo_cc;
GRANT EXECUTE ON FUNCTION wf_demo.apply(text,text,text,bigint,text,text,boolean) TO wf_demo_pc,wf_demo_phone,wf_demo_cc;
