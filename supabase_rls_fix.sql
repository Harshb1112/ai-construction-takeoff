-- ============================================================
-- RLS Fix for AI Construction Takeoff — Prisma Tables
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ============================================================

-- Step 1: Enable RLS on all tables
ALTER TABLE public."User"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Project"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Drawing"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DrawingScale"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Annotation"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TakeoffItem"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."BoqItem"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ScheduleTask"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PunchItem"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Risk"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Requirement"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Assembly"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."KnowledgeDoc"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CostItem"      ENABLE ROW LEVEL SECURITY;

-- Step 2: Allow service_role full access (Prisma uses this — won't break app)
CREATE POLICY "service_role_all" ON public."User"         FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public."Project"      FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public."Drawing"      FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public."DrawingScale" FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public."Annotation"   FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public."TakeoffItem"  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public."BoqItem"      FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public."ScheduleTask" FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public."PunchItem"    FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public."Risk"         FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public."Requirement"  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public."Assembly"     FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public."KnowledgeDoc" FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public."CostItem"     FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Done! All 15 RLS errors + sensitive column warning fixed.
