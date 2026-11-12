CREATE TABLE IF NOT EXISTS companies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, plan text NOT NULL DEFAULT 'Essentiel', active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid REFERENCES companies(id), name text NOT NULL,
 email text NOT NULL UNIQUE, password_hash text NOT NULL,
 role text NOT NULL CHECK(role IN ('saas_admin','agency_admin','manager','owner','tenant')),
 CHECK ((role='saas_admin') = (company_id IS NULL)), UNIQUE(company_id,id)
);
CREATE TABLE IF NOT EXISTS sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), token_hash text UNIQUE NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS properties (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), name text NOT NULL, type text NOT NULL,
 city text NOT NULL, district text NOT NULL, address text NOT NULL DEFAULT '', rent integer NOT NULL CHECK(rent>0),
 owner_id uuid, commission numeric(4,2) NOT NULL DEFAULT 8 CHECK(commission BETWEEN 7 AND 10),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(company_id,id), FOREIGN KEY(company_id,owner_id) REFERENCES users(company_id,id)
);
CREATE TABLE IF NOT EXISTS tenants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), name text NOT NULL, email text NOT NULL, phone text NOT NULL,
 user_id uuid, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(company_id,id), FOREIGN KEY(company_id,user_id) REFERENCES users(company_id,id)
);
CREATE TABLE IF NOT EXISTS leases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), property_id uuid NOT NULL, tenant_id uuid NOT NULL,
 start_date date NOT NULL, end_date date NOT NULL, rent integer NOT NULL CHECK(rent>0), deposit integer NOT NULL DEFAULT 0 CHECK(deposit>=0), status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','ended')),
 CHECK(end_date>=start_date), UNIQUE(company_id,id), FOREIGN KEY(company_id,property_id) REFERENCES properties(company_id,id), FOREIGN KEY(company_id,tenant_id) REFERENCES tenants(company_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_lease ON leases(property_id) WHERE status='active';
CREATE TABLE IF NOT EXISTS invoices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), lease_id uuid NOT NULL, period date NOT NULL,
 due_date date NOT NULL, amount integer NOT NULL CHECK(amount>0), commission numeric(4,2) NOT NULL CHECK(commission BETWEEN 7 AND 10),
 paid_at timestamptz, reference text NOT NULL UNIQUE DEFAULT ('LI-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,16))),
 UNIQUE(company_id,id), UNIQUE(lease_id,period), FOREIGN KEY(company_id,lease_id) REFERENCES leases(company_id,id)
);
CREATE TABLE IF NOT EXISTS payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), invoice_id uuid NOT NULL,
 transaction_id text NOT NULL UNIQUE, amount integer NOT NULL CHECK(amount>0), currency text NOT NULL DEFAULT 'XOF' CHECK(currency='XOF'),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','failed')), payment_url text, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,invoice_id) REFERENCES invoices(company_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_payment ON payments(invoice_id) WHERE status IN ('pending','accepted');
CREATE TABLE IF NOT EXISTS tickets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), property_id uuid NOT NULL,
 title text NOT NULL, description text NOT NULL, priority text NOT NULL CHECK(priority IN ('normal','urgent')),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved')), created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,property_id) REFERENCES properties(company_id,id)
);
CREATE TABLE IF NOT EXISTS documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), lease_id uuid NOT NULL,
 name text NOT NULL, kind text NOT NULL CHECK(kind IN ('contract','inventory','identity')), filename text NOT NULL, mime text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(company_id,lease_id) REFERENCES leases(company_id,id)
);
CREATE TABLE IF NOT EXISTS mail_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), invoice_id uuid NOT NULL UNIQUE,
 sent_at timestamptz, attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), last_error text,
 FOREIGN KEY(company_id,invoice_id) REFERENCES invoices(company_id,id)
);
CREATE TABLE IF NOT EXISTS audit_logs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, company_id uuid REFERENCES companies(id), actor_id uuid REFERENCES users(id), action text NOT NULL, entity_id text, created_at timestamptz NOT NULL DEFAULT now()
);
-- RLS is defense in depth. The API role MUST NOT own tables or have BYPASSRLS.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['properties','tenants','leases','invoices','payments','tickets','documents','mail_jobs'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=t AND policyname='tenant_isolation') THEN
   EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = nullif(current_setting(''app.company_id'',true),'''')::uuid) WITH CHECK (company_id = nullif(current_setting(''app.company_id'',true),'''')::uuid)',t);
  END IF;
 END LOOP;
END $$;
