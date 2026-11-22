-- Install only into the ephemeral test cluster, after permissions.sql.
CREATE TABLE wf_demo.batch_receipts (
  owner_id text, board text, operation text, intent jsonb NOT NULL,
  PRIMARY KEY(owner_id,board,operation)
);

-- changes is an explicit list of {item,base,kind,...}. Closing a board requires
-- a matching delete intent for every active entry. No implicit rebase or purge.
CREATE FUNCTION wf_demo.batch(p_board text,p_op text,p_changes jsonb,p_close boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  actor wf_demo.actors%ROWTYPE;
  entry wf_demo.entries%ROWTYPE;
  change jsonb;
  body jsonb := jsonb_build_array(p_changes,p_close);
  saved jsonb;
  item_key text;
  kind text;
  base bigint;
  result text;
BEGIN
  SELECT * INTO actor FROM wf_demo.actor();
  IF NOT FOUND OR actor.writer <> 'wf' THEN RETURN 'refused'; END IF;
  IF nullif(p_board,'') IS NULL OR nullif(p_op,'') IS NULL OR p_close IS NULL OR
     jsonb_typeof(p_changes) IS DISTINCT FROM 'array' THEN RETURN 'refused'; END IF;
  PERFORM wf_demo.lock_board(actor.owner_id,p_board);
  SELECT intent INTO saved FROM wf_demo.batch_receipts WHERE owner_id=actor.owner_id
    AND board=p_board AND operation=p_op;
  IF FOUND THEN RETURN CASE WHEN saved=body THEN 'replayed' ELSE 'id-reused' END; END IF;
  IF EXISTS (SELECT FROM wf_demo.closed_boards WHERE owner_id=actor.owner_id AND board=p_board)
    THEN RETURN 'deleted'; END IF;
  IF EXISTS (SELECT FROM jsonb_array_elements(p_changes) c GROUP BY c->>'item' HAVING count(*)>1)
    THEN RETURN 'refused'; END IF;

  -- An exception rolls back all earlier members of this batch before returning
  -- the review reason. Receipts for nested checklist edits roll back with them.
  BEGIN
    FOR change IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
      kind := change->>'kind'; item_key := change->>'item';
      IF nullif(item_key,'') IS NULL OR (p_close AND kind IS DISTINCT FROM 'delete') OR
         jsonb_typeof(change->'base') IS DISTINCT FROM 'number' OR
         (change->>'base') !~ '^[0-9]{1,16}$' THEN RAISE EXCEPTION 'refused'; END IF;
      base := (change->>'base')::bigint;
      SELECT * INTO entry FROM wf_demo.entries WHERE owner_id=actor.owner_id
        AND board=p_board AND item=item_key FOR UPDATE;
      IF kind='create' THEN
        IF FOUND OR base<>0 THEN RAISE EXCEPTION 'conflict'; END IF;
        IF jsonb_typeof(change->'payload') IS DISTINCT FROM 'object' OR
           coalesce(change->'payload'->'ccActive','false'::jsonb) <> 'false'::jsonb
           THEN RAISE EXCEPTION 'refused'; END IF;
        INSERT INTO wf_demo.entries(owner_id,board,item,revision,payload)
          VALUES(actor.owner_id,p_board,item_key,1,change->'payload');
      ELSE
        IF NOT FOUND THEN RAISE EXCEPTION 'missing'; END IF;
        IF entry.revision<>base THEN RAISE EXCEPTION 'conflict'; END IF;
        IF kind IN ('delete','restore') THEN
          IF entry.removed=(kind='delete') THEN RAISE EXCEPTION 'conflict'; END IF;
          UPDATE wf_demo.entries SET removed=(kind='delete'),revision=base+1
            WHERE owner_id=actor.owner_id AND board=p_board AND item=item_key;
        ELSIF kind='done' THEN
          IF jsonb_typeof(change->'value') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'refused'; END IF;
          SELECT status INTO result FROM wf_demo.apply(p_board,item_key,
            jsonb_build_array('bulk',p_op)::text,base,'done',change->>'sub',(change->>'value')::boolean);
          IF result<>'applied' THEN RAISE EXCEPTION '%',result; END IF;
        ELSE RAISE EXCEPTION 'refused';
        END IF;
      END IF;
    END LOOP;
    IF p_close THEN
      IF EXISTS (SELECT FROM wf_demo.entries WHERE owner_id=actor.owner_id AND board=p_board AND NOT removed)
        THEN RAISE EXCEPTION 'conflict'; END IF;
      INSERT INTO wf_demo.closed_boards VALUES(actor.owner_id,p_board);
    END IF;
    INSERT INTO wf_demo.batch_receipts VALUES(actor.owner_id,p_board,p_op,body);
  EXCEPTION WHEN raise_exception THEN RETURN SQLERRM;
  END;
  RETURN 'applied';
END $$;
REVOKE ALL ON FUNCTION wf_demo.batch(text,text,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wf_demo.batch(text,text,jsonb,boolean) TO wf_demo_authenticated;
