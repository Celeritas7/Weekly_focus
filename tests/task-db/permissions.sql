-- Phase 3C overlay for the disposable cluster, after the concurrency suite.
CREATE ROLE wf_demo_gateway LOGIN NOINHERIT;
CREATE ROLE wf_demo_authenticated NOLOGIN;
CREATE ROLE wf_demo_anon NOLOGIN;
GRANT wf_demo_authenticated TO wf_demo_gateway;
REVOKE USAGE ON SCHEMA wf_demo FROM wf_demo_phone,wf_demo_pc;
REVOKE EXECUTE ON FUNCTION wf_demo.apply(text,text,text,bigint,text,text,boolean)
  FROM wf_demo_phone,wf_demo_pc;

-- Bind the bridge credential to one owner. Browser sessions cannot select a writer.
UPDATE wf_demo.actors SET owner_id='00000000-0000-4000-8000-000000000001'
  WHERE login='wf_demo_cc';

CREATE OR REPLACE FUNCTION wf_demo.actor() RETURNS SETOF wf_demo.actors
LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
DECLARE subject uuid;
BEGIN
  IF session_user='wf_demo_cc' THEN
    RETURN QUERY SELECT * FROM wf_demo.actors WHERE login=session_user AND writer='cc';
  ELSIF session_user='wf_demo_gateway' THEN
    subject := (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;
    IF subject IS NOT NULL THEN
      RETURN QUERY SELECT session_user::name,subject::text,'wf'::text;
    END IF;
  END IF;
EXCEPTION WHEN invalid_text_representation THEN RETURN;
END $$;

CREATE FUNCTION wf_demo.read_entry(p_board text,p_item text)
RETURNS TABLE(revision bigint,payload jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT e.revision,e.payload FROM wf_demo.entries e JOIN wf_demo.actor() a
    ON a.owner_id=e.owner_id AND a.writer='wf'
    WHERE e.board=p_board AND e.item=p_item
$$;
REVOKE ALL ON FUNCTION wf_demo.read_entry(text,text) FROM PUBLIC;
GRANT USAGE ON SCHEMA wf_demo TO wf_demo_authenticated;
GRANT EXECUTE ON FUNCTION wf_demo.apply(text,text,text,bigint,text,text,boolean),
  wf_demo.read_entry(text,text) TO wf_demo_authenticated;
