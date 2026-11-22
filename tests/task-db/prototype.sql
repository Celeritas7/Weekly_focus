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
     NOT ((actor.writer='wf' AND p_field IN ('done','lat') AND nullif(p_sub,'') IS NOT NULL)
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
  IF p_field IN ('done','lat') THEN
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
