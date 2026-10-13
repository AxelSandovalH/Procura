-- Cuarto plan: Empresa (absorbe a los antiguos Enterprise y Custom).
alter table organization_subscriptions drop constraint if exists organization_subscriptions_plan_check;
alter table organization_subscriptions add constraint organization_subscriptions_plan_check check (plan in ('esencial', 'control', 'negocio', 'empresa'));
